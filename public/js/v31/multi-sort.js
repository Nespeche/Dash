/* =============================================================================
   multi-sort.js — v31
   -----------------------------------------------------------------------------
   Permite ordenar tablas por múltiples columnas manteniendo Shift+Click.
   Es una mejora no-invasiva: no reemplaza el sort existente, sólo captura
   shift+click antes de que el evento llegue al handler original, guarda el
   orden multi-nivel en memoria y re-aplica el sort al DOM.

   Aplica a las tablas con <thead><tr><th> que ya tienen algún indicador de
   sort (o no). Usamos el atributo data-v31-multi en el <th> para marcar las
   columnas, y la tabla para marcar la scope.

   Como extra, agrega tooltips tipo ⓘ cuando hay multi-sort activo mostrando
   el orden de prioridad (1., 2., 3.).
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31MultiSort) return;
  window.__v31MultiSort = true;

  // Estado por tabla: WeakMap<table, { stack: [{key, direction}] }>
  const stateByTable = new WeakMap();

  function getThKey(th) {
    return th.dataset.sortKey ||
           th.dataset.key ||
           String(th.textContent || "").trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) ||
           "";
  }

  function ensureState(table) {
    let state = stateByTable.get(table);
    if (!state) {
      state = { stack: [] };
      stateByTable.set(table, state);
    }
    return state;
  }

  function applyVisualIndicators(table, stack) {
    if (!table) return;
    const ths = table.querySelectorAll("thead th");
    ths.forEach(th => {
      // Limpiar indicadores v31
      const existing = th.querySelector(".v31-sort-badge");
      if (existing) existing.remove();
      th.classList.remove("v31-sort-active");
    });
    if (stack.length < 2) return; // Sólo mostramos badges cuando hay multi
    stack.forEach((item, idx) => {
      const th = Array.from(ths).find(t => getThKey(t) === item.key);
      if (!th) return;
      th.classList.add("v31-sort-active");
      const badge = document.createElement("span");
      badge.className = "v31-sort-badge";
      badge.textContent = String(idx + 1);
      badge.setAttribute("aria-label", `Orden ${idx + 1} (${item.direction})`);
      badge.title = `Orden ${idx + 1} · ${item.direction === "asc" ? "asc" : "desc"}`;
      th.appendChild(badge);
    });
  }

  /**
   * Ordena el <tbody> de la tabla según el stack multi-nivel.
   * Compara por texto normalizado (números detectados automáticamente).
   * Este sort es in-place, no refetchea del backend; es un "secondary sort"
   * sobre lo que ya está en el DOM.
   */
  function reorderBody(table, stack) {
    if (!table || !stack.length) return;
    const tbody = table.querySelector("tbody");
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll(":scope > tr")).filter(row => !row.classList.contains("skeleton-row"));
    if (rows.length < 2) return;

    const headerThs = Array.from(table.querySelectorAll("thead th"));
    const keyToIndex = new Map();
    headerThs.forEach((th, i) => keyToIndex.set(getThKey(th), i));

    // Detección simple de si una celda es numérica
    const parseCell = text => {
      const raw = String(text || "").trim();
      if (!raw) return { n: -Infinity, s: "" };
      // Remover separadores de miles (punto en AR) y normalizar coma decimal
      const cleaned = raw.replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.\-]/g, "");
      const n = Number(cleaned);
      return { n: Number.isFinite(n) ? n : null, s: raw.toLocaleLowerCase("es-AR") };
    };

    rows.sort((a, b) => {
      for (const item of stack) {
        const idx = keyToIndex.get(item.key);
        if (idx == null) continue;
        const cellA = parseCell(a.children[idx]?.textContent);
        const cellB = parseCell(b.children[idx]?.textContent);
        let cmp = 0;
        if (cellA.n != null && cellB.n != null) {
          cmp = cellA.n - cellB.n;
        } else {
          cmp = cellA.s.localeCompare(cellB.s, "es-AR");
        }
        if (cmp !== 0) return item.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });

    // Re-adjuntar en nuevo orden (preserva listeners)
    const frag = document.createDocumentFragment();
    rows.forEach(r => frag.appendChild(r));
    tbody.appendChild(frag);
  }

  function handleThClick(ev) {
    if (!ev.shiftKey) {
      // Sin shift: limpiamos el stack multi y dejamos que el sort nativo actúe.
      // No llamamos preventDefault.
      const th = ev.target.closest("th");
      if (!th) return;
      const table = th.closest("table");
      if (!table) return;
      const state = ensureState(table);
      state.stack = [];
      // Quitamos indicadores visuales
      applyVisualIndicators(table, state.stack);
      return;
    }
    // Con Shift: tomamos control
    const th = ev.target.closest("th");
    if (!th) return;
    const table = th.closest("table");
    if (!table) return;

    const key = getThKey(th);
    if (!key) return;

    // Prevenir comportamiento default del header (que reordenaría primary)
    ev.preventDefault();
    ev.stopPropagation();

    const state = ensureState(table);
    const existing = state.stack.find(x => x.key === key);
    if (existing) {
      // Alternar dirección
      existing.direction = existing.direction === "asc" ? "desc" : "asc";
    } else {
      state.stack.push({ key, direction: "desc" });
      if (state.stack.length > 3) state.stack.shift(); // Limitar a 3 niveles
    }
    applyVisualIndicators(table, state.stack);
    reorderBody(table, state.stack);
  }

  // Instalar en cada tabla .responsive-stack o .acsum-table o .acum-table
  function attachTo(table) {
    if (!table || table.dataset.v31Multi === "1") return;
    table.dataset.v31Multi = "1";
    const thead = table.querySelector("thead");
    if (!thead) return;
    thead.addEventListener("click", handleThClick, true); // captura para llegar antes que los listeners existentes
  }

  function scanAll() {
    const tables = document.querySelectorAll(
      "table.responsive-stack, table.acsum-table, table.acum-table"
    );
    tables.forEach(attachTo);
  }

  function installObserver() {
    const obs = new MutationObserver(() => {
      // Scan simple cuando algo cambia; es O(n) y n es pequeño
      scanAll();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function installStyles() {
    if (document.getElementById("v31-multisort-css")) return;
    const s = document.createElement("style");
    s.id = "v31-multisort-css";
    s.textContent = `
      .v31-sort-active { position: relative; }
      .v31-sort-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        margin-left: 4px;
        font: 700 9px/1 'DM Sans', sans-serif;
        color: var(--acc);
        background: var(--acc-soft, rgba(251, 191, 36, 0.14));
        border: 1px solid var(--intent-warning-border, rgba(251, 191, 36, 0.30));
        border-radius: 999px;
        vertical-align: middle;
      }
    `;
    document.head.appendChild(s);
  }

  function boot() {
    installStyles();
    scanAll();
    installObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
