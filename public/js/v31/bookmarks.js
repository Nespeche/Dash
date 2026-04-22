/* =============================================================================
   bookmarks.js — v31
   -----------------------------------------------------------------------------
   Vistas guardadas ("Marcadores"): permite al usuario guardar con nombre un
   snapshot del estado del tablero (pestaña activa + filtros + período) y
   recuperarlo con un clic desde un selector en el header.

   Persistencia: localStorage. MVP cero backend. Máximo 20 marcadores.
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31Bookmarks) return;
  window.__v31Bookmarks = true;

  const STORAGE_KEY = "ventasDashBookmarks";
  const MAX_BOOKMARKS = 20;

  // ── Persistencia ────────────────────────────────────────────────────
  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function saveAll(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_BOOKMARKS)));
    } catch (_) {}
  }

  // ── Snapshot/restore del estado ─────────────────────────────────────
  function readState() {
    const get = id => (document.getElementById(id)?.value || "").trim();
    const getProds = () => {
      const sel = document.getElementById("sCodProd");
      if (!sel) return [];
      return Array.from(sel.selectedOptions || []).map(o => o.value).filter(Boolean);
    };
    const activeTab = document.querySelector(".tab.on")?.dataset?.tab || "detalle";
    return {
      ts: new Date().toISOString(),
      tab: activeTab,
      period: { desde: get("fDesde"), hasta: get("fHasta") },
      filters: {
        coordinador: get("sCoord"),
        agente: get("sAgte"),
        cliente: get("sClie"),
        grupo: get("sGrp"),
        marca: get("sMrc"),
        codProd: getProds()
      }
    };
  }

  function fireChange(el) {
    if (!el) return;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applyState(state) {
    if (!state) return;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v || "";
      fireChange(el);
    };
    // Cambiar de pestaña si difiere
    if (state.tab) {
      const tab = document.getElementById(`tab-${state.tab}`);
      if (tab && !tab.classList.contains("on")) tab.click();
    }
    // Filtros en cascada (respeta el orden para que el filter-controller propague)
    set("sCoord", state.filters?.coordinador);
    set("sAgte",  state.filters?.agente);
    set("sClie",  state.filters?.cliente);
    set("sGrp",   state.filters?.grupo);
    set("sMrc",   state.filters?.marca);
    set("fDesde", state.period?.desde);
    set("fHasta", state.period?.hasta);

    // Productos: lista múltiple. Replicamos la selección.
    const sCodProd = document.getElementById("sCodProd");
    if (sCodProd && Array.isArray(state.filters?.codProd)) {
      Array.from(sCodProd.options).forEach(o => { o.selected = false; });
      for (const code of state.filters.codProd) {
        let opt = Array.from(sCodProd.options).find(o => o.value === code);
        if (!opt) {
          opt = document.createElement("option");
          opt.value = code;
          opt.textContent = code;
          sCodProd.appendChild(opt);
        }
        opt.selected = true;
      }
      fireChange(sCodProd);
    }
  }

  // ── UI: botón ⭐ + dropdown ───────────────────────────────────────
  function buildUI() {
    const header = document.querySelector("header.hdr > div[style*='align-items:center']");
    if (!header || document.getElementById("v31BookmarksBtn")) return false;

    const wrap = document.createElement("div");
    wrap.id = "v31Bookmarks";
    wrap.style.cssText = "position:relative;display:inline-flex;align-items:center;margin-right:6px";
    wrap.innerHTML = `
      <button type="button" id="v31BookmarksBtn" class="theme-toggle" aria-label="Marcadores de vistas" title="Marcadores" aria-haspopup="true" aria-expanded="false">⭐</button>
      <div id="v31BookmarksDd" role="menu" aria-label="Marcadores guardados" style="
        display:none;position:absolute;top:calc(100% + 6px);right:0;z-index:900;
        min-width:280px;max-width:340px;
        background:var(--surf);border:1px solid var(--brd);border-radius:var(--radius-md,10px);
        box-shadow:var(--shadow-lg,0 16px 48px rgba(0,0,0,.35));
        padding:8px 0;font-family:'DM Sans',sans-serif;
      ">
        <div style="padding:4px 14px 10px;border-bottom:1px solid var(--brd);display:flex;gap:6px;align-items:center">
          <input id="v31BookmarkName" type="text" placeholder="Nombre de esta vista..." maxlength="40" style="
            flex:1;min-width:0;background:var(--card);border:1px solid var(--brd);border-radius:var(--radius-sm,6px);
            padding:6px 10px;font-size:12px;color:var(--txt);outline:none
          "/>
          <button type="button" id="v31BookmarkSave" class="btn-xs" style="white-space:nowrap">+ Guardar</button>
        </div>
        <div id="v31BookmarksList" style="max-height:260px;overflow:auto;padding:6px 0"></div>
        <div id="v31BookmarksEmpty" style="padding:14px;text-align:center;font-size:11px;color:var(--mut)" hidden>
          Aún no guardaste ninguna vista.
          <div style="margin-top:4px;opacity:.7">Configurá los filtros y apretá + Guardar.</div>
        </div>
      </div>
    `;
    // Lo insertamos al principio del contenedor derecho del header
    header.insertBefore(wrap, header.firstChild);
    return true;
  }

  function fmtTs(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) + " " +
             d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    } catch (_) { return ""; }
  }

  function describeFilters(state) {
    const f = state?.filters || {};
    const parts = [];
    if (f.coordinador) parts.push(`coord: ${f.coordinador}`);
    if (f.agente) parts.push(`agte: ${f.agente}`);
    if (f.cliente) parts.push(`clie: ${f.cliente}`);
    if (f.grupo) parts.push(`grp: ${f.grupo}`);
    if (f.marca) parts.push(`mrc: ${f.marca}`);
    if (f.codProd?.length) parts.push(`${f.codProd.length} prod`);
    const period = state?.period;
    if (period?.desde && period?.hasta) parts.push(`${period.desde} → ${period.hasta}`);
    return parts.length ? parts.join(" · ") : "Sin filtros";
  }

  function renderList() {
    const list = document.getElementById("v31BookmarksList");
    const empty = document.getElementById("v31BookmarksEmpty");
    if (!list) return;
    const items = loadAll();
    if (!items.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = items.map((bm, i) => `
      <div class="v31-bm-row" data-idx="${i}" style="display:flex;align-items:center;gap:6px;padding:7px 14px;cursor:pointer;transition:background .12s" role="menuitem" tabindex="0">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(bm.name)}</div>
          <div style="font-size:10px;color:var(--mut);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(describeFilters(bm))}</div>
          <div style="font-size:9px;color:var(--mut);opacity:.6;margin-top:1px">${escHtml(bm.tab || "")} · ${escHtml(fmtTs(bm.ts))}</div>
        </div>
        <button type="button" class="v31-bm-del" data-idx="${i}" title="Eliminar" aria-label="Eliminar marcador" style="background:none;border:none;color:var(--mut);cursor:pointer;padding:4px 6px;border-radius:4px;font-size:14px">✕</button>
      </div>
    `).join("");

    list.querySelectorAll(".v31-bm-row").forEach(row => {
      row.addEventListener("mouseenter", () => { row.style.background = "var(--card-hover, rgba(255,255,255,.04))"; });
      row.addEventListener("mouseleave", () => { row.style.background = ""; });
      row.addEventListener("click", ev => {
        if (ev.target.classList.contains("v31-bm-del")) return;
        const idx = Number(row.dataset.idx);
        const items = loadAll();
        if (items[idx]) {
          applyState(items[idx]);
          toast(`Aplicada vista: ${items[idx].name}`);
          closeDropdown();
        }
      });
      row.addEventListener("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); row.click(); }
      });
    });
    list.querySelectorAll(".v31-bm-del").forEach(btn => {
      btn.addEventListener("click", ev => {
        ev.stopPropagation();
        const idx = Number(btn.dataset.idx);
        const items = loadAll();
        if (items[idx]) {
          const name = items[idx].name;
          items.splice(idx, 1);
          saveAll(items);
          renderList();
          toast(`Marcador "${name}" eliminado`);
        }
      });
    });
  }

  function openDropdown() {
    const dd = document.getElementById("v31BookmarksDd");
    const btn = document.getElementById("v31BookmarksBtn");
    if (!dd || !btn) return;
    dd.style.display = "block";
    btn.setAttribute("aria-expanded", "true");
    renderList();
    document.getElementById("v31BookmarkName")?.focus();
  }

  function closeDropdown() {
    const dd = document.getElementById("v31BookmarksDd");
    const btn = document.getElementById("v31BookmarksBtn");
    if (!dd || !btn) return;
    dd.style.display = "none";
    btn.setAttribute("aria-expanded", "false");
  }

  function toggleDropdown() {
    const dd = document.getElementById("v31BookmarksDd");
    if (!dd) return;
    if (dd.style.display === "block") closeDropdown();
    else openDropdown();
  }

  function saveCurrent() {
    const nameEl = document.getElementById("v31BookmarkName");
    if (!nameEl) return;
    const name = String(nameEl.value || "").trim();
    if (!name) { nameEl.focus(); return; }
    const state = readState();
    state.name = name;
    const items = loadAll();
    items.unshift(state);
    saveAll(items);
    nameEl.value = "";
    renderList();
    toast(`Vista "${name}" guardada`);
  }

  function toast(message) {
    const el = document.createElement("div");
    el.className = "ux-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindEvents() {
    const btn = document.getElementById("v31BookmarksBtn");
    const save = document.getElementById("v31BookmarkSave");
    const nameEl = document.getElementById("v31BookmarkName");
    if (!btn || !save || !nameEl) return;

    btn.addEventListener("click", ev => {
      ev.stopPropagation();
      toggleDropdown();
    });
    save.addEventListener("click", ev => { ev.stopPropagation(); saveCurrent(); });
    nameEl.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); saveCurrent(); }
      if (ev.key === "Escape") closeDropdown();
    });
    // Cerrar al clicar afuera
    document.addEventListener("click", ev => {
      const wrap = document.getElementById("v31Bookmarks");
      if (wrap && !wrap.contains(ev.target)) closeDropdown();
    });
    // Cerrar con Escape
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape") closeDropdown();
    });
  }

  function boot() {
    if (!buildUI()) {
      window.setTimeout(boot, 600);
      return;
    }
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
