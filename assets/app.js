/* ============================================================
   Enciclopedia del Mundo — Lógica de la aplicación
   La configuración (nombre, categorías) está en config.js
   Los diagramas están en graph.js
   ============================================================ */
"use strict";

/* ---------- Claves de almacenamiento local ---------- */
const LS = {
  apiUrl: "wb_api_url",
  secret: "wb_secret",
  author: "wb_author",
  cache:  "wb_cache_entries",
};

/* ---------- Campos que sólo existen en las escenas ---------- */
const NARRATIVE_FIELDS = ["sceneType", "chapter", "location", "characters", "choices", "effects", "conditions"];

/* ---------- Estado global ---------- */
const state = {
  entries: [],
  schema: null,          // columnas que reporta el backend (para detectar script viejo)
  loading: false,
  error: null,
  readOnly: false,
  view: { type: "category", category: CONFIG.categories[0]?.id },
  search: "",
  activeTag: null,
  flow: { orientation: "vertical", chapter: "__all__", zoom: 1 },
  apiUrl: CONFIG.apiUrl || localStorage.getItem(LS.apiUrl) || "",
  secret: localStorage.getItem(LS.secret) || "",
  author: localStorage.getItem(LS.author) || "",
};

/* ---------- Atajos ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $("#app");
const modalRoot = $("#modal-root");

document.title = CONFIG.siteName + " · Enciclopedia";

/* ============================================================
   Utilidades
   ============================================================ */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const attr = (s) => escapeHtml(s).replace(/`/g, "&#96;");

const categoryById = (id) => CONFIG.categories.find((c) => c.id === id);
const categoryLabel = (id) => (categoryById(id) || {}).label || id;
const categoryIcon  = (id) => (categoryById(id) || {}).icon || "•";
const isNarrativeCat = (id) => !!(categoryById(id) || {}).narrative;
const narrativeCatId = () => (CONFIG.categories.find((c) => c.narrative) || {}).id || "escenas";

function splitList(str) {
  return String(str || "").split(",").map((s) => s.trim()).filter(Boolean);
}
const uniq = (arr) => [...new Set(arr)];
const byName = (n) => state.entries.find((e) => WBGraph.norm(e.name) === WBGraph.norm(n));

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- Mini-renderizador de Markdown ---------- */
function renderMarkdown(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  let html = "", listType = null, inQuote = false, para = [];

  const inline = (t) => escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const flushPara = () => { if (para.length) { html += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; } };
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  const closeQuote = () => { if (inQuote) { html += "</blockquote>"; inQuote = false; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const q = line.match(/^>\s?(.*)$/);

    if (h) { flushPara(); closeList(); closeQuote(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); closeQuote(); html += "<hr>"; continue; }
    if (ul) { flushPara(); closeQuote(); if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; } html += `<li>${inline(ul[1])}</li>`; continue; }
    if (ol) { flushPara(); closeQuote(); if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; } html += `<li>${inline(ol[1])}</li>`; continue; }
    if (q)  { flushPara(); closeList(); if (!inQuote) { html += "<blockquote>"; inQuote = true; } html += inline(q[1]) + "<br>"; continue; }
    if (line.trim() === "") { flushPara(); closeList(); closeQuote(); continue; }
    closeList(); closeQuote(); para.push(line);
  }
  flushPara(); closeList(); closeQuote();
  return html || '<p style="color:var(--faint)">— sin contenido —</p>';
}

/* ============================================================
   API (Google Apps Script)
   ============================================================ */
const apiConfigured = () => !!state.apiUrl;

async function apiList() {
  const u = new URL(state.apiUrl);
  u.searchParams.set("action", "list");
  if (state.secret) u.searchParams.set("secret", state.secret);
  const res = await fetch(u.toString(), { method: "GET", redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function apiWrite(action, payload) {
  const res = await fetch(state.apiUrl, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita el preflight CORS
    body: JSON.stringify({ action, secret: state.secret, ...payload }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function normalizeErr(err) {
  const m = String((err && err.message) || err);
  if (/unauthorized/i.test(m)) return "La contraseña no es correcta.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "No se pudo conectar con la base de datos. Revisá la URL del script y tu conexión.";
  return m;
}

// ¿El backend ya tiene las columnas de la narrativa?
const schemaSupportsNarrative = () =>
  Array.isArray(state.schema) && NARRATIVE_FIELDS.every((f) => state.schema.includes(f));

async function loadEntries() {
  state.loading = true; state.error = null;
  render();
  try {
    const data = await apiList();
    state.entries = data.entries || [];
    state.schema = data.schema || null;
    state.readOnly = false;
    localStorage.setItem(LS.cache, JSON.stringify(state.entries));
  } catch (err) {
    const cached = localStorage.getItem(LS.cache);
    if (cached) { state.entries = JSON.parse(cached); state.readOnly = true; }
    state.error = normalizeErr(err);
  } finally {
    state.loading = false;
    render();
  }
}

/* ============================================================
   Render — cáscara
   ============================================================ */
function render() {
  const counts = {};
  CONFIG.categories.forEach((c) => (counts[c.id] = 0));
  state.entries.forEach((e) => { if (counts[e.category] != null) counts[e.category]++; });
  const initial = (state.author || "?").trim().charAt(0).toUpperCase() || "?";

  app.innerHTML = `
    <div class="layout">
      <div class="scrim" id="scrim"></div>
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-title" data-action="home"><span class="sigil">📖</span><span>${escapeHtml(CONFIG.siteName)}</span></div>
          ${CONFIG.tagline ? `<div class="brand-tagline">${escapeHtml(CONFIG.tagline)}</div>` : ""}
        </div>
        <nav class="nav">${renderNav(counts)}</nav>
        <div class="sidebar-foot">
          <div class="who">
            <span class="avatar">${escapeHtml(initial)}</span>
            <span>${state.author ? escapeHtml(state.author) : "Anónimo"}</span>
            <button data-action="change-user">cambiar</button>
          </div>
          <button class="btn btn-ghost" data-action="settings" style="justify-content:flex-start">⚙️ Configuración</button>
        </div>
      </aside>
      <main class="main" id="main">${renderMain()}</main>
    </div>`;

  afterRender();
}

function renderNav(counts) {
  const groups = CONFIG.groups && CONFIG.groups.length ? CONFIG.groups : [{ id: undefined, label: "Categorías" }];
  let html = "";
  for (const g of groups) {
    const cats = CONFIG.categories.filter((c) => (c.group || undefined) === g.id);
    if (!cats.length) continue;
    html += `<div class="nav-label">${escapeHtml(g.label)}</div>`;
    html += cats.map((c) => `
      <button class="nav-item ${state.view.type === "category" && state.view.category === c.id ? "active" : ""}" data-cat="${c.id}">
        <span class="ico">${c.icon}</span><span>${escapeHtml(c.label)}</span>
        <span class="count">${counts[c.id]}</span>
      </button>`).join("");
  }
  const views = [
    { id: "flow",      icon: "🌊", label: "Diagrama de flujo" },
    { id: "relations", icon: "🕸️", label: "Mapa de relaciones" },
    { id: "dashboard", icon: "📊", label: "Panel de control" },
  ];
  html += `<div class="nav-label">Vistas</div>` + views.map((v) => `
    <button class="nav-item ${state.view.type === v.id ? "active" : ""}" data-view="${v.id}">
      <span class="ico">${v.icon}</span><span>${escapeHtml(v.label)}</span>
    </button>`).join("");
  return html;
}

/* ============================================================
   Render — contenido principal
   ============================================================ */
function renderMain() {
  if (apiConfigured() && !state.secret) {
    return `<div class="empty" style="padding-top:110px">
      <div class="em-ico">🔒</div><h3>Contenido protegido</h3>
      <p>Ingresá la contraseña compartida para ver y editar el mundo.</p>
      <button class="btn btn-gold" data-action="unlock">🔑 Ingresar contraseña</button></div>`;
  }
  if (state.loading && !state.entries.length) {
    return `<div class="empty"><div class="em-ico">🕯️</div><h3>Consultando el códice…</h3></div>`;
  }

  let banner = "";
  if (state.error) {
    banner += `<div class="banner err">⚠️ ${escapeHtml(state.error)}${state.readOnly ? " Mostrando la última copia guardada (solo lectura)." : ""}
      <button class="btn btn-ghost" data-action="reload">Reintentar</button></div>`;
  }
  if (state.schema && !schemaSupportsNarrative()) {
    banner += `<div class="banner warn">⚠️ El script de Google es la versión vieja: las escenas se guardarían <strong>sin</strong> sus decisiones.
      Actualizá <code>apps-script/Codigo.gs</code> y reimplementá (ver README).</div>`;
  }

  const topbar = `
    <div class="topbar">
      <button class="menu-toggle" data-action="toggle-menu" aria-label="Menú">☰</button>
      <div class="search"><span class="search-ico">🔎</span>
        <input id="search-input" type="search" placeholder="Buscar en todo el proyecto…" value="${attr(state.search)}" /></div>
      <button class="btn btn-gold" data-action="new">✦ Nueva entrada</button>
    </div>`;

  let body;
  if (state.search.trim())              body = renderSearchResults();
  else if (state.view.type === "entry") body = renderDetail(state.view.id);
  else if (state.view.type === "flow")  body = renderFlowView();
  else if (state.view.type === "relations") body = renderRelationsView();
  else if (state.view.type === "dashboard") body = renderDashboard();
  else                                  body = renderCategory(state.view.category);

  return topbar + banner + body;
}

/* ---------- Búsqueda ---------- */
function renderSearchResults() {
  const q = state.search.trim().toLowerCase();
  const hit = (e) => [e.name, e.summary, e.body, e.tags, e.characters, e.location, e.chapter, categoryLabel(e.category)]
    .some((v) => String(v || "").toLowerCase().includes(q));
  const results = state.entries.filter(hit);
  return `<div class="section-head"><h1><span class="ico">🔎</span> Resultados</h1>
      <span class="sub">${results.length} coincidencia${results.length === 1 ? "" : "s"} para “${escapeHtml(state.search)}”</span></div>
    <div class="rule"></div>
    ${results.length ? renderGrid(results, true) : emptyState("Sin coincidencias", "Probá con otra palabra.")}`;
}

/* ---------- Categoría ---------- */
function renderCategory(catId) {
  const cat = categoryById(catId) || CONFIG.categories[0];
  let items = state.entries.filter((e) => e.category === cat.id);

  const allTags = uniq(items.flatMap((e) => splitList(e.tags))).sort((a, b) => a.localeCompare(b));
  if (state.activeTag) {
    items = items.filter((e) => splitList(e.tags).map((t) => t.toLowerCase()).includes(state.activeTag.toLowerCase()));
  }
  items.sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));

  const tagBar = allTags.length ? `<div class="filter-bar"><span class="lbl">Etiquetas</span>
      ${allTags.map((t) => `<button class="chip tag ${state.activeTag && state.activeTag.toLowerCase() === t.toLowerCase() ? "active" : ""}" data-tag="${attr(t)}">${escapeHtml(t)}</button>`).join("")}
      ${state.activeTag ? `<button class="chip tag" data-tag="__clear__">✕ limpiar</button>` : ""}</div>` : "";

  const shortcut = cat.narrative && items.length
    ? `<button class="btn" data-view="flow" style="margin-left:auto">🌊 Ver diagrama de flujo</button>` : "";

  return `<div class="section-head">
      <h1><span class="ico">${cat.icon}</span> ${escapeHtml(cat.label)}</h1>
      <span class="sub">${items.length} entrada${items.length === 1 ? "" : "s"}</span>${shortcut}</div>
    <div class="rule"></div>${tagBar}
    ${items.length ? renderGrid(items) : emptyState(`Todavía no hay ${cat.label.toLowerCase()}`,
        cat.narrative ? "Creá la primera escena para empezar a armar el guion." : "Empezá a poblar tu mundo creando la primera entrada.", true)}`;
}

function renderGrid(items, showCat = false) {
  return `<div class="grid">${items.map((e) => renderCard(e, showCat)).join("")}</div>`;
}

function renderCard(e, showCat) {
  const tags = splitList(e.tags).slice(0, 3);
  const narrative = isNarrativeCat(e.category);
  const t = narrative ? WBGraph.typeMeta(WBGraph.sceneTypeOf(e)) : null;
  const nChoices = narrative ? WBGraph.parseChoices(e.choices).length : 0;

  const media = e.imageUrl
    ? `<div class="card-media"><img src="${attr(e.imageUrl)}" alt="" loading="lazy"></div>`
    : `<div class="card-media placeholder">${narrative ? t.icon : categoryIcon(e.category)}</div>`;

  return `<article class="card" data-entry="${attr(e.id)}">
      ${media}
      <div class="card-body">
        ${narrative
          ? `<div class="card-cat" style="color:${t.color}">${t.icon} ${escapeHtml(t.label)}${e.chapter ? " · " + escapeHtml(e.chapter) : ""}</div>`
          : showCat ? `<div class="card-cat">${categoryIcon(e.category)} ${escapeHtml(categoryLabel(e.category))}</div>` : ""}
        <h3 class="card-title">${escapeHtml(e.name || "Sin nombre")}</h3>
        ${e.summary ? `<div class="card-summary">${escapeHtml(e.summary)}</div>` : ""}
        <div class="card-tags">
          ${narrative && nChoices ? `<span class="chip">⑂ ${nChoices} opcion${nChoices === 1 ? "" : "es"}</span>` : ""}
          ${tags.map((t2) => `<span class="chip">${escapeHtml(t2)}</span>`).join("")}
        </div>
      </div>
    </article>`;
}

function emptyState(title, msg, showBtn) {
  return `<div class="empty"><div class="em-ico">✧</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(msg)}</p>
    ${showBtn ? `<button class="btn btn-gold" data-action="new">✦ Crear entrada</button>` : ""}</div>`;
}

/* ---------- Detalle ---------- */
function renderDetail(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return `<div class="empty"><div class="em-ico">🕯️</div><h3>Entrada no encontrada</h3>
    <p>Quizá fue eliminada.</p><button class="btn" data-action="back">← Volver</button></div>`;

  const narrative = isNarrativeCat(e.category);
  const t = narrative ? WBGraph.typeMeta(WBGraph.sceneTypeOf(e)) : null;

  const portrait = e.imageUrl
    ? `<div class="detail-portrait"><img src="${attr(e.imageUrl)}" alt="${attr(e.name)}"></div>`
    : `<div class="detail-portrait placeholder">${narrative ? t.icon : categoryIcon(e.category)}</div>`;

  const tags = splitList(e.tags);
  const relChip = (name) => {
    const target = byName(name);
    return target
      ? `<button class="relation" data-entry="${attr(target.id)}">${categoryIcon(target.category)} ${escapeHtml(name)}</button>`
      : `<span class="relation missing" title="Todavía no existe esta entrada">✧ ${escapeHtml(name)}</span>`;
  };

  return `<div class="detail">
      <button class="detail-back" data-action="back">← Volver a ${escapeHtml(categoryLabel(e.category))}</button>
      <div class="detail-hero">${portrait}
        <div class="detail-headinfo">
          <div class="detail-cat" ${narrative ? `style="color:${t.color}"` : ""}>
            ${narrative ? t.icon + " " + escapeHtml(t.label) : categoryIcon(e.category) + " " + escapeHtml(categoryLabel(e.category))}
          </div>
          <h1>${escapeHtml(e.name || "Sin nombre")}</h1>
          ${e.summary ? `<div class="detail-summary">${escapeHtml(e.summary)}</div>` : ""}
          ${narrative ? renderSceneMeta(e) : ""}
          <div class="detail-actions">
            <button class="btn" data-action="edit" data-id="${attr(e.id)}">✎ Editar</button>
            ${narrative ? `<button class="btn" data-view="flow">🌊 Ver en el diagrama</button>` : ""}
            <button class="btn btn-danger" data-action="delete" data-id="${attr(e.id)}">🗑 Eliminar</button>
          </div>
        </div>
      </div>
      ${tags.length ? `<div class="detail-tags">${tags.map((tg) => `<span class="chip tag" data-tag="${attr(tg)}" data-gotocat="${attr(e.category)}">${escapeHtml(tg)}</span>`).join("")}</div>` : ""}
      <div class="prose">${renderMarkdown(e.body)}</div>
      ${narrative ? renderSceneGraph(e) : ""}
      ${splitList(e.relations).length ? `<div class="detail-relations"><h3>✦ Conexiones</h3>
        <div class="relation-list">${splitList(e.relations).map(relChip).join("")}</div></div>` : ""}
      <div class="detail-meta">
        ${e.author ? `<span>✍ ${escapeHtml(e.author)}</span>` : ""}
        ${e.createdAt ? `<span>Creado ${timeAgo(e.createdAt)}</span>` : ""}
        ${e.updatedAt && e.updatedAt !== e.createdAt ? `<span>Editado ${timeAgo(e.updatedAt)}</span>` : ""}
      </div>
    </div>`;
}

function renderSceneMeta(e) {
  const bits = [];
  if (e.chapter)  bits.push(`<span class="chip">📕 ${escapeHtml(e.chapter)}</span>`);
  if (e.location) {
    const l = byName(e.location);
    bits.push(l ? `<button class="chip tag" data-entry="${attr(l.id)}">🗺️ ${escapeHtml(e.location)}</button>`
                : `<span class="chip">🗺️ ${escapeHtml(e.location)}</span>`);
  }
  splitList(e.characters).forEach((c) => {
    const p = byName(c);
    bits.push(p ? `<button class="chip tag" data-entry="${attr(p.id)}">👤 ${escapeHtml(c)}</button>`
                : `<span class="chip">👤 ${escapeHtml(c)}</span>`);
  });
  if (e.conditions) bits.push(`<span class="chip" title="Requisito para llegar acá">🔐 ${escapeHtml(e.conditions)}</span>`);
  if (e.effects)    bits.push(`<span class="chip" title="Variables que modifica">🎚️ ${escapeHtml(e.effects)}</span>`);
  return bits.length ? `<div class="scene-meta">${bits.join("")}</div>` : "";
}

// Entradas y salidas de una escena
function renderSceneGraph(e) {
  const choices = WBGraph.parseChoices(e.choices);
  const incoming = state.entries.filter((s) =>
    isNarrativeCat(s.category) && s.id !== e.id &&
    WBGraph.parseChoices(s.choices).some((c) => c.target && WBGraph.norm(c.target) === WBGraph.norm(e.name)));

  const outHtml = choices.length ? choices.map((c) => {
    const target = c.target ? byName(c.target) : null;
    const cls = target ? "choice" : "choice broken";
    const arrow = c.target
      ? (target ? `<span class="choice-to" data-entry="${attr(target.id)}">${escapeHtml(c.target)}</span>`
                : `<span class="choice-to missing">${escapeHtml(c.target)} (no existe)</span>`)
      : `<span class="choice-to missing">sin destino</span>`;
    return `<li class="${cls}"><span class="choice-label">${escapeHtml(c.label || "(sin texto)")}</span>
        <span class="choice-arrow">→</span>${arrow}
        ${c.cond ? `<span class="chip mini">si: ${escapeHtml(c.cond)}</span>` : ""}
        ${c.effects ? `<span class="chip mini">🎚️ ${escapeHtml(c.effects)}</span>` : ""}</li>`;
  }).join("") : `<li class="choice empty-choice">— sin opciones: esta escena termina acá —</li>`;

  return `<div class="detail-relations scene-flow">
      ${incoming.length ? `<h3>↘ Se llega desde</h3><div class="relation-list">
        ${incoming.map((s) => `<button class="relation" data-entry="${attr(s.id)}">🎬 ${escapeHtml(s.name)}</button>`).join("")}</div>` : ""}
      <h3 style="margin-top:22px">⑂ Decisiones</h3>
      <ul class="choice-list">${outHtml}</ul>
    </div>`;
}

/* ============================================================
   Vista: Diagrama de flujo
   ============================================================ */
function renderFlowView() {
  const sceneCat = narrativeCatId();
  const scenes = state.entries.filter((e) => e.category === sceneCat);
  if (!scenes.length) {
    return `<div class="section-head"><h1><span class="ico">🌊</span> Diagrama de flujo</h1></div><div class="rule"></div>
      <div class="empty"><div class="em-ico">🌊</div><h3>Todavía no hay escenas</h3>
      <p>El diagrama se dibuja solo a partir de las decisiones que cargues en cada escena.
         Creá una escena, escribí sus opciones y aparecerán acá conectadas.</p>
      <button class="btn btn-gold" data-action="new-scene">🎬 Crear la primera escena</button></div>`;
  }

  const chapters = uniq(scenes.map((s) => s.chapter).filter(Boolean)).sort((a, b) => a.localeCompare(b, "es"));
  const model = WBGraph.buildFlow(state.entries, { sceneCategory: sceneCat, chapter: state.flow.chapter });
  const w = model.warnings;
  const nWarn = w.missingTarget.length + w.deadEnds.length + w.orphans.length + (w.noStart ? 1 : 0);

  return `<div class="section-head">
      <h1><span class="ico">🌊</span> Diagrama de flujo</h1>
      <span class="sub">${model.nodes.length} escenas · ${model.edges.length} conexiones</span></div>
    <div class="rule"></div>
    <div class="flow-toolbar">
      <select id="flow-chapter" class="mini-select">
        <option value="__all__">Todos los capítulos</option>
        ${chapters.map((c) => `<option value="${attr(c)}" ${state.flow.chapter === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <button class="btn btn-ghost" data-action="flow-orient">${state.flow.orientation === "vertical" ? "⇅ Vertical" : "⇄ Horizontal"}</button>
      <div class="zoom-group">
        <button class="btn btn-ghost" data-action="flow-out">−</button>
        <span id="flow-zoom" class="zoom-val">100%</span>
        <button class="btn btn-ghost" data-action="flow-in">+</button>
        <button class="btn btn-ghost" data-action="flow-fit">⤢ Ajustar</button>
      </div>
      ${nWarn ? `<button class="btn btn-ghost warn-btn" data-view="dashboard">⚠️ ${nWarn} aviso${nWarn === 1 ? "" : "s"}</button>` : ""}
      <div class="flow-legend">
        ${CONFIG.sceneTypes.map((t) => `<span class="leg"><i style="background:${t.color}"></i>${escapeHtml(t.label)}</span>`).join("")}
      </div>
    </div>
    <div class="flow-stage" id="flow-stage"></div>
    <p class="flow-hint">Arrastrá para mover · rueda del mouse para acercar · clic en una escena para abrirla</p>`;
}

/* ============================================================
   Vista: Mapa de relaciones
   ============================================================ */
function renderRelationsView() {
  const model = WBGraph.buildRelations(state.entries);
  if (!model.nodes.length) {
    return `<div class="section-head"><h1><span class="ico">🕸️</span> Mapa de relaciones</h1></div><div class="rule"></div>
      ${emptyState("Todavía no hay nada que mapear", "Cargá personajes, lugares o facciones y conectalos con el campo “Conexiones”.")}`;
  }
  return `<div class="section-head"><h1><span class="ico">🕸️</span> Mapa de relaciones</h1>
      <span class="sub">${model.nodes.length} entradas · ${model.links.length} vínculos</span></div>
    <div class="rule"></div>
    ${!model.links.length ? `<div class="banner warn">Todavía no hay vínculos. Usá el campo <strong>Conexiones</strong> de cada entrada para enlazarlas entre sí.</div>` : ""}
    <div class="rel-stage" id="rel-stage"></div>
    <p class="flow-hint">Pasá el mouse para resaltar vínculos · clic para abrir la entrada</p>`;
}

/* ============================================================
   Vista: Panel de control
   ============================================================ */
function renderDashboard() {
  const sceneCat = narrativeCatId();
  const model = WBGraph.buildFlow(state.entries, { sceneCategory: sceneCat });
  const w = model.warnings;
  const scenes = model.nodes;
  const endings = scenes.filter((n) => n.type === "final");
  const decisions = scenes.filter((n) => n.type === "decision");
  const worldCount = state.entries.filter((e) => !["escenas", "capitulos", "variables"].includes(e.category)).length;
  const avgBranch = decisions.length
    ? (model.edges.filter((e) => decisions.some((d) => d.id === e.from)).length / decisions.length).toFixed(1) : "0";

  // Personajes con más apariciones en escenas
  const appearances = {};
  state.entries.filter((e) => e.category === sceneCat).forEach((s) => {
    splitList(s.characters).forEach((c) => { const k = c.trim(); if (k) appearances[k] = (appearances[k] || 0) + 1; });
  });
  const topChars = Object.entries(appearances).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const stat = (icon, val, label) => `<div class="stat"><div class="stat-ico">${icon}</div>
    <div><div class="stat-val">${val}</div><div class="stat-lbl">${escapeHtml(label)}</div></div></div>`;

  const warnBlock = (title, list, render2) => !list.length ? "" : `
    <div class="warn-block"><h4>${title} <span class="chip mini">${list.length}</span></h4>
      <ul class="warn-list">${list.map(render2).join("")}</ul></div>`;

  return `<div class="section-head"><h1><span class="ico">📊</span> Panel de control</h1>
      <span class="sub">Estado del proyecto</span></div><div class="rule"></div>

    <div class="stat-grid">
      ${stat("🌍", worldCount, "entradas de mundo")}
      ${stat("🎬", scenes.length, "escenas")}
      ${stat("⑂", decisions.length, "puntos de decisión")}
      ${stat("🏁", endings.length, "finales")}
      ${stat("🔗", model.edges.length, "conexiones")}
      ${stat("📈", avgBranch, "ramas por decisión")}
    </div>

    <h2 class="dash-h">🩺 Revisión del guion</h2>
    ${!scenes.length ? `<p style="color:var(--muted)">Cargá escenas para ver los avisos de diseño.</p>` : ""}
    ${w.noStart ? `<div class="banner warn">No hay ninguna escena marcada como <strong>Inicio</strong>. Marcá una para saber por dónde arranca el juego.</div>` : ""}
    ${warnBlock("🔗 Opciones que no llevan a ningún lado", w.missingTarget, (m) =>
      `<li><button class="link-btn" data-entry="${attr(m.from.id)}">${escapeHtml(m.from.name)}</button>
        <span class="warn-why">“${escapeHtml(m.choice.label || "(sin texto)")}” — ${escapeHtml(m.reason)}</span></li>`)}
    ${warnBlock("🚧 Escenas sin salida (y no marcadas como final)", w.deadEnds, (s) =>
      `<li><button class="link-btn" data-entry="${attr(s.id)}">${escapeHtml(s.name)}</button>
        <span class="warn-why">no tiene opciones cargadas</span></li>`)}
    ${warnBlock("👻 Escenas huérfanas (no se llega desde ninguna)", w.orphans, (s) =>
      `<li><button class="link-btn" data-entry="${attr(s.id)}">${escapeHtml(s.name)}</button>
        <span class="warn-why">ninguna decisión lleva acá</span></li>`)}
    ${scenes.length && !w.missingTarget.length && !w.deadEnds.length && !w.orphans.length && !w.noStart
      ? `<div class="banner ok-banner">✅ El guion no tiene cabos sueltos.</div>` : ""}

    ${topChars.length ? `<h2 class="dash-h">👥 Presencia de personajes</h2>
      <div class="bar-list">${topChars.map(([name, n]) => {
        const max = topChars[0][1];
        const p = byName(name);
        return `<div class="bar-row">
          <span class="bar-name">${p ? `<button class="link-btn" data-entry="${attr(p.id)}">${escapeHtml(name)}</button>` : escapeHtml(name)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.round((n / max) * 100)}%"></span></span>
          <span class="bar-num">${n}</span></div>`;
      }).join("")}</div>` : ""}`;
}

/* ============================================================
   Montaje de los diagramas después de renderizar
   ============================================================ */
function afterRender() {
  if (state.search.trim()) return;

  if (state.view.type === "flow") {
    const stage = $("#flow-stage");
    if (stage) {
      const model = WBGraph.buildFlow(state.entries, { sceneCategory: narrativeCatId(), chapter: state.flow.chapter });
      state._flowApi = WBGraph.mountFlow(stage, model, { orientation: state.flow.orientation }, {
        onNodeClick: (id) => go({ type: "entry", id }),
        onZoom: (k) => { const el = $("#flow-zoom"); if (el) el.textContent = Math.round(k * 100) + "%"; },
      });
    }
  }
  if (state.view.type === "relations") {
    const stage = $("#rel-stage");
    if (stage) {
      const model = WBGraph.buildRelations(state.entries);
      WBGraph.mountRelations(stage, model, { onNodeClick: (id) => go({ type: "entry", id }) });
    }
  }
}

/* ============================================================
   Navegación y eventos (delegación única)
   ============================================================ */
function go(view) {
  state.view = view; state.search = "";
  if (view.type !== "category") state.activeTag = null;
  render(); window.scrollTo(0, 0);
}
const toggleMenu = () => { $("#sidebar")?.classList.toggle("open"); $("#scrim")?.classList.toggle("show"); };
const closeMenu  = () => { $("#sidebar")?.classList.remove("open"); $("#scrim")?.classList.remove("show"); };

app.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-action],[data-entry],[data-tag],[data-cat],[data-view]");
  if (!t) return;

  if (t.dataset.cat)  { state.activeTag = null; go({ type: "category", category: t.dataset.cat }); closeMenu(); return; }
  if (t.dataset.view) { go({ type: t.dataset.view }); closeMenu(); return; }
  if (t.dataset.entry && !t.dataset.action) { go({ type: "entry", id: t.dataset.entry }); return; }

  if (t.dataset.tag != null && !t.dataset.action) {
    if (t.dataset.gotocat) { state.view = { type: "category", category: t.dataset.gotocat }; state.search = ""; }
    const same = state.activeTag && state.activeTag.toLowerCase() === t.dataset.tag.toLowerCase();
    state.activeTag = (t.dataset.tag === "__clear__" || same) ? null : t.dataset.tag;
    render(); window.scrollTo(0, 0); return;
  }

  switch (t.dataset.action) {
    case "home":        go({ type: "category", category: CONFIG.categories[0].id }); break;
    case "new":         openEntryModal(null); break;
    case "new-scene":   openEntryModal(null, narrativeCatId()); break;
    case "edit":        openEntryModal(state.entries.find((x) => x.id === t.dataset.id)); break;
    case "delete":      confirmDelete(t.dataset.id); break;
    case "back":        go({ type: "category", category: (state.entries.find((x) => x.id === state.view.id) || {}).category || CONFIG.categories[0].id }); break;
    case "reload":      loadEntries(); break;
    case "unlock":      openWelcomeModal(); break;
    case "settings":    openSetupModal(true); break;
    case "change-user": openAuthorModal(); break;
    case "toggle-menu": toggleMenu(); break;
    case "flow-in":     state._flowApi?.zoomIn(); break;
    case "flow-out":    state._flowApi?.zoomOut(); break;
    case "flow-fit":    state._flowApi?.fit(); break;
    case "flow-orient":
      state.flow.orientation = state.flow.orientation === "vertical" ? "horizontal" : "vertical";
      render(); break;
  }
});

