/* =============================================================================
   row-drawer.js — v31
   -----------------------------------------------------------------------------
   Drawer lateral que se abre al hacer doble-click en una fila de tabla y
   muestra:
     - Nombre e identificadores de la fila
     - Un sparkline de 60 días de esa entidad (si es un cliente)
     - Botón "Preguntar a la IA sobre esto" que pre-carga contexto en el chat
     - Link para copiar el código / exportar sólo esa fila

   Muy conservador: no altera la tabla, sólo escucha el dblclick bubbling.
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31RowDrawer) return;
  window.__v31RowDrawer = true;

  const AUTH_STORAGE_KEY = "ventasDashBasicAuth";

  function apiBase() {
    const meta = document.querySelector('meta[name="ventas-api-base"]');
    return (meta?.content || "").replace(/\/$/, "");
  }

  function authHeader() {
    try {
      const tok = sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
      if (tok) return { Authorization: `Basic ${tok}` };
    } catch (_) {}
    return {};
  }

  // ── Detección de la fila ────────────────────────────────────────────
  // Intentamos inferir el tipo de fila: cliente / grupo / producto / generic
  function detectRowKind(tr) {
    const table = tr?.closest("table");
    if (!table) return { kind: "generic", fields: [] };
    const ths = Array.from(table.querySelectorAll("thead th"));
    const headerLabels = ths.map(th => (th.textContent || "").toLowerCase().trim());
    const cells = Array.from(tr.children);

    const find = (...labels) => {
      for (const lbl of labels) {
        const i = headerLabels.findIndex(h => h === lbl || h.startsWith(lbl));
        if (i >= 0) return { label: ths[i].textContent.trim(), value: (cells[i]?.textContent || "").trim(), index: i };
      }
      return null;
    };

    const fields = [];
    const clienteField  = find("cliente", "clientes");
    const codClieField  = find("cod. cliente", "código cliente", "cod cliente", "cod_cliente");
    const grupoField    = find("grupo", "grupo de familia", "familia");
    const agenteField   = find("agente", "agentes");
    const coordField    = find("coordinador", "coordinadores");
    const codProdField  = find("cód. producto", "cod producto", "cod producto", "cod_producto", "código");
    const productoField = find("producto", "productos");
    const kilosField    = find("kilos");
    const fechaField    = find("fecha");
    const pctField      = find("%");

    [clienteField, codClieField, grupoField, agenteField, coordField,
     codProdField, productoField, fechaField, kilosField, pctField]
      .filter(Boolean).forEach(f => fields.push(f));

    let kind = "generic";
    if (clienteField) kind = "cliente";
    else if (codProdField || productoField) kind = "producto";
    else if (grupoField) kind = "grupo";
    else if (coordField) kind = "coordinador";
    else if (agenteField) kind = "agente";
    return { kind, fields, clienteField, codClieField, grupoField, agenteField, coordField, codProdField, productoField };
  }

  // ── UI: drawer ──────────────────────────────────────────────────────
  function ensureDrawer() {
    if (document.getElementById("v31Drawer")) return;
    const drawer = document.createElement("aside");
    drawer.id = "v31Drawer";
    drawer.className = "v31-drawer";
    drawer.innerHTML = `
      <div class="v31-drawer-scrim" aria-hidden="true"></div>
      <div class="v31-drawer-panel" role="dialog" aria-label="Detalle de fila" aria-modal="true">
        <header class="v31-drawer-head">
          <div>
            <div class="v31-drawer-kind" id="v31DrawerKind">Detalle</div>
            <div class="v31-drawer-title" id="v31DrawerTitle">—</div>
          </div>
          <button type="button" id="v31DrawerClose" class="v31-drawer-close" aria-label="Cerrar">✕</button>
        </header>
        <div class="v31-drawer-body">
          <section class="v31-drawer-section" id="v31DrawerSpark" hidden>
            <div class="v31-drawer-section-title">Últimos 60 días</div>
            <div id="v31DrawerSparkChart" class="v31-drawer-spark"></div>
          </section>
          <section class="v31-drawer-section">
            <div class="v31-drawer-section-title">Campos</div>
            <div id="v31DrawerFields" class="v31-drawer-fields"></div>
          </section>
          <section class="v31-drawer-section">
            <div class="v31-drawer-section-title">Acciones</div>
            <div class="v31-drawer-actions">
              <button type="button" class="v31-drawer-btn" id="v31DrawerAskAI">🤖 Preguntar a la IA</button>
              <button type="button" class="v31-drawer-btn" id="v31DrawerApplyFilter">🔎 Filtrar tablero por esto</button>
              <button type="button" class="v31-drawer-btn" id="v31DrawerCopy">📋 Copiar resumen</button>
            </div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(drawer);

    // Cerrar con scrim o botón
    drawer.querySelector(".v31-drawer-scrim").addEventListener("click", closeDrawer);
    drawer.querySelector("#v31DrawerClose").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
    });
  }

  function installStyles() {
    if (document.getElementById("v31-drawer-css")) return;
    const s = document.createElement("style");
    s.id = "v31-drawer-css";
    s.textContent = `
      .v31-drawer { position: fixed; inset: 0; z-index: 1500; pointer-events: none; }
      .v31-drawer.open { pointer-events: auto; }
      .v31-drawer-scrim {
        position: absolute; inset: 0;
        background: rgba(5, 7, 13, 0.55);
        opacity: 0; transition: opacity 220ms ease;
      }
      .v31-drawer.open .v31-drawer-scrim { opacity: 1; }
      .v31-drawer-panel {
        position: absolute; top: 0; right: 0; bottom: 0;
        width: min(420px, 94vw);
        background: var(--surf);
        border-left: 1px solid var(--brd);
        box-shadow: var(--shadow-lg, -16px 0 48px rgba(0,0,0,.45));
        transform: translateX(100%);
        transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
        display: flex; flex-direction: column;
      }
      .v31-drawer.open .v31-drawer-panel { transform: translateX(0); }
      .v31-drawer-head {
        display: flex; justify-content: space-between; align-items: flex-start;
        padding: 14px 18px 10px; border-bottom: 1px solid var(--brd);
        gap: 10px;
      }
      .v31-drawer-kind {
        font: 600 9.5px/1 'DM Sans', sans-serif;
        color: var(--mut); letter-spacing: 0.8px; text-transform: uppercase;
        margin-bottom: 5px;
      }
      .v31-drawer-title {
        font: 700 16px/1.25 'Syne', sans-serif; color: var(--txt);
        word-break: break-word;
      }
      .v31-drawer-close {
        background: none; border: 1px solid var(--brd); color: var(--mut);
        width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
        font-size: 14px; flex-shrink: 0;
      }
      .v31-drawer-close:hover { color: var(--txt); border-color: var(--acc); }
      .v31-drawer-body {
        padding: 14px 18px 24px; flex: 1; overflow: auto;
        scrollbar-width: thin;
      }
      .v31-drawer-section { margin-bottom: 18px; }
      .v31-drawer-section-title {
        font: 600 10px/1.3 'DM Sans', sans-serif;
        color: var(--mut); text-transform: uppercase; letter-spacing: 0.6px;
        margin-bottom: 8px;
      }
      .v31-drawer-fields { display: flex; flex-direction: column; gap: 5px; }
      .v31-drawer-field {
        display: flex; justify-content: space-between; gap: 12px;
        padding: 6px 0; border-bottom: 1px dashed var(--brd);
        font-size: 12px;
      }
      .v31-drawer-field-lbl { color: var(--mut); flex-shrink: 0; }
      .v31-drawer-field-val {
        color: var(--txt); font-weight: 600; text-align: right;
        word-break: break-word; min-width: 0;
      }
      .v31-drawer-spark {
        min-height: 80px; padding: 8px 0;
      }
      .v31-drawer-spark svg { width: 100%; height: 80px; }
      .v31-drawer-actions { display: flex; flex-direction: column; gap: 6px; }
      .v31-drawer-btn {
        background: var(--card); border: 1px solid var(--brd); color: var(--txt);
        padding: 9px 12px; border-radius: 8px; cursor: pointer;
        font: 600 12px/1.3 'DM Sans', sans-serif; text-align: left;
        transition: all 120ms ease;
      }
      .v31-drawer-btn:hover {
        border-color: var(--acc); background: var(--acc-soft, rgba(251,191,36,.1));
        color: var(--acc);
      }
      @media (max-width: 640px) {
        .v31-drawer-panel { width: 100vw; }
      }
    `;
    document.head.appendChild(s);
  }

  function openDrawer(data) {
    ensureDrawer();
    const drawer = document.getElementById("v31Drawer");
    const titleEl = document.getElementById("v31DrawerTitle");
    const kindEl = document.getElementById("v31DrawerKind");
    const fieldsEl = document.getElementById("v31DrawerFields");
    const sparkSection = document.getElementById("v31DrawerSpark");
    const sparkChart = document.getElementById("v31DrawerSparkChart");

    kindEl.textContent = {
      cliente: "Cliente", producto: "Producto", grupo: "Grupo",
      coordinador: "Coordinador", agente: "Agente", generic: "Fila"
    }[data.kind] || "Fila";

    const titleCandidate = data.clienteField?.value ||
      data.productoField?.value ||
      data.grupoField?.value ||
      data.coordField?.value ||
      data.agenteField?.value ||
      data.fields?.[0]?.value ||
      "—";
    titleEl.textContent = titleCandidate;

    // Campos
    fieldsEl.innerHTML = "";
    (data.fields || []).forEach(f => {
      if (!f || !f.value) return;
      const row = document.createElement("div");
      row.className = "v31-drawer-field";
      row.innerHTML = `
        <span class="v31-drawer-field-lbl">${escHtml(f.label)}</span>
        <span class="v31-drawer-field-val">${escHtml(f.value)}</span>
      `;
      fieldsEl.appendChild(row);
    });

    // Sparkline para clientes (si tenemos código)
    sparkSection.hidden = true;
    if (data.kind === "cliente" && data.codClieField?.value) {
      sparkSection.hidden = false;
      sparkChart.innerHTML = '<div style="font-size:11px;color:var(--mut)">Cargando...</div>';
      fetchClientSparkline(data.codClieField.value).then(points => {
        sparkChart.innerHTML = buildSparkSvg(points) || '<div style="font-size:11px;color:var(--mut)">Sin datos</div>';
      }).catch(() => {
        sparkChart.innerHTML = '<div style="font-size:11px;color:var(--mut)">No disponible</div>';
      });
    }

    // Acciones
    bindActions(data);

    drawer.classList.add("open");
  }

  function closeDrawer() {
    const drawer = document.getElementById("v31Drawer");
    if (drawer) drawer.classList.remove("open");
  }

  async function fetchClientSparkline(codCliente) {
    const base = apiBase();
    if (!base || !codCliente) return null;
    const url = `${base}/sparkline?auto=1&limit=60&cliente=${encodeURIComponent(codCliente)}`;
    try {
      const res = await fetch(url, { headers: { "accept": "application/json", ...authHeader() } });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return Array.isArray(data?.points) ? data.points : null;
    } catch (_) { return null; }
  }

  function buildSparkSvg(points) {
    if (!points || points.length < 2) return "";
    const w = 380, h = 80, padX = 4, padY = 6;
    const vals = points.map(p => Number(p.kilos || 0));
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const range = max - min || 1;
    const step = (w - padX * 2) / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = padX + i * step;
      const y = padY + (1 - (Number(p.kilos || 0) - min) / range) * (h - padY * 2);
      return [x, y];
    });
    const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${h - padY} L${coords[0][0].toFixed(1)},${h - padY} Z`;
    const firstDate = points[0]?.fecha || "";
    const lastDate  = points[points.length - 1]?.fecha || "";
    return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <path d="${areaPath}" fill="var(--acc)" opacity="0.18"/>
      <path d="${linePath}" fill="none" stroke="var(--acc)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="4" y="${h - 2}" font-size="8.5" fill="var(--mut)" font-family="'DM Sans', sans-serif">${firstDate}</text>
      <text x="${w - 4}" y="${h - 2}" text-anchor="end" font-size="8.5" fill="var(--mut)" font-family="'DM Sans', sans-serif">${lastDate}</text>
    </svg>`;
  }

  function bindActions(data) {
    const askBtn = document.getElementById("v31DrawerAskAI");
    const filterBtn = document.getElementById("v31DrawerApplyFilter");
    const copyBtn = document.getElementById("v31DrawerCopy");
    if (!askBtn || !filterBtn || !copyBtn) return;

    askBtn.onclick = () => {
      const title = data.clienteField?.value || data.productoField?.value || data.grupoField?.value || "esto";
      const prompt = `Contame sobre ${title} — performance reciente, comparativa y qué se destaca.`;
      // Abrir el panel IA y prefill el input
      const fab = document.getElementById("aiFab");
      const aiInput = document.getElementById("aiInput");
      const panel = document.getElementById("aiPanel");
      if (fab && panel && !panel.classList.contains("open")) fab.click();
      setTimeout(() => {
        const input = document.getElementById("aiInput");
        if (input) { input.value = prompt; input.focus(); }
      }, 120);
      closeDrawer();
    };

    filterBtn.onclick = () => {
      const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (!el || !v) return false;
        // Verificar que exista la opción
        if (el.tagName === "SELECT") {
          const opt = Array.from(el.options).find(o => o.value === v);
          if (!opt) return false;
        }
        el.value = v;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };
      let applied = false;
      if (data.codClieField?.value) applied = setVal("sClie", data.codClieField.value) || applied;
      if (data.grupoField?.value) applied = setVal("sGrp", data.grupoField.value) || applied;
      if (data.coordField?.value) applied = setVal("sCoord", data.coordField.value) || applied;
      if (applied) {
        toast("Filtros aplicados");
        closeDrawer();
      } else {
        toast("No pude inferir un filtro específico");
      }
    };

    copyBtn.onclick = async () => {
      const lines = (data.fields || [])
        .filter(f => f?.value)
        .map(f => `${f.label}: ${f.value}`);
      const text = lines.join("\n");
      try {
        await navigator.clipboard.writeText(text);
        toast("Copiado al portapapeles");
      } catch (_) {
        toast("No pude copiar");
      }
    };
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

  // ── Listener global de dblclick en tablas ──────────────────────────
  function onDblClick(ev) {
    const tr = ev.target.closest("tbody > tr");
    if (!tr) return;
    // Evitar en skeleton y en fila de "sin datos"
    if (tr.classList.contains("skeleton-row")) return;
    if (tr.querySelector(".empty")) return;

    // Solo en las tablas conocidas
    const table = tr.closest("table.responsive-stack, table.acsum-table, table.acum-table");
    if (!table) return;

    const data = detectRowKind(tr);
    if (!data.fields.length) return;

    ev.preventDefault();
    openDrawer(data);
  }

  function boot() {
    installStyles();
    ensureDrawer();
    document.addEventListener("dblclick", onDblClick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
