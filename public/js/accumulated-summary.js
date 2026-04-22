/* accumulated-summary.js — v34
 * Controlador de la pestaña "Resumen Acumulado".
 *
 * v34 — Tabla siempre en formato comparativo (igual a Proyección):
 *   Columnas: # | Dimensión | Kilos año ant. | Kilos actual | Var Kg | Var % | % Total
 *   Fila de totales al pie de la tabla.
 *   Modo por defecto: "compare" (período filtrado vs mismo período año anterior).
 *
 * Modos:
 *   compare — período del filtro activo vs mismo período del año anterior  ← DEFAULT
 *   ytd     — YTD 1-Ene → hoy vs mismo rango año anterior
 *   total   — toda la base 2026 vs toda la base 2025
 */

const VIEW_LABELS = {
  grupo:       "Familia",
  coordinador: "Coordinador",
  agente:      "Agente",
  region:      "Región"
};

const MODE_LABELS = {
  compare: "Período vs año anterior",
  ytd:     "YTD vs año anterior",
  total:   "Total 2026 vs 2025"
};

// Todos los modos son comparativos — siempre 6 columnas + # + dimensión = 7 total
const COLS = 7;

function safeNum(v) { return Number(v || 0); }

function deltaClass(n) {
  if (n == null || n === 0) return "acsum-delta-zero";
  return n > 0 ? "acsum-delta-pos" : "acsum-delta-neg";
}
function deltaArrow(n) {
  if (n == null || n === 0) return "•";
  return n > 0 ? "▲" : "▼";
}

function renderBar(pct) {
  if (pct == null) return "";
  const abs = Math.min(Math.abs(pct), 100);
  const cls = pct >= 0 ? "pos" : "neg";
  return `<span class="acsum-bar-track"><span class="acsum-bar-fill ${cls}" style="width:${abs}%"></span></span>`;
}