app.addEventListener("change", (ev) => {
  if (ev.target.id === "flow-chapter") { state.flow.chapter = ev.target.value; render(); }
});

app.addEventListener("input", debounce((ev) => {
  if (ev.target.id !== "search-input") return;
  state.search = ev.target.value;
  const main = $("#main");
  main.innerHTML = renderMain();
  afterRender();
  const s = $("#search-input");
  if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}, 180));

app.addEventListener("click", (ev) => { if (ev.target.id === "scrim") closeMenu(); });

/* ============================================================
   Modales
   ============================================================ */
const closeModal = () => { modalRoot.innerHTML = ""; };
const overlay = (inner) => { modalRoot.innerHTML = `<div class="modal-overlay">${inner}</div>`; };
modalRoot.addEventListener("click", (ev) => { if (ev.target.classList.contains("modal-overlay")) closeModal(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeModal(); });

/* ---------- Bienvenida / desbloqueo ---------- */
function openWelcomeModal() {
  overlay(`<div class="modal narrow">
      <div class="modal-head"><h2>🔑 Entrar</h2>
        <p>Bienvenido a <strong>${escapeHtml(CONFIG.siteName)}</strong>. Ingresá tu nombre y la contraseña compartida.</p></div>
      <div class="modal-body">
        <div class="field"><label>Tu nombre</label>
          <input id="wc-name" type="text" placeholder="Ej: Joaquín" value="${attr(state.author)}" maxlength="40" autocomplete="off" /></div>
        <div class="field"><label>Contraseña compartida</label>
          <input id="wc-secret" type="password" placeholder="La clave del proyecto" value="${attr(state.secret)}" autocomplete="off" />
          <span class="sub-hint">Se guarda solo en este navegador.</span></div>
        <div class="form-err" id="wc-err"></div>
      </div>
      <div class="modal-foot"><button class="btn btn-gold" id="wc-go" style="width:100%;justify-content:center">Entrar</button></div>
    </div>`);

  const submit = async () => {
    const name = $("#wc-name").value.trim(), secret = $("#wc-secret").value, err = $("#wc-err");
    if (!name)   { err.textContent = "Escribí tu nombre.";     $("#wc-name").focus();   return; }
    if (!secret) { err.textContent = "Escribí la contraseña."; $("#wc-secret").focus(); return; }
    const btn = $("#wc-go"); btn.disabled = true; btn.textContent = "Entrando…"; err.textContent = "";
    const prev = state.secret;
    state.secret = secret; state.author = name;
    try {
      const data = await apiList();
      state.entries = data.entries || []; state.schema = data.schema || null;
      state.readOnly = false; state.error = null;
      localStorage.setItem(LS.cache, JSON.stringify(state.entries));
      localStorage.setItem(LS.secret, secret);
      localStorage.setItem(LS.author, name);
      closeModal(); render();
    } catch (e) {
      state.secret = prev;
      err.textContent = normalizeErr(e);
      btn.disabled = false; btn.textContent = "Entrar";
    }
  };
  $("#wc-go").addEventListener("click", submit);
  $("#wc-secret").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  $("#wc-name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#wc-secret").focus(); });
  setTimeout(() => (state.author ? $("#wc-secret") : $("#wc-name"))?.focus(), 60);
}

