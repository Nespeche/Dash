/* =============================================================================
   ai-feedback.js — v31
   -----------------------------------------------------------------------------
   Agrega thumbs up/down a cada respuesta del asistente IA.
   Los ratings se guardan en localStorage primero (MVP) y se envían al backend
   cuando /api/ai/feedback esté disponible. Si el endpoint no existe, silent-fail
   (no molesta al usuario).
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31AiFeedback) return;
  window.__v31AiFeedback = true;

  const STORAGE_KEY = "ventasDashAiFeedback";
  const MAX_STORED = 200;
  const AUTH_STORAGE_KEY = "ventasDashBasicAuth";

  function apiBase() {
    const meta = document.querySelector('meta[name="ventas-api-base"]');
    return (meta?.content || "").replace(/\/$/, "");
  }

  function getAuth() {
    try {
      return sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY) || "";
    } catch (_) { return ""; }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function saveLocal(entries) {
    try {
      const trimmed = entries.slice(-MAX_STORED);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (_) {}
  }

  async function postFeedback(entry) {
    const base = apiBase();
    if (!base) return;
    try {
      const auth = getAuth();
      const headers = { "content-type": "application/json" };
      if (auth) headers.Authorization = `Basic ${auth}`;
      const res = await fetch(`${base}/ai/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify(entry)
      });
      // Silent fail si 404 o 5xx: el endpoint puede no estar desplegado aún
      if (!res.ok) {
        console.debug(`[v31/ai-feedback] endpoint respondió ${res.status}`);
      }
    } catch (err) {
      console.debug("[v31/ai-feedback] error al enviar:", err?.message || err);
    }
  }

  function markRated(msgEl, rating) {
    const wrap = msgEl.querySelector(".ai-feedback");
    if (!wrap) return;
    wrap.querySelectorAll(".ai-fb-btn").forEach(btn => {
      btn.classList.toggle("on", btn.dataset.rating === rating);
    });
    const note = wrap.querySelector(".ai-fb-note");
    if (note) note.textContent = rating === "up" ? "¡Gracias!" : "Gracias por el feedback";
  }

  function attachFeedbackToBotMsg(msgEl) {
    if (!msgEl || msgEl.dataset.v31FbAttached === "1") return;
    // Solo mensajes con texto real (no streaming)
    if (msgEl.classList.contains("streaming")) return;
    const text = String(msgEl.textContent || "").trim();
    if (!text || text.length < 20) return;

    msgEl.dataset.v31FbAttached = "1";

    const wrap = document.createElement("div");
    wrap.className = "ai-feedback";
    wrap.innerHTML = `
      <button type="button" class="ai-fb-btn" data-rating="up"   title="Respuesta útil" aria-label="Marcar respuesta útil">👍</button>
      <button type="button" class="ai-fb-btn" data-rating="down" title="Respuesta poco útil" aria-label="Marcar respuesta poco útil">👎</button>
      <span class="ai-fb-note"></span>
    `;

    wrap.querySelectorAll(".ai-fb-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const rating = btn.dataset.rating;
        const question = findPairedUserQuestion(msgEl);
        const entry = {
          ts: new Date().toISOString(),
          rating,
          question,
          answer: text.slice(0, 2000),
          appVersion: (window.__VENTAS_APP_VERSION__ || ""),
          activeTab: document.querySelector(".tab.on")?.dataset?.tab || ""
        };

        // Guardar local primero (instant UI response)
        const all = loadLocal();
        all.push(entry);
        saveLocal(all);
        markRated(msgEl, rating);

        // Enviar al backend (fire and forget)
        postFeedback(entry);
      });
    });

    msgEl.appendChild(wrap);
  }

  function findPairedUserQuestion(botMsgEl) {
    let prev = botMsgEl.previousElementSibling;
    while (prev) {
      if (prev.classList?.contains("ai-m") && prev.classList.contains("user")) {
        return String(prev.textContent || "").trim().slice(0, 500);
      }
      prev = prev.previousElementSibling;
    }
    return "";
  }

  function scanAll() {
    document.querySelectorAll(".ai-m.bot:not([data-v31-fb-attached])").forEach(attachFeedbackToBotMsg);
  }

  function installObserver() {
    const msgs = document.getElementById("aiMsgs");
    if (!msgs) return false;
    const obs = new MutationObserver(muts => {
      // Atachar a nuevos mensajes bot cuando terminan de streamear
      // Observamos tanto adición como cambios de clase (remoción de .streaming)
      let shouldScan = false;
      for (const m of muts) {
        if (m.type === "childList" && m.addedNodes.length) { shouldScan = true; break; }
        if (m.type === "attributes" && m.target?.classList?.contains("ai-m")) { shouldScan = true; break; }
      }
      if (shouldScan) window.setTimeout(scanAll, 120);
    });
    obs.observe(msgs, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
    return true;
  }

  function boot() {
    if (!installObserver()) {
      window.setTimeout(boot, 600);
      return;
    }
    scanAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
