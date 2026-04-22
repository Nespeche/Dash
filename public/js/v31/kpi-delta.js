/* =============================================================================
   kpi-delta.js — v31
   -----------------------------------------------------------------------------
   Enriquece los KPIs del tablero con:
     - Delta % vs mismo mes cerrado del año anterior usando /api/projection-compare
       para respetar la base histórica 2025 cerrada por mes.
     - Sparkline SVG inline con los últimos 30 días (o el rango activo).
   NO MODIFICA app.js. Funciona vía MutationObserver sobre los nodos #kK/#kC/#kA/#kR.
   Es resiliente: si falla cualquier fetch, los KPIs quedan como estaban (solo
   el número). Sin errores visibles al usuario.
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31KpiDelta) return;
  window.__v31KpiDelta = true;

  // ── Config ───────────────────────────────────────────────────────────
  const KPI_IDS = ["kK", "kC", "kA", "kR"];
  const KPI_LABELS = { kK: "Kilos", kC: "Clientes", kA: "Agentes", kR: "Registros" };
  const KPI_FIELD_MAP = { kK: "kilos", kC: "clientes", kA: "agentes", kR: "registros" };
  const DEBOUNCE_MS = 450;
  const AUTH_STORAGE_KEY = "ventasDashBasicAuth";

  // Token en memoria entre llamadas
  let authTokenCached = null;
  let apiBaseCached = null;
  let lastSignature = "";
  let debounceHandle = 0;
  let inflightCtrl = null;

  function apiBase() {
    if (apiBaseCached) return apiBaseCached;
    const meta = document.querySelector('meta[name="ventas-api-base"]');
    apiBaseCached = (meta?.content || "").replace(/\/$/, "");
    return apiBaseCached;
  }

  function authHeader() {
    try {
      const tok = sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
      if (tok) return { Authorization: `Basic ${tok}` };
    } catch (_) {}
    return authTokenCached ? { Authorization: `Basic ${authTokenCached}` } : {};
  }

  // ── Helpers de formato ───────────────────────────────────────────────
  function fmtPct(n) {
    if (!Number.isFinite(n)) return "";
    const abs = Math.abs(n);
    const formatted = abs.toLocaleString("es-AR", {
      maximumFractionDigits: abs < 10 ? 1 : 0,
      minimumFractionDigits: abs < 10 ? 1 : 0
    });
    return `${n >= 0 ? "+" : "-"}${formatted}%`;
  }

  // ── Lee filtros del tablero ──────────────────────────────────────────
  function readCurrentFilters() {
    const get = id => (document.getElementById(id)?.value || "").trim();
    const getProds = () => {
      const sel = document.getElementById("sCodProd");
      if (!sel) return [];
      return Array.from(sel.selectedOptions || [])
        .map(o => (o.value || "").trim())
        .filter(Boolean);
    };
    // v42: read active detail quick groups from the grupo strip cards
    const getDetailGroups = () =>
      Array.from(document.querySelectorAll("#grupoStrip [data-detail-group].active"))
        .map(n => String(n.getAttribute("data-detail-group") || "").trim())
        .filter(Boolean)
        .sort();

    return {
      desde: get("fDesde"),
      hasta: get("fHasta"),
      coordinador: get("sCoord"),
      agente: get("sAgte"),
      cliente: get("sClie"),
      grupo: get("sGrp"),
      marca: get("sMrc"),
      codProd: getProds(),
      detailGroups: getDetailGroups()
    };
  }

  function filterSignature(f) {
    return [
      f.desde, f.hasta, f.coordinador, f.agente, f.cliente, f.grupo, f.marca,
      (f.codProd || []).join(","),
      (f.detailGroups || []).join("|")   // v42: include detail groups in signature
    ].join("|");
  }

  // ── Contexto de comparación YoY (mismo mes cerrado del año anterior) ──
  function parseIsoDateParts(value) {
    const s = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return {
      year: Number(s.slice(0, 4)),
      month: Number(s.slice(5, 7)),
      day: Number(s.slice(8, 10))
    };
  }

  function daysInMonthUtc(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function monthLabelEs(month, year) {
    const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const safeMonth = Math.max(1, Math.min(12, Number(month || 1)));
    return `${names[safeMonth - 1]} ${year}`;
  }

  function buildYearOverYearCompareContext(desde, hasta) {
    const start = parseIsoDateParts(desde);
    const end = parseIsoDateParts(hasta);
    if (!start || !end) return null;
    if (start.year !== end.year || start.month !== end.month) return null;
    if (start.day !== 1) return null;
    if (end.day !== daysInMonthUtc(end.year, end.month)) return null;
    const compareYear = start.year - 1;
    if (!Number.isInteger(compareYear) || compareYear < 2000) return null;
    return {
      currentYear: start.year,
      currentMonth: start.month,
      compareYear,
      compareLabel: monthLabelEs(start.month, compareYear)
    };
  }

  function buildQS(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      if (Array.isArray(v)) { if (v.length) qs.set(k, v.join(",")); }
      else qs.set(k, String(v));
    }
    return qs.toString();
  }

  // ── Fetch de KPIs YoY (mismo mes cerrado del año anterior) ───────────
  async function fetchCompareKpis(filters, compareContext, signal) {
    const base = apiBase();
    if (!base || !compareContext) return null;
    const qs = new URLSearchParams();
    if (filters.desde)       qs.set("desde", filters.desde);
    if (filters.hasta)       qs.set("hasta", filters.hasta);
    qs.set("compareYear", String(compareContext.compareYear));
    qs.set("compareMode", "month");
    if (filters.coordinador) qs.set("coordinador", filters.coordinador);
    if (filters.agente)      qs.set("agente", filters.agente);
    if (filters.cliente)     qs.set("cliente", filters.cliente);
    if (filters.grupo)       qs.set("grupo", filters.grupo);
    if (filters.marca)       qs.set("marca", filters.marca);
    if ((filters.codProd || []).length) qs.set("codProd", filters.codProd.join(","));
    // v42: send active detail groups as repeated ?detailGroup= params
    (filters.detailGroups || []).forEach(g => qs.append("detailGroup", g));
    const url = `${base}/projection-compare?${qs.toString()}`;
    try {
      const res = await fetch(url, {
        headers: { "accept": "application/json", ...authHeader() },
        signal
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data?.ok || !data?.available) return null;
      return {
        current: data.current || null,
        compare: data.compare || null,
        label: String(data?.compare?.label || compareContext.compareLabel || "").trim(),
        tooltip: String(data?.compare?.label || compareContext.compareLabel || "").trim()
      };
    } catch (_) {
      return null;
    }
  }

  // ── Fetch de sparkline (últimos 30 días del rango activo) ────────────
  async function fetchSparkline(filters, signal) {
    const base = apiBase();
    if (!base) return null;
    // Usamos /api/accum-summary?view=fecha con el rango activo y limit bajo.
    const sparkQs = new URLSearchParams();
    sparkQs.set("mode", "running");
    sparkQs.set("view", "fecha");
    sparkQs.set("limit", "31");
    if (filters.desde)       sparkQs.set("desde", filters.desde);
    if (filters.hasta)       sparkQs.set("hasta", filters.hasta);
    if (filters.coordinador) sparkQs.set("coordinador", filters.coordinador);
    if (filters.agente)      sparkQs.set("agente", filters.agente);
    if (filters.cliente)     sparkQs.set("cliente", filters.cliente);
    if (filters.grupo)       sparkQs.set("grupo", filters.grupo);
    if (filters.marca)       sparkQs.set("marca", filters.marca);
    if ((filters.codProd || []).length) sparkQs.set("codProd", filters.codProd.join(","));
    (filters.detailGroups || []).forEach(g => sparkQs.append("detailGroup", g));
    const url = `${base}/accum-summary?${sparkQs.toString()}`;
    try {
      const res = await fetch(url, {
        headers: { "accept": "application/json", ...authHeader() },
        signal
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      // Ordenar por fecha ascendente (el endpoint devuelve desc por kilos)
      return rows
        .filter(r => r && r.nombre)
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
        .map(r => ({ fecha: r.nombre, kilos: Number(r.kilos || 0) }));
    } catch (_) {
      return null;
    }
  }

  // ── Construir SVG sparkline ──────────────────────────────────────────
  function buildSparkSvg(points) {
    if (!points || points.length < 2) return "";
    const w = 120, h = 26, padX = 2, padY = 3;
    const vals = points.map(p => p.kilos);
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const range = max - min || 1;
    const step = (w - padX * 2) / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = padX + i * step;
      const y = padY + (1 - (p.kilos - min) / range) * (h - padY * 2);
      return [x, y];
    });
    const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${h - padY} L${coords[0][0].toFixed(1)},${h - padY} Z`;
    const last = coords[coords.length - 1];
    return `<svg class="kpi-spark is-visible" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path class="kpi-spark-area" d="${areaPath}" />
      <path class="kpi-spark-line" d="${linePath}" />
      <circle class="kpi-spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2" />
    </svg>`;
  }

  // ── Construir HTML de delta ──────────────────────────────────────────
  function escapeHtmlAttr(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildDeltaHtml(currentVal, compareVal, compareLabel = "año anterior", tooltip = "") {
    if (!Number.isFinite(currentVal) || !Number.isFinite(compareVal) || compareVal <= 0) return "";
    const diffPct = ((currentVal - compareVal) / compareVal) * 100;
    if (!Number.isFinite(diffPct)) return "";
    const cls = diffPct > 0.05 ? "kpi-delta--up" : diffPct < -0.05 ? "kpi-delta--down" : "kpi-delta--neutral";
    const icon = diffPct > 0.05 ? "▲" : diffPct < -0.05 ? "▼" : "•";
    const safeTooltip = tooltip ? ` title="${escapeHtmlAttr(tooltip)}"` : "";
    return `<div class="kpi-delta is-visible ${cls}"${safeTooltip}>
      <span class="kpi-delta-icon">${icon}</span>
      <span class="kpi-delta-value">${fmtPct(diffPct)}</span>
      <span class="kpi-delta-label">vs ${compareLabel}</span>
    </div>`;
  }

  // ── Parse del texto del KPI a número ─────────────────────────────────
  function parseKpiText(text) {
    const cleaned = String(text || "").replace(/\./g, "").replace(/,/g, ".").trim();
    if (!cleaned || cleaned === "—" || cleaned === "-") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  // ── Ensure contenedor delta en una KPI ──────────────────────────────
  function ensureDeltaContainer(kpiEl) {
    let container = kpiEl.querySelector(".kpi-delta-wrap");
    if (!container) {
      container = document.createElement("div");
      container.className = "kpi-delta-wrap";
      kpiEl.appendChild(container);
    }
    return container;
  }

  function ensureSparkContainer(kpiEl) {
    let container = kpiEl.querySelector(".kpi-spark-wrap");
    if (!container) {
      container = document.createElement("div");
      container.className = "kpi-spark-wrap";
      kpiEl.appendChild(container);
    }
    return container;
  }

  // ── Actualización principal ──────────────────────────────────────────
  async function updateKpiEnhancements() {
    const filters = readCurrentFilters();
    const sig = filterSignature(filters);
    if (sig === lastSignature) return;
    lastSignature = sig;

    // Solo aplicamos cuando hay fechas (sin fechas = "todo el dataset", no hay período comparable razonable)
    if (!filters.desde || !filters.hasta) {
      KPI_IDS.forEach(id => {
        const val = document.getElementById(id);
        if (!val) return;
        const kpi = val.closest(".kpi");
        kpi?.querySelector(".kpi-delta-wrap")?.replaceChildren();
        kpi?.querySelector(".kpi-spark-wrap")?.replaceChildren();
      });
      return;
    }

    const compareContext = buildYearOverYearCompareContext(filters.desde, filters.hasta);

    // Cancelar request anterior
    if (inflightCtrl) try { inflightCtrl.abort(); } catch (_) {}
    inflightCtrl = new AbortController();
    const signal = inflightCtrl.signal;

    // Fetch en paralelo: delta YoY (solo si el rango es mes cerrado) y spark de "Kilos"
    const [compareBundle, sparkPoints] = await Promise.all([
      compareContext ? fetchCompareKpis(filters, compareContext, signal) : Promise.resolve(null),
      fetchSparkline(filters, signal)
    ]);

    if (signal.aborted) return;

    // Render delta para cada KPI
    KPI_IDS.forEach(id => {
      const valEl = document.getElementById(id);
      if (!valEl) return;
      const kpi = valEl.closest(".kpi");
      if (!kpi) return;
      const field = KPI_FIELD_MAP[id];
      const currentVal = compareBundle?.current ? Number(compareBundle.current[field] || 0) : parseKpiText(valEl.textContent);
      const compareVal = compareBundle?.compare ? Number(compareBundle.compare[field] || 0) : null;
      const deltaWrap = ensureDeltaContainer(kpi);
      if (currentVal != null && compareVal != null) {
        const tooltip = compareBundle?.tooltip
          ? `Comparado contra ${compareBundle.tooltip} (mes cerrado).`
          : "Comparado contra el mismo mes cerrado del año anterior.";
        deltaWrap.innerHTML = buildDeltaHtml(currentVal, compareVal, "año anterior", tooltip);
      } else {
        deltaWrap.innerHTML = "";
      }
    });

    // Sparkline solo en Kilos (#kK) — el más visual
    const kKEl = document.getElementById("kK");
    const kKKpi = kKEl?.closest(".kpi");
    if (kKKpi && sparkPoints && sparkPoints.length >= 2) {
      const sparkWrap = ensureSparkContainer(kKKpi);
      sparkWrap.innerHTML = buildSparkSvg(sparkPoints);
    }
  }

  // ── Debounced trigger ────────────────────────────────────────────────
  function scheduleUpdate() {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(() => {
      debounceHandle = 0;
      updateKpiEnhancements().catch(err => {
        console.debug("[v31/kpi-delta]", err?.message || err);
      });
    }, DEBOUNCE_MS);
  }

  // ── Observer: detectar cuando app.js actualiza el texto del KPI ────
  function installObserver() {
    const kK = document.getElementById("kK");
    if (!kK) return false;
    const obs = new MutationObserver(() => {
      const txt = String(kK.textContent || "").trim();
      if (!txt || txt === "..." || txt === "—") return;
      // Reset signature para forzar re-fetch
      lastSignature = "";
      scheduleUpdate();
    });
    obs.observe(kK, { childList: true, characterData: true, subtree: true });
    return true;
  }

  // ── Boot ─────────────────────────────────────────────────────────────
  function boot() {
    if (!installObserver()) {
      // Reintentar si aún no está el KPI en el DOM
      window.setTimeout(boot, 500);
      return;
    }
    // Primera corrida cuando ya haya datos cargados
    window.setTimeout(scheduleUpdate, 1500);

    // Re-trigger cuando cambian filtros externos (selectores)
    const debouncedTrigger = () => {
      lastSignature = "";
      scheduleUpdate();
    };
    ["sCoord", "sAgte", "sClie", "sGrp", "sMrc", "fDesde", "fHasta", "sCodProd"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", debouncedTrigger);
    });

    // v42: re-trigger cuando el usuario activa/desactiva tarjetas de grupo de familia
    // Observamos cambios de clase (active/inactive) y atributo aria-pressed en #grupoStrip
    const strip = document.getElementById("grupoStrip");
    if (strip) {
      const stripObs = new MutationObserver(mutations => {
        const relevant = mutations.some(m =>
          m.type === "attributes" &&
          (m.attributeName === "class" || m.attributeName === "aria-pressed" || m.attributeName === "style")
        );
        if (relevant) debouncedTrigger();
      });
      stripObs.observe(strip, { attributes: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