/* ---------- Configuración ---------- */
function openSetupModal(fromSettings) {
  overlay(`<div class="modal">
      <div class="modal-head"><h2>⚙️ Conexión con la base de datos</h2>
        <p>Los datos se guardan en una Hoja de Google a través de un script.</p></div>
      <div class="modal-body">
        <div class="field"><label>URL del script (Apps Script)</label>
          <input id="cfg-url" type="url" placeholder="https://script.google.com/macros/s/AKfy…/exec" value="${attr(state.apiUrl)}" />
          <span class="sub-hint">Termina en <code>/exec</code>.</span></div>
        <div class="field"><label>Contraseña compartida</label>
          <input id="cfg-secret" type="password" value="${attr(state.secret)}" /></div>
        ${state.schema ? `<div class="sub-hint">Backend: ${schemaSupportsNarrative()
          ? "✅ versión con narrativa" : "⚠️ versión vieja (sin columnas de escenas)"}</div>` : ""}
        <div class="form-err" id="cfg-err"></div>
      </div>
      <div class="modal-foot">
        ${fromSettings ? `<button class="btn btn-ghost" data-x>Cancelar</button>` : ""}
        <button class="btn btn-gold" id="cfg-save">Conectar</button></div>
    </div>`);

  modalRoot.querySelector("[data-x]")?.addEventListener("click", closeModal);
  $("#cfg-save").addEventListener("click", async () => {
    const url = $("#cfg-url").value.trim(), secret = $("#cfg-secret").value, err = $("#cfg-err");
    if (!/^https:\/\/script\.google\.com\/.*\/exec$/.test(url)) {
      err.textContent = "La URL debe ser la de la app web y terminar en /exec."; return;
    }
    const btn = $("#cfg-save"); btn.disabled = true; btn.textContent = "Probando…"; err.textContent = "";
    const prev = { apiUrl: state.apiUrl, secret: state.secret };
    state.apiUrl = url; state.secret = secret;
    try {
      await apiList();
      localStorage.setItem(LS.apiUrl, url); localStorage.setItem(LS.secret, secret);
      closeModal();
      state.author ? loadEntries() : openAuthorModal(true);
    } catch (e) {
      state.apiUrl = prev.apiUrl; state.secret = prev.secret;
      err.textContent = "No se pudo conectar: " + normalizeErr(e);
      btn.disabled = false; btn.textContent = "Conectar";
    }
  });
}

