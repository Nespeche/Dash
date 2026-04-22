/* =============================================================================
   ai-enhancements.js — v31
   -----------------------------------------------------------------------------
   Habilita de forma opt-in las capacidades nuevas del backend IA v31:
     - Streaming SSE real (body.stream = true)
     - Fast-path determinista (body.fast = true)
   La activación se hace vía un toggle en el footer del panel IA.
   Si el endpoint no soporta estos flags (backend antiguo), el servidor los
   ignora y responde en modo JSON clásico. Cero riesgo de romper.

   IMPORTANTE: interceptamos fetch SOLO en las llamadas a /api/ai/chat
   para no afectar ninguna otra llamada de la app.
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31AiEnhancements) return;
  window.__v31AiEnhancements = true;

  const PREFS_KEY = "ventasDashAiPrefs";
  const DEFAULT_PREFS = { stream: false, fast: false };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return { ...DEFAULT_PREFS };
      const parsed = JSON.parse(raw);
      return {
        stream: parsed?.stream === true,
        fast: parsed?.fast === true
      };
    } catch (_) {
      return { ...DEFAULT_PREFS };
    }
  }

  function savePrefs(prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
    catch (_) {}
  }

  const prefs = loadPrefs();

  // ── Patch de fetch limitado a /api/ai/chat ──────────────────────────
  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    try {
      const url = typeof input === "string" ? input : (input?.url || "");
      if (url.includes("/api/ai/chat") && init && init.method === "POST" && init.body) {
        // Parsear body, agregar flags, re-stringify
        try {
          const parsed = JSON.parse(init.body);
          if (prefs.stream && typeof parsed.stream === "undefined") parsed.stream = true;
          if (prefs.fast   && typeof parsed.fast   === "undefined") parsed.fast = true;
          init = { ...init, body: JSON.stringify(parsed) };
        } catch (_) { /* body no JSON, dejar como está */ }
      }
    } catch (_) { /* defensa extrema */ }
    return originalFetch(input, init);
  };

  // ── UI: inyectar toggles en el footer del panel IA cuando exista ────
  function injectToggles() {
    const foot = document.querySelector("#aiPanel .ai-foot");
    if (!foot || foot.querySelector(".ai-v31-prefs")) return false;

    const row = document.createElement("div");
    row.className = "ai-v31-prefs";
    row.style.cssText = "display:flex;gap:12px;padding:4px 0 0;font:500 10.5px/1.3 'DM Sans',sans-serif;color:rgba(234,240,251,.5);flex-wrap:wrap";
    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer" title="Recibir la respuesta palabra por palabra en lugar de esperar al final">
        <input type="checkbox" id="aiV31Stream" ${prefs.stream ? "checked" : ""} style="accent-color:#f59e0b;cursor:pointer">
        <span>Stream</span>
      </label>
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer" title="Para preguntas simples, respuesta instantánea sin invocar el modelo (más rápido, menos floridez)">
        <input type="checkbox" id="aiV31Fast" ${prefs.fast ? "checked" : ""} style="accent-color:#f59e0b;cursor:pointer">
        <span>Rápido</span>
      </label>
    `;
    foot.appendChild(row);

    document.getElementById("aiV31Stream")?.addEventListener("change", ev => {
      prefs.stream = !!ev.target.checked;
      savePrefs(prefs);
    });
    document.getElementById("aiV31Fast")?.addEventListener("change", ev => {
      prefs.fast = !!ev.target.checked;
      savePrefs(prefs);
    });
    return true;
  }

  function boot() {
    // Reintentar hasta que el panel IA se cargue
    if (!injectToggles()) {
      window.setTimeout(boot, 600);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
