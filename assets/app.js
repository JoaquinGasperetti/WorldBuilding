/* ============================================================
   Enciclopedia del Mundo — Lógica de la aplicación
   No hace falta tocar este archivo para el uso normal.
   La configuración (nombre, categorías, URL) está en config.js
   ============================================================ */
"use strict";

/* ---------- Claves de almacenamiento local ---------- */
const LS = {
  apiUrl:   "wb_api_url",
  secret:   "wb_secret",
  author:   "wb_author",
  cache:    "wb_cache_entries",
};

/* ---------- Estado global ---------- */
const state = {
  entries: [],
  loading: false,
  error: null,
  readOnly: false,           // true si no hay conexión y mostramos caché
  view: { type: "category", category: CONFIG.categories[0]?.id },
  search: "",
  activeTag: null,
  apiUrl: CONFIG.apiUrl || localStorage.getItem(LS.apiUrl) || "",
  secret: localStorage.getItem(LS.secret) || "",
  author: localStorage.getItem(LS.author) || "",
};

/* ---------- Atajos DOM ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const app = $("#app");
const modalRoot = $("#modal-root");

document.title = CONFIG.siteName + " · Enciclopedia";

/* ============================================================
   Utilidades
   ============================================================ */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function attr(s) { return escapeHtml(s).replace(/`/g, "&#96;"); }

function categoryById(id) { return CONFIG.categories.find((c) => c.id === id); }
function categoryLabel(id) { const c = categoryById(id); return c ? c.label : id; }
function categoryIcon(id) { const c = categoryById(id); return c ? c.icon : "•"; }

function splitList(str) {
  return String(str || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function uniq(arr) { return [...new Set(arr)]; }

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

/* ---------- Mini-renderizador de Markdown (subconjunto seguro) ---------- */
function renderMarkdown(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let listType = null; // "ul" | "ol"
  let inQuote = false;
  let paraBuffer = [];

  const inline = (t) =>
    escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/`([^`]+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const flushPara = () => {
    if (paraBuffer.length) { html += "<p>" + paraBuffer.map(inline).join("<br>") + "</p>"; paraBuffer = []; }
  };
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  const closeQuote = () => { if (inQuote) { html += "</blockquote>"; inQuote = false; } };

  for (let raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const q  = line.match(/^>\s?(.*)$/);

    if (h) { flushPara(); closeList(); closeQuote(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); closeQuote(); html += "<hr>"; continue; }
    if (ul) { flushPara(); closeQuote(); if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; } html += `<li>${inline(ul[1])}</li>`; continue; }
    if (ol) { flushPara(); closeQuote(); if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; } html += `<li>${inline(ol[1])}</li>`; continue; }
    if (q)  { flushPara(); closeList(); if (!inQuote) { html += "<blockquote>"; inQuote = true; } html += inline(q[1]) + "<br>"; continue; }

    if (line.trim() === "") { flushPara(); closeList(); closeQuote(); continue; }
    // línea normal → parte de un párrafo
    closeList(); closeQuote();
    paraBuffer.push(line);
  }
  flushPara(); closeList(); closeQuote();
  return html || '<p class="faint">— sin contenido —</p>';
}

/* ============================================================
   Capa de API (Google Apps Script)
   ============================================================ */
function apiConfigured() { return !!state.apiUrl; }

async function apiList() {
  const u = new URL(state.apiUrl);
  u.searchParams.set("action", "list");
  if (state.secret) u.searchParams.set("secret", state.secret);
  const res = await fetch(u.toString(), { method: "GET", redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.entries || [];
}

async function apiWrite(action, payload) {
  const res = await fetch(state.apiUrl, {
    method: "POST",
    redirect: "follow",
    // text/plain evita el "preflight" de CORS que Apps Script no maneja
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, secret: state.secret, ...payload }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/* ============================================================
   Carga de datos
   ============================================================ */
async function loadEntries() {
  state.loading = true;
  state.error = null;
  render();
  try {
    const entries = await apiList();
    state.entries = entries;
    state.readOnly = false;
    localStorage.setItem(LS.cache, JSON.stringify(entries));
  } catch (err) {
    // Fallback: mostrar la última copia guardada en el navegador
    const cached = localStorage.getItem(LS.cache);
    if (cached) { state.entries = JSON.parse(cached); state.readOnly = true; }
    state.error = normalizeErr(err);
  } finally {
    state.loading = false;
    render();
  }
}

function normalizeErr(err) {
  const m = String(err && err.message || err);
  if (/unauthorized/i.test(m)) return "La contraseña no es correcta.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "No se pudo conectar con la base de datos. Revisá la URL del script y tu conexión.";
  return m;
}

/* ============================================================
   Renderizado principal
   ============================================================ */
function render() {
  // Sin API configurada → asistente de configuración
  if (!apiConfigured()) { renderShell(); openSetupModal(); return; }
  // Sin contraseña guardada → pantalla de desbloqueo
  renderShell();
}

function renderShell() {
  const cats = CONFIG.categories;
  const counts = {};
  for (const c of cats) counts[c.id] = 0;
  for (const e of state.entries) if (counts[e.category] != null) counts[e.category]++;

  const initial = (state.author || "?").trim().charAt(0).toUpperCase() || "?";

  app.innerHTML = `
    <div class="layout">
      <div class="scrim" id="scrim"></div>
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-title" data-nav="home">
            <span class="sigil">📖</span><span>${escapeHtml(CONFIG.siteName)}</span>
          </div>
          ${CONFIG.tagline ? `<div class="brand-tagline">${escapeHtml(CONFIG.tagline)}</div>` : ""}
        </div>
        <nav class="nav">
          <div class="nav-label">Categorías</div>
          ${cats.map((c) => `
            <button class="nav-item ${state.view.type === "category" && state.view.category === c.id ? "active" : ""}" data-cat="${c.id}">
              <span class="ico">${c.icon}</span><span>${escapeHtml(c.label)}</span>
              <span class="count">${counts[c.id]}</span>
            </button>`).join("")}
        </nav>
        <div class="sidebar-foot">
          <div class="who">
            <span class="avatar">${escapeHtml(initial)}</span>
            <span>${state.author ? escapeHtml(state.author) : "Anónimo"}</span>
            <button data-action="change-user">cambiar</button>
          </div>
          <button class="btn btn-ghost" data-action="settings" style="justify-content:flex-start">⚙️ Configuración</button>
        </div>
      </aside>
      <main class="main" id="main">${renderMain(counts)}</main>
    </div>`;

  bindShell();
}

function renderMain(counts) {
  if (state.loading && !state.entries.length) {
    return `<div class="empty"><div class="em-ico">🕯️</div><h3>Consultando el códice…</h3></div>`;
  }

  let banner = "";
  if (state.readOnly && state.error) {
    banner = `<div class="banner err">⚠️ ${escapeHtml(state.error)} Mostrando la última copia guardada (solo lectura).
      <button class="btn btn-ghost" data-action="reload">Reintentar</button></div>`;
  } else if (state.error && !state.entries.length) {
    banner = `<div class="banner err">⚠️ ${escapeHtml(state.error)}
      <button class="btn btn-ghost" data-action="reload">Reintentar</button></div>`;
  }

  const topbar = `
    <div class="topbar">
      <button class="menu-toggle" data-action="toggle-menu" aria-label="Menú">☰</button>
      <div class="search">
        <span class="search-ico">🔎</span>
        <input id="search-input" type="search" placeholder="Buscar en todo el mundo…" value="${attr(state.search)}" />
      </div>
      <button class="btn btn-gold" data-action="new">✦ Nueva entrada</button>
    </div>`;

  let body;
  if (state.view.type === "entry") body = renderDetail(state.view.id);
  else if (state.search.trim()) body = renderSearchResults();
  else body = renderCategory(state.view.category);

  return topbar + banner + body;
}

function matchesSearch(e, qLower) {
  return (
    (e.name || "").toLowerCase().includes(qLower) ||
    (e.summary || "").toLowerCase().includes(qLower) ||
    (e.body || "").toLowerCase().includes(qLower) ||
    (e.tags || "").toLowerCase().includes(qLower) ||
    categoryLabel(e.category).toLowerCase().includes(qLower)
  );
}

function renderSearchResults() {
  const q = state.search.trim().toLowerCase();
  const results = state.entries.filter((e) => matchesSearch(e, q));
  return `
    <div class="section-head"><h1><span class="ico">🔎</span> Resultados</h1>
      <span class="sub">${results.length} coincidencia${results.length === 1 ? "" : "s"} para “${escapeHtml(state.search)}”</span></div>
    <div class="rule"></div>
    ${results.length ? renderGrid(results, true) : emptyState("Sin coincidencias", "Probá con otra palabra o revisá otra categoría.")}`;
}

function renderCategory(catId) {
  const cat = categoryById(catId) || CONFIG.categories[0];
  let items = state.entries.filter((e) => e.category === cat.id);

  // barra de tags de esta categoría
  const allTags = uniq(items.flatMap((e) => splitList(e.tags))).sort((a, b) => a.localeCompare(b));
  if (state.activeTag) items = items.filter((e) => splitList(e.tags).map((t) => t.toLowerCase()).includes(state.activeTag.toLowerCase()));
  items.sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));

  const tagBar = allTags.length ? `
    <div class="filter-bar">
      <span class="lbl">Etiquetas</span>
      ${allTags.map((t) => `<button class="chip tag ${state.activeTag && state.activeTag.toLowerCase() === t.toLowerCase() ? "active" : ""}" data-tag="${attr(t)}">${escapeHtml(t)}</button>`).join("")}
      ${state.activeTag ? `<button class="chip tag" data-tag="__clear__">✕ limpiar</button>` : ""}
    </div>` : "";

  return `
    <div class="section-head">
      <h1><span class="ico">${cat.icon}</span> ${escapeHtml(cat.label)}</h1>
      <span class="sub">${items.length} entrada${items.length === 1 ? "" : "s"}</span>
    </div>
    <div class="rule"></div>
    ${tagBar}
    ${items.length
      ? renderGrid(items)
      : emptyState(`Todavía no hay ${cat.label.toLowerCase()}`, "Empezá a poblar tu mundo creando la primera entrada.", true)}`;
}

function renderGrid(items, showCat = false) {
  return `<div class="grid">${items.map((e) => renderCard(e, showCat)).join("")}</div>`;
}

function renderCard(e, showCat) {
  const tags = splitList(e.tags).slice(0, 3);
  const media = e.imageUrl
    ? `<div class="card-media"><img src="${attr(e.imageUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();this.parentElement.textContent='${categoryIcon(e.category)}'"></div>`
    : `<div class="card-media placeholder">${categoryIcon(e.category)}</div>`;
  return `
    <article class="card" data-entry="${attr(e.id)}">
      ${media}
      <div class="card-body">
        ${showCat ? `<div class="card-cat">${categoryIcon(e.category)} ${escapeHtml(categoryLabel(e.category))}</div>` : ""}
        <h3 class="card-title">${escapeHtml(e.name || "Sin nombre")}</h3>
        ${e.summary ? `<div class="card-summary">${escapeHtml(e.summary)}</div>` : ""}
        ${tags.length ? `<div class="card-tags">${tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      </div>
    </article>`;
}

function emptyState(title, msg, showBtn) {
  return `<div class="empty">
    <div class="em-ico">✧</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(msg)}</p>
    ${showBtn ? `<button class="btn btn-gold" data-action="new">✦ Crear entrada</button>` : ""}
  </div>`;
}

function renderDetail(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return `<div class="empty"><div class="em-ico">🕯️</div><h3>Entrada no encontrada</h3>
    <p>Quizá fue eliminada.</p><button class="btn" data-action="back">← Volver</button></div>`;

  const portrait = e.imageUrl
    ? `<div class="detail-portrait"><img src="${attr(e.imageUrl)}" alt="${attr(e.name)}" onerror="this.parentElement.classList.add('placeholder');this.parentElement.innerHTML='${categoryIcon(e.category)}'"></div>`
    : `<div class="detail-portrait placeholder">${categoryIcon(e.category)}</div>`;

  const tags = splitList(e.tags);
  const relations = splitList(e.relations);
  const relHtml = relations.map((name) => {
    const target = state.entries.find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
    return target
      ? `<button class="relation" data-entry="${attr(target.id)}">${categoryIcon(target.category)} ${escapeHtml(name)}</button>`
      : `<span class="relation missing">✧ ${escapeHtml(name)}</span>`;
  }).join("");

  return `
    <div class="detail">
      <button class="detail-back" data-action="back">← Volver a ${escapeHtml(categoryLabel(e.category))}</button>
      <div class="detail-hero">
        ${portrait}
        <div class="detail-headinfo">
          <div class="detail-cat">${categoryIcon(e.category)} ${escapeHtml(categoryLabel(e.category))}</div>
          <h1>${escapeHtml(e.name || "Sin nombre")}</h1>
          ${e.summary ? `<div class="detail-summary">${escapeHtml(e.summary)}</div>` : ""}
          <div class="detail-actions">
            <button class="btn" data-action="edit" data-id="${attr(e.id)}">✎ Editar</button>
            <button class="btn btn-danger" data-action="delete" data-id="${attr(e.id)}">🗑 Eliminar</button>
          </div>
        </div>
      </div>
      ${tags.length ? `<div class="detail-tags">${tags.map((t) => `<span class="chip tag" data-tag="${attr(t)}" data-gotocat="${attr(e.category)}">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      <div class="prose">${renderMarkdown(e.body)}</div>
      ${relations.length ? `<div class="detail-relations"><h3>✦ Conexiones</h3><div class="relation-list">${relHtml}</div></div>` : ""}
      <div class="detail-meta">
        ${e.author ? `<span>✍ ${escapeHtml(e.author)}</span>` : ""}
        ${e.createdAt ? `<span>Creado ${timeAgo(e.createdAt)}</span>` : ""}
        ${e.updatedAt && e.updatedAt !== e.createdAt ? `<span>Editado ${timeAgo(e.updatedAt)}</span>` : ""}
      </div>
    </div>`;
}

/* ============================================================
   Navegación / eventos
   ============================================================ */
function go(view) { state.view = view; state.search = ""; if (view.type !== "category") state.activeTag = null; render(); window.scrollTo(0, 0); }

function bindShell() {
  // sidebar nav
  app.querySelectorAll("[data-cat]").forEach((el) =>
    el.addEventListener("click", () => { state.activeTag = null; go({ type: "category", category: el.dataset.cat }); closeMenu(); }));
  app.querySelectorAll('[data-nav="home"]').forEach((el) =>
    el.addEventListener("click", () => go({ type: "category", category: CONFIG.categories[0].id })));

  const main = $("#main");
  // delegación de clics en el main
  main.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-action], [data-entry], [data-tag]");
    if (!t) return;

    if (t.dataset.entry) { go({ type: "entry", id: t.dataset.entry }); return; }

    if (t.dataset.tag != null && !t.dataset.action) {
      if (t.dataset.gotocat) { state.view = { type: "category", category: t.dataset.gotocat }; state.search = ""; }
      state.activeTag = (t.dataset.tag === "__clear__" || (state.activeTag && state.activeTag.toLowerCase() === t.dataset.tag.toLowerCase())) ? null : t.dataset.tag;
      render(); window.scrollTo(0, 0); return;
    }

    const action = t.dataset.action;
    if (action === "new") openEntryModal(null);
    else if (action === "edit") openEntryModal(state.entries.find((x) => x.id === t.dataset.id));
    else if (action === "delete") confirmDelete(t.dataset.id);
    else if (action === "back") go({ type: "category", category: (state.entries.find((x) => x.id === state.view.id) || {}).category || CONFIG.categories[0].id });
    else if (action === "reload") loadEntries();
    else if (action === "settings") openSetupModal(true);
    else if (action === "change-user") openAuthorModal();
    else if (action === "toggle-menu") toggleMenu();
  });

  // buscador
  const search = $("#search-input");
  if (search) {
    search.addEventListener("input", debounce(() => {
      state.search = search.value;
      const focus = document.activeElement === search;
      $("#main").innerHTML = renderMain();
      bindMainOnly();
      if (focus) { const s = $("#search-input"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }, 180));
  }

  // móvil
  const scrim = $("#scrim");
  if (scrim) scrim.addEventListener("click", closeMenu);
}

// re-vincula solo el main tras re-render parcial (búsqueda)
function bindMainOnly() {
  const main = $("#main");
  const search = $("#search-input");
  if (search) {
    search.addEventListener("input", debounce(() => {
      state.search = search.value;
      const focus = document.activeElement === search;
      $("#main").innerHTML = renderMain();
      bindMainOnly();
      if (focus) { const s = $("#search-input"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }, 180));
  }
  main.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-action], [data-entry], [data-tag]");
    if (!t) return;
    if (t.dataset.entry) { go({ type: "entry", id: t.dataset.entry }); return; }
    if (t.dataset.tag != null && !t.dataset.action) {
      if (t.dataset.gotocat) { state.view = { type: "category", category: t.dataset.gotocat }; state.search = ""; }
      state.activeTag = state.activeTag === t.dataset.tag ? null : t.dataset.tag; render(); window.scrollTo(0, 0); return;
    }
    const action = t.dataset.action;
    if (action === "new") openEntryModal(null);
    else if (action === "reload") loadEntries();
    else if (action === "toggle-menu") toggleMenu();
  }, { once: true });
}

function toggleMenu() { $("#sidebar")?.classList.toggle("open"); $("#scrim")?.classList.toggle("show"); }
function closeMenu() { $("#sidebar")?.classList.remove("open"); $("#scrim")?.classList.remove("show"); }

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ============================================================
   Modales
   ============================================================ */
function closeModal() { modalRoot.innerHTML = ""; }
modalRoot.addEventListener("click", (ev) => { if (ev.target.classList.contains("modal-overlay")) closeModal(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeModal(); });

function overlay(inner) { modalRoot.innerHTML = `<div class="modal-overlay">${inner}</div>`; }

/* ---------- Configuración / conexión ---------- */
function openSetupModal(fromSettings) {
  overlay(`
    <div class="modal">
      <div class="modal-head">
        <h2>⚙️ Conexión con la base de datos</h2>
        <p>Los datos se guardan en una Hoja de Google a través de un script. Pegá acá la URL de tu "app web".</p>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>URL del script (Apps Script)</label>
          <input id="cfg-url" type="url" placeholder="https://script.google.com/macros/s/AKfy…/exec" value="${attr(state.apiUrl)}" />
          <span class="sub-hint">Termina en <code>/exec</code>. Ver instrucciones en el README del proyecto.</span>
        </div>
        <div class="field">
          <label>Contraseña compartida</label>
          <input id="cfg-secret" type="password" placeholder="La clave que definiste en el script" value="${attr(state.secret)}" />
          <span class="sub-hint">Es la misma que pusieron en el código del script. Se guarda solo en este navegador.</span>
        </div>
        <div class="form-err" id="cfg-err"></div>
      </div>
      <div class="modal-foot">
        ${fromSettings ? `<button class="btn btn-ghost" data-x>Cancelar</button>` : ""}
        <button class="btn btn-gold" id="cfg-save">Conectar</button>
      </div>
    </div>`);

  modalRoot.querySelector("[data-x]")?.addEventListener("click", closeModal);
  $("#cfg-save").addEventListener("click", async () => {
    const url = $("#cfg-url").value.trim();
    const secret = $("#cfg-secret").value;
    const err = $("#cfg-err");
    if (!/^https:\/\/script\.google\.com\/.*\/exec$/.test(url)) {
      err.textContent = "La URL debe ser la de la app web de Apps Script y terminar en /exec."; return;
    }
    const btn = $("#cfg-save"); btn.disabled = true; btn.textContent = "Probando…"; err.textContent = "";
    // probar conexión
    const prev = { apiUrl: state.apiUrl, secret: state.secret };
    state.apiUrl = url; state.secret = secret;
    try {
      await apiList();
      localStorage.setItem(LS.apiUrl, url);
      localStorage.setItem(LS.secret, secret);
      closeModal();
      if (!state.author) { openAuthorModal(true); } else { loadEntries(); }
    } catch (e) {
      state.apiUrl = prev.apiUrl; state.secret = prev.secret;
      err.textContent = "No se pudo conectar: " + normalizeErr(e);
      btn.disabled = false; btn.textContent = "Conectar";
    }
  });
}

/* ---------- ¿Quién sos? ---------- */
function openAuthorModal(thenLoad) {
  overlay(`
    <div class="modal narrow">
      <div class="modal-head"><h2>✍ ¿Quién sos?</h2>
        <p>Tu nombre se guarda junto a las entradas que crees. Podés cambiarlo cuando quieras.</p></div>
      <div class="modal-body">
        <div class="field">
          <label>Tu nombre</label>
          <input id="au-name" type="text" placeholder="Ej: Joaquín" value="${attr(state.author)}" maxlength="40" />
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-gold" id="au-save">Guardar</button>
      </div>
    </div>`);
  const save = () => {
    const v = $("#au-name").value.trim();
    if (!v) { $("#au-name").focus(); return; }
    state.author = v; localStorage.setItem(LS.author, v);
    closeModal();
    if (thenLoad) loadEntries(); else render();
  };
  $("#au-save").addEventListener("click", save);
  $("#au-name").addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
  setTimeout(() => $("#au-name")?.focus(), 50);
}

/* ---------- Crear / editar entrada ---------- */
function openEntryModal(entry) {
  if (state.readOnly) { toast("Estás en modo solo-lectura (sin conexión).", "err"); return; }
  const isEdit = !!entry;
  const e = entry || { category: (state.view.type === "category" ? state.view.category : CONFIG.categories[0].id) };

  overlay(`
    <div class="modal">
      <div class="modal-head"><h2>${isEdit ? "✎ Editar entrada" : "✦ Nueva entrada"}</h2></div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field">
            <label>Categoría</label>
            <select id="f-cat">${CONFIG.categories.map((c) => `<option value="${c.id}" ${c.id === e.category ? "selected" : ""}>${c.icon} ${escapeHtml(c.label)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Nombre <span class="hint">*</span></label>
            <input id="f-name" type="text" value="${attr(e.name)}" placeholder="Nombre de la entrada" maxlength="120" />
          </div>
        </div>
        <div class="field">
          <label>Resumen <span class="hint">(una línea)</span></label>
          <input id="f-summary" type="text" value="${attr(e.summary)}" placeholder="Descripción corta que aparece en la tarjeta" maxlength="200" />
        </div>
        <div class="field">
          <label>Descripción <span class="hint">(admite Markdown: **negrita**, # títulos, - listas, [links](url))</span></label>
          <textarea id="f-body" placeholder="Contá todo lo que quieras sobre esto…">${escapeHtml(e.body)}</textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Etiquetas <span class="hint">(separadas por coma)</span></label>
            <input id="f-tags" type="text" value="${attr(e.tags)}" placeholder="protagonista, reino del norte, magia" />
          </div>
          <div class="field">
            <label>Conexiones <span class="hint">(nombres, por coma)</span></label>
            <input id="f-relations" type="text" value="${attr(e.relations)}" placeholder="Otro personaje, Una ciudad" />
          </div>
        </div>
        <div class="field">
          <label>URL de imagen <span class="hint">(opcional)</span></label>
          <input id="f-image" type="url" value="${attr(e.imageUrl)}" placeholder="https://… (link directo a una imagen)" />
        </div>
        <div class="form-err" id="f-err"></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-x>Cancelar</button>
        <button class="btn btn-gold" id="f-save">${isEdit ? "Guardar cambios" : "Crear entrada"}</button>
      </div>
    </div>`);

  modalRoot.querySelector("[data-x]").addEventListener("click", closeModal);
  setTimeout(() => $("#f-name")?.focus(), 50);

  $("#f-save").addEventListener("click", async () => {
    const payload = {
      category: $("#f-cat").value,
      name: $("#f-name").value.trim(),
      summary: $("#f-summary").value.trim(),
      body: $("#f-body").value,
      tags: $("#f-tags").value.trim(),
      relations: $("#f-relations").value.trim(),
      imageUrl: $("#f-image").value.trim(),
      author: state.author || "Anónimo",
    };
    const err = $("#f-err");
    if (!payload.name) { err.textContent = "El nombre es obligatorio."; return; }

    const btn = $("#f-save"); btn.disabled = true; btn.textContent = "Guardando…"; err.textContent = "";
    try {
      if (isEdit) {
        const res = await apiWrite("update", { entry: { ...payload, id: e.id, author: e.author || payload.author, createdAt: e.createdAt } });
        const saved = res.entry;
        const idx = state.entries.findIndex((x) => x.id === e.id);
        if (idx >= 0) state.entries[idx] = saved;
        closeModal(); toast("Entrada actualizada", "ok"); go({ type: "entry", id: saved.id });
      } else {
        const res = await apiWrite("create", { entry: payload });
        state.entries.push(res.entry);
        closeModal(); toast("Entrada creada", "ok"); go({ type: "entry", id: res.entry.id });
      }
      localStorage.setItem(LS.cache, JSON.stringify(state.entries));
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
  overlay(`
    <div class="modal narrow">
      <div class="modal-head"><h2>🗑 Eliminar entrada</h2>
        <p>¿Seguro que querés eliminar <strong>${escapeHtml(e.name)}</strong>? Esta acción no se puede deshacer.</p></div>
      <div class="modal-body"><div class="form-err" id="del-err"></div></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-x>Cancelar</button>
        <button class="btn btn-danger" id="del-yes">Sí, eliminar</button>
      </div>
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
  el.className = "toast " + kind;
  el.textContent = msg;
  toastWrap.appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 320); }, 2600);
}

/* ============================================================
   Arranque
   ============================================================ */
function boot() {
  if (!apiConfigured()) { renderShell(); openSetupModal(); return; }
  if (!state.author) { renderShell(); openAuthorModal(true); return; }
  loadEntries();
}
boot();