/* ---------- ¿Quién sos? ---------- */
function openAuthorModal(thenLoad) {
  overlay(`<div class="modal narrow">
      <div class="modal-head"><h2>✍ ¿Quién sos?</h2><p>Tu nombre se guarda junto a las entradas que crees.</p></div>
      <div class="modal-body"><div class="field"><label>Tu nombre</label>
        <input id="au-name" type="text" placeholder="Ej: Joaquín" value="${attr(state.author)}" maxlength="40" /></div></div>
      <div class="modal-foot"><button class="btn btn-gold" id="au-save">Guardar</button></div>
    </div>`);
  const save = () => {
    const v = $("#au-name").value.trim();
    if (!v) { $("#au-name").focus(); return; }
    state.author = v; localStorage.setItem(LS.author, v);
    closeModal();
    thenLoad ? loadEntries() : render();
  };
  $("#au-save").addEventListener("click", save);
  $("#au-name").addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
  setTimeout(() => $("#au-name")?.focus(), 50);
}

/* ---------- Crear / editar entrada ---------- */
function openEntryModal(entry, forceCat) {
  if (state.readOnly) { toast("Estás en modo solo-lectura (sin conexión).", "err"); return; }
  const isEdit = !!entry;
  const e = entry || { category: forceCat || (state.view.type === "category" ? state.view.category : CONFIG.categories[0].id) };

  const namesOf = (catId) => state.entries.filter((x) => x.category === catId).map((x) => x.name).filter(Boolean);
  const dl = (id, list) => `<datalist id="${id}">${uniq(list).map((n) => `<option value="${attr(n)}"></option>`).join("")}</datalist>`;

  overlay(`<div class="modal wide">
      <div class="modal-head"><h2>${isEdit ? "✎ Editar entrada" : "✦ Nueva entrada"}</h2></div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field"><label>Categoría</label>
            <select id="f-cat">${CONFIG.categories.map((c) => `<option value="${c.id}" ${c.id === e.category ? "selected" : ""}>${c.icon} ${escapeHtml(c.label)}</option>`).join("")}</select></div>
          <div class="field"><label>Nombre <span class="hint">*</span></label>
            <input id="f-name" type="text" value="${attr(e.name)}" placeholder="Nombre de la entrada" maxlength="120" /></div>
        </div>
        <div class="field"><label>Resumen <span class="hint">(una línea)</span></label>
          <input id="f-summary" type="text" value="${attr(e.summary)}" placeholder="Descripción corta para la tarjeta" maxlength="200" /></div>

        <div id="scene-fields"></div>

        <div class="field"><label>Descripción <span class="hint">(Markdown: **negrita**, # títulos, - listas)</span></label>
          <textarea id="f-body" placeholder="Contá todo lo que quieras…">${escapeHtml(e.body)}</textarea></div>
        <div class="field-row">
          <div class="field"><label>Etiquetas <span class="hint">(por coma)</span></label>
            <input id="f-tags" type="text" value="${attr(e.tags)}" placeholder="protagonista, reino del norte" /></div>
          <div class="field"><label>Conexiones <span class="hint">(nombres, por coma)</span></label>
            <input id="f-relations" type="text" value="${attr(e.relations)}" placeholder="Otro personaje, Una ciudad" list="dl-all" /></div>
        </div>
        <div class="field"><label>URL de imagen <span class="hint">(opcional)</span></label>
          <input id="f-image" type="url" value="${attr(e.imageUrl)}" placeholder="https://…" /></div>
        <div class="form-err" id="f-err"></div>
        ${dl("dl-all", state.entries.map((x) => x.name))}
        ${dl("dl-personajes", namesOf("personajes"))}
        ${dl("dl-lugares", namesOf("lugares"))}
        ${dl("dl-capitulos", namesOf("capitulos"))}
        ${dl("dl-escenas", namesOf(narrativeCatId()))}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-x>Cancelar</button>
        <button class="btn btn-gold" id="f-save">${isEdit ? "Guardar cambios" : "Crear entrada"}</button></div>
    </div>`);

  modalRoot.querySelector("[data-x]").addEventListener("click", closeModal);

  const sceneBox = $("#scene-fields");
  function paintSceneFields() {
    const cat = $("#f-cat").value;
    if (!isNarrativeCat(cat)) { sceneBox.innerHTML = ""; return; }
    const type = e.sceneType || WBGraph.sceneTypeOf(e);
    sceneBox.innerHTML = `
      <div class="scene-box">
        <div class="scene-box-title">🎬 Datos de la escena</div>
        <div class="field-row">
          <div class="field"><label>Tipo</label>
            <select id="f-sceneType">${CONFIG.sceneTypes.map((t) => `<option value="${t.id}" ${t.id === type ? "selected" : ""}>${t.icon} ${escapeHtml(t.label)}</option>`).join("")}</select></div>
          <div class="field"><label>Capítulo</label>
            <input id="f-chapter" type="text" value="${attr(e.chapter)}" placeholder="Ej: 01 — Prólogo" list="dl-capitulos" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Lugar</label>
            <input id="f-location" type="text" value="${attr(e.location)}" placeholder="Dónde ocurre" list="dl-lugares" /></div>
          <div class="field"><label>Personajes <span class="hint">(por coma)</span></label>
            <input id="f-characters" type="text" value="${attr(e.characters)}" placeholder="Quiénes aparecen" list="dl-personajes" /></div>
        </div>
        <div class="field">
          <label>Decisiones <span class="hint">— una por línea: <code>Texto de la opción -&gt; Escena destino</code></span></label>
          <textarea id="f-choices" class="mono" placeholder="Salvar a Alice -> Huida en el tren | confianza+1&#10;Dejarla atrás -> Solo en la noche | confianza-1&#10;Llamar a Kara -> Reencuentro | si: kara_viva=true">${escapeHtml(e.choices)}</textarea>
          <span class="sub-hint">Podés agregar <code>| efectos</code> y <code>| si: condición</code>. El diagrama se dibuja con esto.</span>
          <div id="choice-preview" class="choice-preview"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Variables que cambia <span class="hint">(efectos)</span></label>
            <input id="f-effects" type="text" value="${attr(e.effects)}" placeholder="confianza+1, alice_viva=false" /></div>
          <div class="field"><label>Condición para llegar</label>
            <input id="f-conditions" type="text" value="${attr(e.conditions)}" placeholder="alice_viva=true" /></div>
        </div>
      </div>`;
    const ta = $("#f-choices");
    const preview = () => {
      const chs = WBGraph.parseChoices(ta.value);
      if (!chs.length) { $("#choice-preview").innerHTML = ""; return; }
      $("#choice-preview").innerHTML = chs.map((c) => {
        if (!c.target) return `<span class="pv bad">“${escapeHtml(c.label || "?")}” sin destino</span>`;
        const exists = state.entries.some((x) => isNarrativeCat(x.category) && WBGraph.norm(x.name) === WBGraph.norm(c.target));
        return `<span class="pv ${exists ? "ok" : "warn"}">${escapeHtml(c.label || "?")} → ${escapeHtml(c.target)}${exists ? "" : " (no existe aún)"}</span>`;
      }).join("");
    };
    ta.addEventListener("input", debounce(preview, 250));
    preview();
  }
  $("#f-cat").addEventListener("change", paintSceneFields);
  paintSceneFields();
  setTimeout(() => $("#f-name")?.focus(), 50);

  $("#f-save").addEventListener("click", async () => {
    const cat = $("#f-cat").value;
    const payload = {
      category: cat,
      name: $("#f-name").value.trim(),
      summary: $("#f-summary").value.trim(),
      body: $("#f-body").value,
      tags: $("#f-tags").value.trim(),
      relations: $("#f-relations").value.trim(),
      imageUrl: $("#f-image").value.trim(),
      author: state.author || "Anónimo",
    };
    if (isNarrativeCat(cat)) {
      payload.sceneType  = $("#f-sceneType").value;
      payload.chapter    = $("#f-chapter").value.trim();
      payload.location   = $("#f-location").value.trim();
      payload.characters = $("#f-characters").value.trim();
      payload.choices    = $("#f-choices").value;
      payload.effects    = $("#f-effects").value.trim();
      payload.conditions = $("#f-conditions").value.trim();
    }
    const err = $("#f-err");
    if (!payload.name) { err.textContent = "El nombre es obligatorio."; return; }
    if (isNarrativeCat(cat) && state.schema && !schemaSupportsNarrative()) {
      err.textContent = "El script de Google es la versión vieja: las decisiones no se guardarían. Actualizalo primero (ver README)."; return;
    }

    const btn = $("#f-save"); btn.disabled = true; btn.textContent = "Guardando…"; err.textContent = "";
    try {
      let saved;
      if (isEdit) {
        const res = await apiWrite("update", { entry: { ...payload, id: e.id, author: e.author || payload.author } });
        saved = res.entry;
        const idx = state.entries.findIndex((x) => x.id === e.id);
        if (idx >= 0) state.entries[idx] = saved;
      } else {
        const res = await apiWrite("create", { entry: payload });
        saved = res.entry;
        state.entries.push(saved);
      }
      localStorage.setItem(LS.cache, JSON.stringify(state.entries));
      closeModal();
      toast(isEdit ? "Entrada actualizada" : "Entrada creada", "ok");
      go({ type: "entry", id: saved.id });
    } catch (ex) {
      err.textContent = "No se pudo guardar: " + normalizeErr(ex);
      btn.disabled = false; btn.textContent = isEdit ? "Guardar cambios" : "Crear entrada";
    }
  });
}

