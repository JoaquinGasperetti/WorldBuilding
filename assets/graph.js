/* ============================================================
   WBGraph — Motor de diagramas (sin librerías externas)
   ------------------------------------------------------------
   · buildFlow()      : arma el grafo de escenas a partir de las decisiones
   · mountFlow()      : dibuja el diagrama de flujo (SVG) con zoom y paneo
   · buildRelations() : arma el grafo de relaciones del worldbuilding
   · mountRelations() : dibuja el mapa de relaciones (SVG)
   ============================================================ */
const WBGraph = (function () {
  "use strict";

  /* ---------- Utilidades ---------- */
  // Quita tildes y mayúsculas para comparar nombres sin importar cómo se escriban.
  const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase()
      .normalize("NFD").replace(DIACRITICS, "");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function trunc(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function splitList(str) {
    return String(str || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* ============================================================
     Parseo de decisiones
     Formato por línea:
       Etiqueta -> Escena destino
       Etiqueta -> Escena destino | confianza+1, alice_viva=true
       Etiqueta -> Escena destino | si: alice_viva=true
     ============================================================ */
  function parseChoices(str) {
    return String(str || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(function (line) {
        const parts = line.split("|").map(function (s) { return s.trim(); });
        let effects = "", cond = "";
        for (let i = 1; i < parts.length; i++) {
          const m = parts[i].match(/^(si|cond|condici[oó]n)\s*:\s*(.*)$/i);
          if (m) cond = m[2];
          else effects = (effects ? effects + ", " : "") + parts[i].replace(/^(efectos?|vars?)\s*:\s*/i, "");
        }
        const arrow = parts[0].split(/\s*(?:->|→|=>)\s*/);
        return {
          label:  (arrow[0] || "").trim(),
          target: (arrow[1] || "").trim(),
          effects: effects,
          cond: cond,
          raw: line,
        };
      });
  }

  function sceneTypeOf(entry) {
    const t = norm(entry.sceneType);
    if (t === "inicio" || t === "start") return "inicio";
    if (t === "decision" || t === "decisión") return "decision";
    if (t === "final" || t === "fin" || t === "ending") return "final";
    if (t === "escena") return "escena";
    // Sin tipo explícito: lo inferimos
    const chs = parseChoices(entry.choices);
    if (chs.length > 1) return "decision";
    if (chs.length === 0) return "final";
    return "escena";
  }

  function typeMeta(id) {
    const list = (typeof CONFIG !== "undefined" && CONFIG.sceneTypes) || [];
    return list.filter(function (t) { return t.id === id; })[0] ||
      { id: id, label: id, icon: "•", color: "#8a7bff" };
  }

  /* ============================================================
     Modelo del diagrama de flujo
     ============================================================ */
  function buildFlow(entries, opts) {
    opts = opts || {};
    const sceneCat = opts.sceneCategory || "escenas";
    let scenes = entries.filter(function (e) { return e.category === sceneCat; });

    if (opts.chapter && opts.chapter !== "__all__") {
      scenes = scenes.filter(function (s) { return String(s.chapter || "") === opts.chapter; });
    }

    const byName = new Map();
    scenes.forEach(function (s) { byName.set(norm(s.name), s); });

    const nodes = scenes.map(function (s) {
      return {
        id: s.id,
        entry: s,
        name: s.name || "(sin nombre)",
        type: sceneTypeOf(s),
        sub: s.location || s.chapter || "",
      };
    });
    const nodeById = new Map(nodes.map(function (n) { return [n.id, n]; }));

    const edges = [];
    const warnings = { missingTarget: [], deadEnds: [], orphans: [], noStart: false };

    scenes.forEach(function (s) {
      const chs = parseChoices(s.choices);
      const type = sceneTypeOf(s);
      if (!chs.length && type !== "final") warnings.deadEnds.push(s);

      chs.forEach(function (c, i) {
        if (!c.target) {
          warnings.missingTarget.push({ from: s, choice: c, reason: "la opción no indica a qué escena lleva" });
          return;
        }
        const t = byName.get(norm(c.target));
        if (!t) {
          warnings.missingTarget.push({ from: s, choice: c, reason: "no existe una escena llamada “" + c.target + "”" });
          return;
        }
        edges.push({
          id: s.id + "->" + t.id + "#" + i,
          from: s.id, to: t.id,
          label: c.label || "(sin texto)",
          effects: c.effects, cond: c.cond,
        });
      });
    });

    const hasIncoming = new Set(edges.map(function (e) { return e.to; }));
    nodes.forEach(function (n) {
      if (!hasIncoming.has(n.id) && n.type !== "inicio") warnings.orphans.push(n.entry);
    });
    warnings.noStart = nodes.length > 0 && !nodes.some(function (n) { return n.type === "inicio"; });

    return { nodes: nodes, edges: edges, warnings: warnings, nodeById: nodeById };
  }

  /* ============================================================
     Layout por capas (Sugiyama simplificado)
     ============================================================ */
  const NODE_W = 208, NODE_H = 66;

  function layoutFlow(model, orientation) {
    const nodes = model.nodes, edges = model.edges;
    if (!nodes.length) return { width: 0, height: 0 };

    const out = {}, inc = {};
    nodes.forEach(function (n) { out[n.id] = []; inc[n.id] = []; });
    edges.forEach(function (e) {
      if (out[e.from] && inc[e.to]) { out[e.from].push(e.to); inc[e.to].push(e.from); }
    });

    // 1) Capas: camino más largo desde las raíces (tolerante a ciclos).
    const layer = {};
    nodes.forEach(function (n) { layer[n.id] = 0; });
    const maxIter = Math.min(nodes.length + 2, 120);
    for (let it = 0; it < maxIter; it++) {
      let changed = false;
      nodes.forEach(function (n) {
        out[n.id].forEach(function (t) {
          if (layer[t] < layer[n.id] + 1) { layer[t] = layer[n.id] + 1; changed = true; }
        });
      });
      if (!changed) break;
    }
    // Las escenas de tipo "final" se empujan al menos una capa después de sus padres
    nodes.forEach(function (n) { if (layer[n.id] > 200) layer[n.id] = 200; });

    // 2) Agrupar por capa
    const layers = [];
    nodes.forEach(function (n) {
      const L = layer[n.id];
      (layers[L] = layers[L] || []).push(n);
    });
    for (let i = 0; i < layers.length; i++) if (!layers[i]) layers[i] = [];

    // 3) Reducir cruces: baricentro, algunas pasadas
    const pos = {};
    layers.forEach(function (arr) { arr.forEach(function (n, i) { pos[n.id] = i; }); });

    function bary(arr, neighborsOf) {
      arr.forEach(function (n) {
        const nb = neighborsOf(n.id).filter(function (id) { return pos[id] != null; });
        n._b = nb.length
          ? nb.reduce(function (a, id) { return a + pos[id]; }, 0) / nb.length
          : pos[n.id];
      });
      arr.sort(function (a, b) { return a._b - b._b; });
      arr.forEach(function (n, i) { pos[n.id] = i; });
    }
    for (let pass = 0; pass < 4; pass++) {
      for (let L = 1; L < layers.length; L++) bary(layers[L], function (id) { return inc[id] || []; });
      for (let L = layers.length - 2; L >= 0; L--) bary(layers[L], function (id) { return out[id] || []; });
    }

    // 4) Coordenadas
    const vertical = orientation !== "horizontal";
    const GAP_MAIN  = vertical ? 108 : 120;  // separación entre capas
    const GAP_CROSS = vertical ? 30  : 26;   // separación dentro de la capa
    const stepCross = (vertical ? NODE_W : NODE_H) + GAP_CROSS;
    const stepMain  = (vertical ? NODE_H : NODE_W) + GAP_MAIN;

    const widest = layers.reduce(function (m, a) { return Math.max(m, a.length); }, 0);
    const crossSpan = widest * stepCross;

    layers.forEach(function (arr, L) {
      const span = arr.length * stepCross;
      const offset = (crossSpan - span) / 2;
      arr.forEach(function (n, i) {
        const cross = offset + i * stepCross + GAP_CROSS / 2;
        const main = L * stepMain;
        if (vertical) { n.x = cross; n.y = main; }
        else          { n.x = main;  n.y = cross; }
        n.w = NODE_W; n.h = NODE_H; n.layer = L;
      });
    });

    const width  = vertical ? crossSpan : layers.length * stepMain;
    const height = vertical ? layers.length * stepMain : crossSpan;
    return { width: width + 40, height: height + 40, layers: layers.length };
  }

  /* ============================================================
     Dibujo del diagrama de flujo
     ============================================================ */
  function edgePath(a, b, vertical) {
    let x1, y1, x2, y2;
    if (vertical) {
      x1 = a.x + a.w / 2; y1 = a.y + a.h;
      x2 = b.x + b.w / 2; y2 = b.y;
      const d = Math.max(28, (y2 - y1) / 2);
      return { d: "M" + x1 + "," + y1 + " C" + x1 + "," + (y1 + d) + " " + x2 + "," + (y2 - d) + " " + x2 + "," + y2,
               mx: (x1 + 3 * x1 + 3 * x2 + x2) / 8, my: (y1 + 3 * (y1 + d) + 3 * (y2 - d) + y2) / 8 };
    }
    x1 = a.x + a.w; y1 = a.y + a.h / 2;
    x2 = b.x;       y2 = b.y + b.h / 2;
    const d = Math.max(28, (x2 - x1) / 2);
    return { d: "M" + x1 + "," + y1 + " C" + (x1 + d) + "," + y1 + " " + (x2 - d) + "," + y2 + " " + x2 + "," + y2,
             mx: (x1 + 3 * (x1 + d) + 3 * (x2 - d) + x2) / 8, my: (y1 + 3 * y1 + 3 * y2 + y2) / 8 };
  }

  function nodeSVG(n) {
    const meta = typeMeta(n.type);
    const cls = "fnode fnode-" + n.type;
    const title = trunc(n.name, 24);
    const sub = n.sub ? trunc(n.sub, 26) : "";
    return '' +
      '<g class="' + cls + '" data-node="' + esc(n.id) + '" transform="translate(' + n.x + ',' + n.y + ')">' +
        '<title>' + esc(n.name) + (n.sub ? " — " + esc(n.sub) : "") + '</title>' +
        '<rect class="fnode-box" x="0" y="0" width="' + n.w + '" height="' + n.h + '" rx="12"/>' +
        '<rect class="fnode-bar" x="0" y="0" width="5" height="' + n.h + '" rx="2.5" fill="' + meta.color + '"/>' +
        '<text class="fnode-ico" x="' + (n.w - 14) + '" y="21" text-anchor="end">' + esc(meta.icon) + '</text>' +
        '<text class="fnode-title" x="16" y="' + (sub ? 28 : 38) + '">' + esc(title) + '</text>' +
        (sub ? '<text class="fnode-sub" x="16" y="47">' + esc(sub) + '</text>' : "") +
      '</g>';
  }

  function mountFlow(container, model, opts, handlers) {
    opts = opts || {}; handlers = handlers || {};
    const vertical = (opts.orientation || "vertical") !== "horizontal";
    const size = layoutFlow(model, opts.orientation);

    if (!model.nodes.length) { container.innerHTML = ""; return null; }

    let edgesSVG = "", labelsSVG = "";
    model.edges.forEach(function (e) {
      const a = model.nodeById.get(e.from), b = model.nodeById.get(e.to);
      if (!a || !b) return;
      const p = edgePath(a, b, vertical);
      edgesSVG += '<path class="fedge" data-edge="' + esc(e.id) + '" data-from="' + esc(e.from) +
                  '" data-to="' + esc(e.to) + '" d="' + p.d + '" marker-end="url(#arrow)"/>';
      const label = trunc(e.label, 22);
      const wpx = Math.max(28, label.length * 6.1 + 14);
      labelsSVG += '<g class="felabel" data-edge="' + esc(e.id) + '" transform="translate(' + p.mx + ',' + p.my + ')">' +
                     '<title>' + esc(e.label) + (e.cond ? "\nSi: " + esc(e.cond) : "") + (e.effects ? "\nEfectos: " + esc(e.effects) : "") + '</title>' +
                     '<rect x="' + (-wpx / 2) + '" y="-10" width="' + wpx + '" height="20" rx="10"/>' +
                     '<text x="0" y="4" text-anchor="middle">' + esc(label) + '</text>' +
                     (e.cond ? '<circle class="fcond" cx="' + (wpx / 2 - 2) + '" cy="-8" r="4"><title>Condicional</title></circle>' : "") +
                   '</g>';
    });

    const nodesSVG = model.nodes.map(nodeSVG).join("");

    container.innerHTML =
      '<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
          '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
            '<path d="M0,0 L10,5 L0,10 z" class="farrow"/>' +
          '</marker>' +
        '</defs>' +
        '<g class="flow-viewport">' +
          '<g class="flow-edges">' + edgesSVG + '</g>' +
          '<g class="flow-labels">' + labelsSVG + '</g>' +
          '<g class="flow-nodes">' + nodesSVG + '</g>' +
        '</g>' +
      '</svg>';

    const svg = container.querySelector("svg");
    const vp = svg.querySelector(".flow-viewport");
    const view = { k: 1, tx: 0, ty: 0 };

    function apply() {
      vp.setAttribute("transform", "translate(" + view.tx + "," + view.ty + ") scale(" + view.k + ")");
      if (handlers.onZoom) handlers.onZoom(view.k);
    }
    function fit() {
      const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
      const k = Math.min(cw / (size.width + 60), ch / (size.height + 60), 1.15);
      view.k = Math.max(0.12, k);
      view.tx = (cw - size.width * view.k) / 2 + 20 * view.k;
      view.ty = 24;
      apply();
    }
    function zoomBy(f, cx, cy) {
      const k2 = Math.min(2.2, Math.max(0.12, view.k * f));
      const cw = cx == null ? container.clientWidth / 2 : cx;
      const chh = cy == null ? container.clientHeight / 2 : cy;
      view.tx = cw - (cw - view.tx) * (k2 / view.k);
      view.ty = chh - (chh - view.ty) * (k2 / view.k);
      view.k = k2; apply();
    }

    // --- Paneo con arrastre ---
    let dragging = false, sx = 0, sy = 0, moved = false;
    svg.addEventListener("mousedown", function (ev) {
      if (ev.button !== 0) return;
      dragging = true; moved = false;
      sx = ev.clientX - view.tx; sy = ev.clientY - view.ty;
      svg.classList.add("grabbing");
    });
    window.addEventListener("mousemove", function (ev) {
      if (!dragging) return;
      const nx = ev.clientX - sx, ny = ev.clientY - sy;
      if (Math.abs(nx - view.tx) + Math.abs(ny - view.ty) > 3) moved = true;
      view.tx = nx; view.ty = ny; apply();
    });
    window.addEventListener("mouseup", function () { dragging = false; svg.classList.remove("grabbing"); });

    // --- Zoom con rueda ---
    svg.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      const r = container.getBoundingClientRect();
      zoomBy(ev.deltaY < 0 ? 1.13 : 1 / 1.13, ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    // --- Interacción con los nodos ---
    svg.addEventListener("click", function (ev) {
      const g = ev.target.closest("[data-node]");
      if (!g || moved) return;
      if (handlers.onNodeClick) handlers.onNodeClick(g.getAttribute("data-node"));
    });
    svg.addEventListener("mouseover", function (ev) {
      const g = ev.target.closest("[data-node]");
      if (!g) return;
      const id = g.getAttribute("data-node");
      svg.classList.add("has-hl");
      svg.querySelectorAll(".fedge").forEach(function (p) {
        const on = p.getAttribute("data-from") === id || p.getAttribute("data-to") === id;
        p.classList.toggle("hl", on);
        const lbl = svg.querySelector('.felabel[data-edge="' + CSS.escape(p.getAttribute("data-edge")) + '"]');
        if (lbl) lbl.classList.toggle("hl", on);
      });
      g.classList.add("hl");
    });
    svg.addEventListener("mouseout", function (ev) {
      const g = ev.target.closest("[data-node]");
      if (!g) return;
      svg.classList.remove("has-hl");
      svg.querySelectorAll(".hl").forEach(function (el) { el.classList.remove("hl"); });
    });

    fit();
    return { fit: fit, zoomIn: function () { zoomBy(1.25); }, zoomOut: function () { zoomBy(1 / 1.25); }, size: size };
  }

  /* ============================================================
     Mapa de relaciones (worldbuilding) — layout dirigido por fuerzas
     ============================================================ */
  function buildRelations(entries, opts) {
    opts = opts || {};
    const skip = new Set(opts.exclude || ["escenas", "capitulos", "variables"]);
    const pool = entries.filter(function (e) { return !skip.has(e.category); });
    const byName = new Map();
    pool.forEach(function (e) { byName.set(norm(e.name), e); });

    const nodes = pool.map(function (e) { return { id: e.id, entry: e, name: e.name || "?", category: e.category, deg: 0 }; });
    const nodeById = new Map(nodes.map(function (n) { return [n.id, n]; }));
    const seen = new Set();
    const links = [];

    pool.forEach(function (e) {
      splitList(e.relations).forEach(function (name) {
        const t = byName.get(norm(name));
        if (!t || t.id === e.id) return;
        const key = [e.id, t.id].sort().join("|");
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ source: e.id, target: t.id });
        nodeById.get(e.id).deg++; nodeById.get(t.id).deg++;
      });
    });
    return { nodes: nodes, links: links, nodeById: nodeById };
  }

  function mountRelations(container, model, handlers) {
    handlers = handlers || {};
    const nodes = model.nodes, links = model.links;
    if (!nodes.length) { container.innerHTML = ""; return null; }

    const W = 1200, H = 820;
    // posición inicial en círculo (determinista → mismo dibujo siempre)
    nodes.forEach(function (n, i) {
      const a = (i / nodes.length) * Math.PI * 2;
      n.x = W / 2 + Math.cos(a) * (Math.min(W, H) / 2.6);
      n.y = H / 2 + Math.sin(a) * (Math.min(W, H) / 2.6);
      n.vx = 0; n.vy = 0;
      n.r = 16 + Math.min(14, n.deg * 2.2);
    });
    const idx = new Map(nodes.map(function (n) { return [n.id, n]; }));

    // Simulación de fuerzas
    const ITER = nodes.length > 90 ? 180 : 320;
    for (let it = 0; it < ITER; it++) {
      const t = 1 - it / ITER;
      // repulsión
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = (Math.random() - .5); dy = (Math.random() - .5); d2 = 1; }
          const d = Math.sqrt(d2);
          const rep = 5200 / d2;
          const fx = (dx / d) * rep, fy = (dy / d) * rep;
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
      // resortes
      links.forEach(function (l) {
        const a = idx.get(l.source), b = idx.get(l.target);
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const f = (d - 132) * 0.045;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      });
      // centrado + integración
      nodes.forEach(function (n) {
        n.vx += (W / 2 - n.x) * 0.0035;
        n.vy += (H / 2 - n.y) * 0.0035;
        n.x += n.vx * 0.55 * t; n.y += n.vy * 0.55 * t;
        n.vx *= 0.82; n.vy *= 0.82;
      });
    }

    // Encuadre
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x - n.r - 60); maxX = Math.max(maxX, n.x + n.r + 60);
      minY = Math.min(minY, n.y - n.r - 30); maxY = Math.max(maxY, n.y + n.r + 30);
    });

    const catColor = {};
    const palette = ["#d8b16a", "#8a7bff", "#6fbf83", "#c8703a", "#5fb6c8", "#c86a9e", "#b0c86a", "#9d97b5"];
    (CONFIG.categories || []).forEach(function (c, i) { catColor[c.id] = palette[i % palette.length]; });

    let linksSVG = "";
    links.forEach(function (l) {
      const a = idx.get(l.source), b = idx.get(l.target);
      if (!a || !b) return;
      linksSVG += '<line class="rlink" data-a="' + esc(a.id) + '" data-b="' + esc(b.id) + '" x1="' + a.x.toFixed(1) +
                  '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '"/>';
    });

    let nodesSVG = "";
    nodes.forEach(function (n) {
      const color = catColor[n.category] || "#9d97b5";
      const icon = ((CONFIG.categories || []).filter(function (c) { return c.id === n.category; })[0] || {}).icon || "•";
      nodesSVG += '<g class="rnode" data-node="' + esc(n.id) + '" transform="translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ')">' +
        '<title>' + esc(n.name) + '</title>' +
        '<circle class="rnode-c" r="' + n.r + '" fill="' + color + '"/>' +
        '<text class="rnode-i" y="5" text-anchor="middle" font-size="' + Math.round(n.r * .95) + '">' + esc(icon) + '</text>' +
        '<text class="rnode-t" y="' + (n.r + 15) + '" text-anchor="middle">' + esc(trunc(n.name, 18)) + '</text>' +
      '</g>';
    });

    container.innerHTML =
      '<svg class="rel-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' +
        minX.toFixed(0) + ' ' + minY.toFixed(0) + ' ' + (maxX - minX).toFixed(0) + ' ' + (maxY - minY).toFixed(0) + '">' +
        '<g class="rel-links">' + linksSVG + '</g>' +
        '<g class="rel-nodes">' + nodesSVG + '</g>' +
      '</svg>';

    const svg = container.querySelector("svg");
    svg.addEventListener("click", function (ev) {
      const g = ev.target.closest("[data-node]");
      if (g && handlers.onNodeClick) handlers.onNodeClick(g.getAttribute("data-node"));
    });
    svg.addEventListener("mouseover", function (ev) {
      const g = ev.target.closest("[data-node]");
      if (!g) return;
      const id = g.getAttribute("data-node");
      svg.classList.add("has-hl");
      svg.querySelectorAll(".rlink").forEach(function (l) {
        l.classList.toggle("hl", l.getAttribute("data-a") === id || l.getAttribute("data-b") === id);
      });
      g.classList.add("hl");
    });
    svg.addEventListener("mouseout", function () {
      svg.classList.remove("has-hl");
      svg.querySelectorAll(".hl").forEach(function (el) { el.classList.remove("hl"); });
    });
    return { count: nodes.length, links: links.length };
  }

  return {
    parseChoices: parseChoices,
    sceneTypeOf: sceneTypeOf,
    typeMeta: typeMeta,
    buildFlow: buildFlow,
    mountFlow: mountFlow,
    buildRelations: buildRelations,
    mountRelations: mountRelations,
    norm: norm,
  };
})();
