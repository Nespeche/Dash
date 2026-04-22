/* =============================================================================
   empty-states.js — v31
   -----------------------------------------------------------------------------
   Mejora los empty states del tablero agregando CTA accionable.
   Observa los nodos .empty que renderea app.js y les inyecta botones y copy
   más humano sin reemplazar el flujo original.
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31EmptyStates) return;
  window.__v31EmptyStates = true;

  const EMPTY_PATTERNS = [
    {
      match: /sin datos/i,
      title: "Sin datos para este filtro",
      copy: "Probá ampliar el rango de fechas o quitar alguno de los filtros activos.",
      actions: [
        { label: "Limpiar filtros", onClick: () => document.getElementById("btnClrAll")?.click() },
        { label: "Ver último mes",  onClick: () => document.querySelector('.pbtn[data-p="mes"]')?.click() }
      ]
    },
    {
      match: /cargando/i,
      // Durante carga no inyectamos acciones, solo dejamos el mensaje tal cual
      skip: true
    },
    {
      match: /completá los días hábiles/i,
      title: "Completá la configuración para ver la proyección",
      copy: "Necesito los días hábiles totales del mes y los días transcurridos. Podés editarlos arriba en \"Configuración de proyección\".",
      actions: [
        { label: "Ir a la configuración", onClick: () => document.getElementById("pHabiles")?.focus() }
      ]
    }
  ];

  function findBestMatch(text) {
    for (const rule of EMPTY_PATTERNS) {
      if (rule.skip) continue;
      if (rule.match.test(text)) return rule;
    }
    return null;
  }

  function enhanceEmptyNode(node) {
    if (!node || node.dataset.v31Enhanced === "1") return;
    const copy = String(node.querySelector("p")?.textContent || node.textContent || "").trim();
    if (!copy) return;
    const rule = findBestMatch(copy);
    if (!rule) return;

    // Evitar romper casos donde la UI quiere mantener el spinner de carga
    if (rule.skip) return;

    node.dataset.v31Enhanced = "1";
    node.classList.add("empty--v31");

    const icon = node.querySelector(".eico")?.textContent?.trim() || "📊";
    node.innerHTML = `
      <div class="eico" aria-hidden="true">${icon}</div>
      <div class="etit-sub">${escHtml(rule.title)}</div>
      <div class="ecopy">${escHtml(rule.copy)}</div>
      <div class="eactions"></div>
    `;
    const actionsHost = node.querySelector(".eactions");
    (rule.actions || []).forEach(action => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", action.onClick);
      actionsHost.appendChild(btn);
    });
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scanAll() {
    document.querySelectorAll(".empty:not([data-v31-enhanced])").forEach(enhanceEmptyNode);
  }

  function installObserver() {
    const obs = new MutationObserver(muts => {
      let shouldScan = false;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList?.contains("empty") || node.querySelector?.(".empty")) {
            shouldScan = true; break;
          }
        }
        if (shouldScan) break;
      }
      if (shouldScan) scanAll();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    scanAll();
    installObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