/* ---------- Eliminar ---------- */
function confirmDelete(id) {
  if (state.readOnly) { toast("Estás en modo solo-lectura (sin conexión).", "err"); return; }
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  overlay(`<div class="modal narrow">
      <div class="modal-head"><h2>🗑 Eliminar entrada</h2>
        <p>¿Seguro que querés eliminar <strong>${escapeHtml(e.name)}</strong>? No se puede deshacer.</p></div>
      <div class="modal-body"><div class="form-err" id="del-err"></div></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-x>Cancelar</button>
        <button class="btn btn-danger" id="del-yes">Sí, eliminar</button></div>
    </div>`);
  modalRoot.querySelector("[data-x]").addEventListener("click", closeModal);
  $("#del-yes").addEventListener("click", async () => {
    const btn = $("#del-yes"); btn.disabled = true; btn.textContent = "Eliminando…";
    try {
      await apiWrite("delete", { id });
      state.entries = state.entries.filter((x) => x.id !== id);
      localStorage.setItem(LS.cache, JSON.stringify(state.entries));
      closeModal(); toast("Entrada eliminada", "ok");
      go({ type: "category", category: e.category });
    } catch (ex) {
      $("#del-err").textContent = "No se pudo eliminar: " + normalizeErr(ex);
      btn.disabled = false; btn.textContent = "Sí, eliminar";
    }
  });
}

/* ---------- Toasts ---------- */
let toastWrap;
function toast(msg, kind = "") {
  if (!toastWrap) { toastWrap = document.createElement("div"); toastWrap.className = "toast-wrap"; document.body.appendChild(toastWrap); }
  const el = document.createElement("div");
  el.className = "toast " + kind; el.textContent = msg;
  toastWrap.appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 320); }, 2600);
}

/* ============================================================
   Arranque
   ============================================================ */
(function boot() {
  if (!apiConfigured()) { render(); openSetupModal(); return; }
  if (!state.secret || !state.author) { render(); openWelcomeModal(); return; }
  loadEntries();
})();