export function createAccumulatedSummaryController({
  apiBase,
  getFiltros,
  getPeriodo,
  fmt,
  escHtml,
  getAuthToken
}) {
  let mode = "compare";   // ← DEFAULT: siempre comparativo
  let view = "grupo";
  let lastFetchKey = "";
  let inflight = null;
  let abortController = null;
  let debounceTimer = 0;

  // ── Query string ──────────────────────────────────────────

  function buildQs() {
    const f = getFiltros() || {};
    const p = getPeriodo() || {};
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("view", view);
    params.set("limit", "150");
    if (f.coordinador) params.set("coordinador", f.coordinador);
    if (f.agente)      params.set("agente",      f.agente);
    if (f.cliente)     params.set("cliente",      f.cliente);
    if (f.grupo)       params.set("grupo",        f.grupo);
    if (f.marca)       params.set("marca",        f.marca);
    if (f.region)      params.set("region",       f.region);
    if (Array.isArray(f.codProd) && f.codProd.length) {
      f.codProd.forEach(c => params.append("codProd", c));
    }
    // compare y ytd usan las fechas del filtro; total las ignora
    if (mode === "compare") {
      if (p.desde) params.set("desde", p.desde);
      if (p.hasta) params.set("hasta", p.hasta);
    }
    return params.toString();
  }

  // ── Fetch con AbortController ─────────────────────────────

  async function fetchData() {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const qs  = buildQs();
    const url = `${apiBase}/accum-summary?${qs}`;
    const headers = { Accept: "application/json" };
    const token = typeof getAuthToken === "function" ? getAuthToken() : "";
    if (token) headers.Authorization = `Basic ${token}`;
    const res = await fetch(url, { headers, signal: abortController.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // ── Render: cabecera ──────────────────────────────────────

  function renderHeader(payload) {
    const head = document.getElementById("acsumHead");
    if (!head) return;
    const viewLabel = escHtml(VIEW_LABELS[view] || view);
    const lbl       = payload?.periodLabels || {};

    // Etiquetas de año: "Kilos Ene 2025" / "Kilos Ene 2026"
    // Si el backend no las manda, fallback genérico
    const lblHist   = escHtml(lbl.historico || "Año anterior");
    const lblActual = escHtml(lbl.actual    || "Año actual");

    head.innerHTML = `<tr>
      <th class="acsum-th-num">#</th>
      <th>${viewLabel}</th>
      <th class="r">Kilos ${lblHist}</th>
      <th class="r">Kilos ${lblActual}</th>
      <th class="r col-varkg">Var Kg</th>
      <th class="r">Var %</th>
      <th class="r col-pct-total">% Total</th>
    </tr>`;
  }

  // ── Render: filas de tabla ────────────────────────────────

  function renderRows(payload) {
    const body = document.getElementById("acsumBody");
    if (!body) return;
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${COLS}">
        <div class="empty"><div class="eico">📭</div>
        <p>Sin datos para los filtros actuales.</p></div>
      </td></tr>`;
      return;
    }

    body.innerHTML = rows.map((r, i) => {
      const kilosAnt = safeNum(r.kilos_ant);
      const kilos    = safeNum(r.kilos);
      const diff     = safeNum(r.diff);
      const pct      = r.pct == null ? null : Number(r.pct);
      const pctTxt   = pct == null
        ? `<span class="acsum-delta-pos">Nuevo</span>`
        : `<span class="${deltaClass(pct)}">${deltaArrow(pct)} ${Math.abs(pct).toFixed(1)}%</span>`;
      const lostTag  = r.perdido
        ? `<span class="acsum-tag-perdido">perdido</span>`
        : "";
      const rowCls   = r.perdido ? " class=\"acsum-row-lost\"" : "";

      return `<tr${rowCls}>
        <td class="acsum-td-num">${i + 1}</td>
        <td class="acsum-td-name">${escHtml(r.label || r.nombre || r.codigo || "")}${lostTag}</td>
        <td class="r acsum-td-num">${fmt(kilosAnt)}</td>
        <td class="r acsum-td-num acsum-col-actual">${fmt(kilos)}</td>
        <td class="r col-varkg ${deltaClass(diff)}">${deltaArrow(diff)} ${fmt(Math.abs(diff))}</td>
        <td class="r">
          <div class="acsum-bar-wrap">
            ${renderBar(pct)}
            ${pctTxt}
          </div>
        </td>
        <td class="r col-pct-total">${safeNum(r.participacion).toFixed(1)}%</td>
      </tr>`;
    }).join("");
  }

  // ── Render: fila de totales ───────────────────────────────

  function renderTotals(payload) {
    const foot = document.getElementById("acsumFoot");
    if (!foot) return;

    const totals = payload?.totals;
    if (!totals) { foot.innerHTML = ""; return; }

    const totalAnt    = safeNum(totals.historico);
    const totalActual = safeNum(totals.actual);
    const diff        = totalActual - totalAnt;
    const pct         = totalAnt > 0
      ? +(((totalActual - totalAnt) / totalAnt) * 100).toFixed(1)
      : null;
    const pctTxt = pct == null
      ? "—"
      : `<span class="${deltaClass(pct)}">${deltaArrow(pct)} ${Math.abs(pct).toFixed(1)}%</span>`;

    foot.innerHTML = `<tr class="acsum-row-total">
      <td colspan="2" class="acsum-total-label">TOTAL</td>
      <td class="r acsum-td-num">${fmt(totalAnt)}</td>
      <td class="r acsum-td-num acsum-col-actual">${fmt(totalActual)}</td>
      <td class="r col-varkg ${deltaClass(diff)}">${deltaArrow(diff)} ${fmt(Math.abs(diff))}</td>
      <td class="r">${pctTxt}</td>
      <td class="r col-pct-total">100%</td>
    </tr>`;
  }

  // ── Render: meta (título, pills, nota) ────────────────────

  function renderMeta(payload) {
    const setText = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };

    setText("acsumMetaMode",  MODE_LABELS[mode] || mode);
    setText("acsumMetaView",  VIEW_LABELS[view] || view);
    setText("acsumMetaCount", `${payload?.count || 0} filas`);
    setText("acsumBadge",     fmt(safeNum(payload?.totals?.actual || payload?.totalKilos || 0)));

    // Pill de rango
    const rangeEl = document.getElementById("acsumMetaRange");
    if (rangeEl && payload?.periodLabels) {
      const lbl = payload.periodLabels;
      rangeEl.hidden = false;
      rangeEl.textContent = lbl.actual && lbl.historico
        ? `${lbl.actual}  vs  ${lbl.historico}`
        : "";
    } else if (rangeEl) {
      rangeEl.hidden = true;
    }

    // Título dinámico
    const titleEl = document.getElementById("acsumTitle");
    if (titleEl) {
      const dim = VIEW_LABELS[view] || view;
      const lbl = payload?.periodLabels || {};
      if (lbl.actual && lbl.historico) {
        titleEl.innerHTML =
          `<span class="acsum-card-title">Comparativo por ${escHtml(dim)}</span>` +
          `<span class="acsum-period-labels">` +
            `<span class="acsum-period-hist">${escHtml(lbl.historico)}</span>` +
            `<span class="acsum-period-sep">vs</span>` +
            `<span class="acsum-period-actual">${escHtml(lbl.actual)}</span>` +
          `</span>`;
      } else {
        titleEl.textContent = `Comparativo por ${dim}`;
      }
    }

    // Nota
    const noteEl = document.getElementById("acsumNote");
    if (noteEl) {
      const notes = {
        compare: "Período del filtro activo comparado contra el mismo período del año anterior.",
        ytd:     "Acumulado YTD 2026 (desde el 1° de enero) vs el mismo rango del año anterior.",
        total:   "Total 2026 vs total 2025. Ignora el rango de fechas del filtro."
      };
      noteEl.textContent = notes[mode] || "";
    }
  }

  // ── Refresh principal ─────────────────────────────────────

  async function refresh() {
    const fetchKey = `${mode}|${view}|${buildQs()}`;
    if (inflight && lastFetchKey === fetchKey) return inflight;
    lastFetchKey = fetchKey;

    const body = document.getElementById("acsumBody");
    const foot = document.getElementById("acsumFoot");
    const SKELETON_ROWS = 6;
    const skeletonHtml = Array.from({ length: SKELETON_ROWS }, () => `
      <tr class="acsum-skeleton-row">
        <td><span class="acsum-skeleton-cell"></span></td>
        <td><span class="acsum-skeleton-cell"></span></td>
        <td><span class="acsum-skeleton-cell"></span></td>
        <td><span class="acsum-skeleton-cell"></span></td>
        <td class="col-varkg"><span class="acsum-skeleton-cell"></span></td>
        <td><span class="acsum-skeleton-cell"></span></td>
        <td class="col-pct-total"><span class="acsum-skeleton-cell"></span></td>
      </tr>`).join("");
    if (body) body.innerHTML = skeletonHtml;
    if (foot) foot.innerHTML = "";

    inflight = (async () => {
      try {
        const payload = await fetchData();
        if (!payload?.ok) throw new Error(payload?.error || "Error en la respuesta");
        renderHeader(payload);
        renderRows(payload);
        renderTotals(payload);
        renderMeta(payload);
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("[accumulated-summary]", err);
        if (body) {
          body.innerHTML = `<tr><td colspan="${COLS}">
            <div class="empty"><div class="eico">⚠️</div>
            <p>Error: ${escHtml(String(err.message || err))}</p></div>
          </td></tr>`;
        }
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  }

  function refreshDebounced(ms = 300) {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = 0;
      lastFetchKey = "";
      refresh();
    }, ms);
  }

  // ── Bind UI ───────────────────────────────────────────────

  function bindUI() {
    document.querySelectorAll(".acsum-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".acsum-mode-btn").forEach(b => {
          b.classList.toggle("on", b === btn);
          b.setAttribute("aria-selected", b === btn ? "true" : "false");
        });
        mode = btn.dataset.mode || "compare";
        lastFetchKey = "";
        refresh();
      });
    });

    document.querySelectorAll(".acsum-view-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".acsum-view-btn").forEach(b => {
          b.classList.toggle("on", b === btn);
          b.setAttribute("aria-selected", b === btn ? "true" : "false");
        });
        view = btn.dataset.view || "grupo";
        lastFetchKey = "";
        refresh();
      });
    });

    const refreshBtn = document.getElementById("acsumRefresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => { lastFetchKey = ""; refresh(); });
    }
  }

  return { refresh, refreshDebounced, bindUI, getMode: () => mode, getView: () => view };
}
