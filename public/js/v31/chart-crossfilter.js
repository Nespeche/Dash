/* =============================================================================
   chart-crossfilter.js — v31
   -----------------------------------------------------------------------------
   Cross-filter: al hacer clic en una barra/slice de los gráficos de la
   pestaña Gráficos, aplica el filtro correspondiente al tablero.

   Mapeo de contenedores:
     #gGrupo  → filter select sGrp  (por nombre mostrado, si el select lo
                                     tiene como opción)
     #gMarca  → filter select sMrc
     #gAgte   → filter select sAgte (requiere mapeo nombre→código, omitimos
                                     si no podemos resolver)
     #gClie   → no filtramos con seguridad (los nombres pueden ambiguar)
     #gDonut  → filter select sGrp

   No toca charts.js. Usa event delegation y dispatcha un change event al
   select para que el filter-controller existente propague.
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31CrossFilter) return;
  window.__v31CrossFilter = true;

  // Contenedor → select a actualizar
  const MAP = {
    "gGrupo": "sGrp",
    "gDonut": "sGrp",
    "gMarca": "sMrc"
  };

  function extractNameFromBar(row) {
    // El nombre está dentro de .hb-name > <span>. El primer span es el rank icon
    // si existe, y el segundo (o único) es el nombre.
    const nameEl = row.querySelector(".hb-name");
    if (!nameEl) return "";
    const spans = nameEl.querySelectorAll(":scope > span");
    if (!spans.length) return (nameEl.textContent || "").trim();
    // Evitar el rank icon (🥇🥈🥉)
    for (const s of spans) {
      const txt = (s.textContent || "").trim();
      if (txt && !/^[🥇🥈🥉]$/.test(txt)) return txt;
    }
    return (nameEl.textContent || "").trim();
  }

  function extractNameFromDonutLegend(item) {
    // Donut legend items pueden tener estructura similar
    const nameEl = item.querySelector(".dl-name") || item;
    return (nameEl.textContent || "").replace(/^\s*[•·●]\s*/, "").trim();
  }

  function findOptionValueByName(selectEl, name) {
    if (!selectEl || !name) return null;
    const normalized = name.toLowerCase().trim();
    const opts = Array.from(selectEl.options || []);
    // Match exacto
    let opt = opts.find(o => (o.textContent || "").trim().toLowerCase() === normalized);
    if (opt) return opt.value;
    // Match por valor
    opt = opts.find(o => (o.value || "").trim().toLowerCase() === normalized);
    if (opt) return opt.value;
    // Match por inclusión (fuzzy)
    opt = opts.find(o => {
      const t = (o.textContent || "").trim().toLowerCase();
      return t && (t.includes(normalized) || normalized.includes(t));
    });
    return opt ? opt.value : null;
  }

  function applyFilter(selectId, name) {
    const sel = document.getElementById(selectId);
    if (!sel) return false;
    const value = findOptionValueByName(sel, name);
    if (!value) return false;
    if (sel.value === value) {
      // Ya filtrado, tal vez limpiar (toggle)
      sel.value = "";
    } else {
      sel.value = value;
    }
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function toast(msg, kind = "info") {
    const el = document.createElement("div");
    el.className = "ux-toast";
    el.textContent = msg;
    if (kind === "warn") el.style.borderColor = "var(--intent-warning-border, rgba(251, 191, 36, 0.30))";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  function handleBarClick(ev, containerId) {
    const row = ev.target.closest(".hb-row");
    if (!row) return;
    const name = extractNameFromBar(row);
    if (!name) return;
    const selectId = MAP[containerId];
    if (!selectId) return;
    if (applyFilter(selectId, name)) {
      toast(`Filtro aplicado: ${name}`);
    } else {
      toast(`No encuentro "${name}" en el selector`, "warn");
    }
  }

  function handleDonutClick(ev) {
    // El donut puede tener .dlegend con items o ser clicable en los slices SVG.
    // Manejamos ambos: slice o leyenda.
    const legendItem = ev.target.closest(".dl-item, .dlegend li, [data-donut-name]");
    if (legendItem) {
      const name = legendItem.dataset.donutName || extractNameFromDonutLegend(legendItem);
      if (name) {
        if (applyFilter("sGrp", name)) toast(`Filtro aplicado: ${name}`);
        else toast(`No encuentro "${name}" en el selector`, "warn");
      }
      return;
    }
    // Slice SVG
    const slice = ev.target.closest("circle[data-donut-name], path[data-donut-name]");
    if (slice) {
      const name = slice.getAttribute("data-donut-name");
      if (name && applyFilter("sGrp", name)) {
        toast(`Filtro aplicado: ${name}`);
      }
    }
  }

  function installCursorHintStyle() {
    if (document.getElementById("v31-crossfilter-css")) return;
    const s = document.createElement("style");
    s.id = "v31-crossfilter-css";
    s.textContent = `
      #gGrupo .hb-row, #gMarca .hb-row, #gDonut [data-donut-name] {
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease;
      }
      #gGrupo .hb-row:hover, #gMarca .hb-row:hover {
        transform: translateX(1px);
        opacity: 0.95;
      }
      #gGrupo .hb-row::after, #gMarca .hb-row::after {
        content: "⇥";
        position: absolute;
        right: -2px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 11px;
        color: var(--acc);
        opacity: 0;
        transition: opacity 120ms ease;
        pointer-events: none;
      }
      #gGrupo .hb-row, #gMarca .hb-row { position: relative; }
      #gGrupo .hb-row:hover::after, #gMarca .hb-row:hover::after { opacity: 0.7; }
    `;
    document.head.appendChild(s);
  }

  function bindContainer(containerId) {
    const host = document.getElementById(containerId);
    if (!host || host.dataset.v31Cf === "1") return;
    host.dataset.v31Cf = "1";
    host.addEventListener("click", ev => handleBarClick(ev, containerId));
  }

  function bindDonut() {
    const host = document.getElementById("gDonut");
    if (!host || host.dataset.v31Cf === "1") return;
    host.dataset.v31Cf = "1";
    host.addEventListener("click", handleDonutClick);
  }

  function scanAndBind() {
    Object.keys(MAP).forEach(id => {
      if (id === "gDonut") bindDonut();
      else bindContainer(id);
    });
  }

  function installObserver() {
    // Los gráficos se re-renderean cuando cambian los filtros; rebindeamos.
    const targets = Object.keys(MAP).map(id => document.getElementById(id)).filter(Boolean);
    if (!targets.length) return false;
    const obs = new MutationObserver(() => {
      // Cuando hay mutaciones, asegurar que los binders sigan activos
      // (data-v31-cf se mantiene porque el host mismo no se recrea)
      scanAndBind();
    });
    targets.forEach(t => obs.observe(t, { childList: true, subtree: false }));
    return true;
  }

  function boot() {
    installCursorHintStyle();
    scanAndBind();
    if (!installObserver()) {
      // Reintentar si aún no está la tab de gráficos renderizada
      window.setTimeout(boot, 1200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
