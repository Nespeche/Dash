/* frequency-controller.js — v38
 * Controlador de la pestaña "Frecuencia de Compra".
 *
 * Dos modos:
 *   cadencia — compras/semana, compras/mes, días con compra, segmentación
 *   patron   — heatmap de día de la semana por cliente
 *
 * Filtro interno: Familia (grupo_freq) — independiente del filtro global
 * Filtro de segmento: solo aplica en modo cadencia, sin re-fetch
 */

// ── Constantes de UI ─────────────────────────────────────────

const MODE_LABELS = { cadencia: "Cadencia de compra", patron: "Patrón semanal" };
const VIEW_LABELS = { cliente: "Cliente", agente: "Agente", coordinador: "Coordinador" };

const SEG_META = {
  frecuente:  { label: "Frecuente",  title: "≥2 compras/semana",  cls: "freq-seg-frecuente"  },
  semanal:    { label: "Semanal",    title: "≈1 compra/semana",   cls: "freq-seg-semanal"    },
  quincenal:  { label: "Quincenal",  title: "Cada 2 semanas",     cls: "freq-seg-quincenal"  },
  mensual:    { label: "Mensual",    title: "1–2 compras/mes",    cls: "freq-seg-mensual"    },
  ocasional:  { label: "Ocasional",  title: "Menos de 1/mes",     cls: "freq-seg-ocasional"  },
  inactivo:   { label: "Inactivo",   title: "+90 días sin compra", cls: "freq-seg-inactivo"  },
};

const DOW_ORDER  = ["lun","mar","mie","jue","vie","sab","dom"];
const DOW_LABELS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

// columnas según modo
const COLS_CADENCIA = 8;  // #, nombre, /sem, /mes, días, última, días sin, segmento
const COLS_PATRON   = 10; // #, nombre, Lun–Dom, preferido, total

// ── Helpers ───────────────────────────────────────────────────

function safeNum(v) { return Number(v || 0); }

function fmtDate(iso) {
  if (!iso) return "—";
  const p = iso.split("-");
  if (p.length < 3) return iso;
  return `${p[2]}/${p[1]}/${p[0].slice(2)}`;
}

function fmtDias(n) {
  if (n <= 0) return "hoy";
  if (n === 1) return "1 día";
  return `${n} días`;
}

function fmtRate(n) {
  if (n === 0) return "0";
  if (n < 0.1)  return n.toFixed(2);
  if (n < 1)    return n.toFixed(2);
  return n.toFixed(1);
}

function segBadge(seg, escHtml) {
  const m = SEG_META[seg] || SEG_META.ocasional;
  return `<span class="${m.cls} freq-seg-badge" title="${escHtml(m.title)}">${escHtml(m.label)}</span>`;
}

function dowBar(count, maxCount, escHtml) {
  if (maxCount === 0) return `<span class="freq-dow-zero">—</span>`;
  const w   = Math.round((count / maxCount) * 100);
  const cls = count === maxCount ? "freq-dow-bar max" : "freq-dow-bar";
  return `<div class="${cls}" style="width:${Math.max(w, count > 0 ? 6 : 0)}%">
    ${count > 0 ? `<span class="freq-dow-val">${count}</span>` : ""}
  </div>`;
}

function skeletonRows(cols, count = 7) {
  return Array.from({ length: count }, () =>
    `<tr class="acsum-skeleton-row">${
      Array.from({ length: cols }, () =>
        `<td><span class="acsum-skeleton-cell" style="width:${30 + (Math.random() * 50 | 0)}px"></span></td>`
      ).join("")
    }</tr>`
  ).join("");
}

// ── Controller factory ────────────────────────────────────────

export function createFrequencyController({
  apiBase, getFiltros, getPeriodo, fmt, escHtml, getAuthToken
}) {
  let mode       = "cadencia";
  let view       = "cliente";
  let grupoFreq  = "";       // filtro de familia interno
  let segFilter  = "";       // filtro de segmento local (sin re-fetch)
  let lastKey    = "";
  let inflight   = null;
  let abortCtrl  = null;
  let debTimer   = 0;
  let lastPayload = null;

  // ── Query string ────────────────────────────────────────────

  function buildQs() {
    const f = getFiltros() || {};
    const p = getPeriodo() || {};
    const ps = new URLSearchParams();
    ps.set("mode",  mode);
    ps.set("view",  view);
    ps.set("limit", "150");
    if (grupoFreq) ps.set("grupo_freq", grupoFreq);
    if (p.desde) ps.set("desde", p.desde);
    if (p.hasta) ps.set("hasta", p.hasta);
    if (f.coordinador) ps.set("coordinador", f.coordinador);
    if (f.agente)      ps.set("agente",      f.agente);
    if (f.cliente)     ps.set("cliente",     f.cliente);
    if (f.grupo)       ps.set("grupo",       f.grupo);
    if (f.marca)       ps.set("marca",       f.marca);
    if (f.region)      ps.set("region",      f.region);
    if (Array.isArray(f.codProd) && f.codProd.length)
      f.codProd.forEach(c => ps.append("codProd", c));
    return ps.toString();
  }

  // ── Fetch ───────────────────────────────────────────────────

  async function fetchData() {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    const url = `${apiBase}/frequency?${buildQs()}`;
    const headers = { Accept: "application/json" };
    const token = typeof getAuthToken === "function" ? getAuthToken() : "";
    if (token) headers.Authorization = `Basic ${token}`;
    const res = await fetch(url, { headers, signal: abortCtrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // ── Render modo CADENCIA ────────────────────────────────────

  function renderHeaderCadencia() {
    const el = document.getElementById("freqHead");
    if (!el) return;
    el.innerHTML = `<tr>
      <th class="freq-th-num">#</th>
      <th>${escHtml(VIEW_LABELS[view] || view)}</th>
      <th class="r" title="Días distintos con compra dividido por semanas del período">Compras / sem.</th>
      <th class="r" title="Días distintos con compra dividido por meses del período">Compras / mes</th>
      <th class="r" title="Cantidad de días distintos en que realizó al menos una compra">Días con compra</th>
      <th class="r">Última compra</th>
      <th class="r">Sin comprar</th>
      <th>Segmento</th>
    </tr>`;
  }

  function renderRowsCadencia(payload) {
    const body = document.getElementById("freqBody");
    if (!body) return;

    let rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (segFilter) rows = rows.filter(r => r.segmento === segFilter);

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${COLS_CADENCIA}">
        <div class="empty"><div class="eico">📭</div>
        <p>${segFilter
          ? `Sin registros con segmento "${SEG_META[segFilter]?.label || segFilter}".`
          : "Sin datos para los filtros actuales."}</p>
        </div></td></tr>`;
      return;
    }

    body.innerHTML = rows.map((r, i) => {
      const cSem    = safeNum(r.compras_semana);
      const cMes    = safeNum(r.compras_mes);
      const diasSin = safeNum(r.dias_sin_compra);
      const alerta  = diasSin > 90 ? " freq-dias-alerta" : diasSin > 30 ? " freq-dias-warning" : "";
      const semBar  = Math.min(cSem / 5 * 100, 100); // escala: 5/sem = 100%

      return `<tr class="freq-row freq-row-${escHtml(r.segmento || "ocasional")}">
        <td class="freq-td-num">${i + 1}</td>
        <td class="freq-td-name">${escHtml(r.label || r.nombre || r.codigo || "")}</td>
        <td class="r">
          <div class="freq-rate-wrap">
            <div class="freq-rate-bar-track">
              <div class="freq-rate-bar" style="width:${semBar.toFixed(0)}%"></div>
            </div>
            <span class="freq-rate-val">${fmtRate(cSem)}<span class="freq-rate-unit">/sem</span></span>
          </div>
        </td>
        <td class="r">
          <span class="freq-rate-val">${fmtRate(cMes)}<span class="freq-rate-unit">/mes</span></span>
        </td>
        <td class="r freq-td-num">${safeNum(r.dias_con_compra)} d.</td>
        <td class="r freq-td-date">${escHtml(fmtDate(r.ultima))}</td>
        <td class="r freq-td-dias${alerta}">${escHtml(fmtDias(diasSin))}</td>
        <td>${segBadge(r.segmento, escHtml)}</td>
      </tr>`;
    }).join("");
  }

  function renderTotalsCadencia(payload) {
    const foot = document.getElementById("freqFoot");
    if (!foot) return;
    const t = payload?.totals;
    if (!t) { foot.innerHTML = ""; return; }

    foot.innerHTML = `<tr class="freq-row-total">
      <td colspan="2" class="freq-total-label">PROMEDIO DEL CONJUNTO</td>
      <td class="r"><span class="freq-rate-val">${fmtRate(safeNum(t.promedioSemana))}<span class="freq-rate-unit">/sem</span></span></td>
      <td class="r"><span class="freq-rate-val">${fmtRate(safeNum(t.promedioMes))}<span class="freq-rate-unit">/mes</span></span></td>
      <td class="r freq-td-num">${safeNum(t.diasConCompra)} d.</td>
      <td class="r">—</td>
      <td class="r">—</td>
      <td>—</td>
    </tr>`;

    // Panel de segmentos
    const panel = document.getElementById("freqSegPanel");
    if (!panel) return;
    const total = payload.count || 1;
    const seg   = t.segmentos || {};
    panel.innerHTML = Object.entries(SEG_META).map(([key, m]) => {
      const cnt = safeNum(seg[key]);
      const pct = total > 0 ? ((cnt / total) * 100).toFixed(0) : 0;
      const on  = segFilter === key ? " freq-seg-pill-on" : "";
      return `<button type="button" class="freq-seg-pill${on} ${m.cls}-pill"
        data-seg="${escHtml(key)}" title="${escHtml(m.title)}">
        <span class="freq-seg-pill-label">${escHtml(m.label)}</span>
        <span class="freq-seg-pill-count">${cnt}</span>
        <span class="freq-seg-pill-pct">${pct}%</span>
      </button>`;
    }).join("");
  }

  // ── Render modo PATRÓN ──────────────────────────────────────

  function renderHeaderPatron() {
    const el = document.getElementById("freqHead");
    if (!el) return;
    el.innerHTML = `<tr>
      <th class="freq-th-num">#</th>
      <th>Cliente</th>
      ${DOW_LABELS.map(d => `<th class="r freq-dow-th">${escHtml(d)}</th>`).join("")}
      <th>Día preferido</th>
      <th class="r">Total días</th>
    </tr>`;
  }

  function renderRowsPatron(payload) {
    const body = document.getElementById("freqBody");
    if (!body) return;
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${COLS_PATRON}">
        <div class="empty"><div class="eico">📭</div>
        <p>Sin datos para los filtros actuales.</p></div></td></tr>`;
      return;
    }

    // Máximo global por día para normalizar las barras
    const dowMax = {};
    DOW_ORDER.forEach(d => {
      dowMax[d] = Math.max(...rows.map(r => r[d] || 0), 1);
    });
    const globalMax = Math.max(...DOW_ORDER.map(d => dowMax[d]), 1);

    body.innerHTML = rows.map((r, i) => {
      const preferidoCls = DOW_ORDER.includes(r.dia_preferido?.slice(0,3).toLowerCase())
        ? `freq-dow-pref-${r.dia_preferido.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").slice(0,3)}`
        : "";
      return `<tr class="freq-row-patron">
        <td class="freq-td-num">${i + 1}</td>
        <td class="freq-td-name">${escHtml(r.label || r.nombre || r.codigo || "")}</td>
        ${DOW_ORDER.map(d => `<td class="r freq-dow-cell">
          ${dowBar(safeNum(r[d]), globalMax, escHtml)}
        </td>`).join("")}
        <td class="freq-dow-pref ${escHtml(preferidoCls)}">${escHtml(r.dia_preferido || "—")}</td>
        <td class="r freq-td-num">${safeNum(r.total_dias)}</td>
      </tr>`;
    }).join("");
  }

  function renderTotalsPatron(payload) {
    const foot = document.getElementById("freqFoot");
    if (!foot) return;
    const dt = payload?.dowTotals;
    if (!dt) { foot.innerHTML = ""; return; }

    const maxVal = Math.max(...DOW_ORDER.map(d => dt[d] || 0), 1);
    foot.innerHTML = `<tr class="freq-row-total">
      <td colspan="2" class="freq-total-label">TOTAL CONJUNTO</td>
      ${DOW_ORDER.map(d => {
        const w = Math.round(((dt[d] || 0) / maxVal) * 100);
        const isBest = (payload.dowMax === d);
        return `<td class="r freq-dow-cell">
          <div class="freq-dow-bar${isBest ? " max" : ""}" style="width:${Math.max(w,2)}%">
            <span class="freq-dow-val">${dt[d] || 0}</span>
          </div>
        </td>`;
      }).join("")}
      <td>—</td>
      <td class="r freq-td-num">—</td>
    </tr>`;
  }

  // ── Render: meta (título + pills) ────────────────────────────

  function renderMeta(payload) {
    const setText = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    const ml  = MODE_LABELS[mode]  || mode;
    const vl  = VIEW_LABELS[view]  || view;
    const cnt = segFilter
      ? `${(payload?.rows||[]).filter(r => r.segmento === segFilter).length} filtrados`
      : `${payload?.count || 0} filas`;

    setText("freqMetaMode",  ml);
    setText("freqMetaView",  mode === "patron" ? "por Cliente" : `por ${vl}`);
    setText("freqMetaCount", cnt);
    if (grupoFreq) {
      setText("freqMetaGrupo", `Familia: ${grupoFreq}`);
      const el = document.getElementById("freqMetaGrupoWrap");
      if (el) el.hidden = false;
    } else {
      const el = document.getElementById("freqMetaGrupoWrap");
      if (el) el.hidden = true;
    }

    const titleEl = document.getElementById("freqTitle");
    if (titleEl) {
      let t = mode === "cadencia"
        ? `Cadencia de compra por ${vl}`
        : "Patrón semanal por Cliente";
      if (grupoFreq) t += ` · ${grupoFreq}`;
      titleEl.textContent = t;
    }

    const noteEl = document.getElementById("freqNote");
    if (noteEl) {
      noteEl.textContent = mode === "cadencia"
        ? "Compras/semana y compras/mes = días distintos con compra dividido por semanas o meses del rango analizado. Ejemplo: cliente que compra todos los lunes → 1.0/sem, 4.3/mes."
        : "Cada celda muestra cuántos días distintos compró el cliente en ese día de la semana dentro del período. La barra más larga indica el día preferido.";
    }
  }

  // ── Refresh principal ─────────────────────────────────────

  async function refresh() {
    const key = `${mode}|${view}|${grupoFreq}|${buildQs()}`;
    if (inflight && lastKey === key) return inflight;
    lastKey   = key;
    segFilter = "";
    updateSegPillsActive();

    const body = document.getElementById("freqBody");
    const foot = document.getElementById("freqFoot");
    const cols = mode === "patron" ? COLS_PATRON : COLS_CADENCIA;
    if (body) body.innerHTML = skeletonRows(cols, 8);
    if (foot) foot.innerHTML = "";

    inflight = (async () => {
      try {
        const payload = await fetchData();
        if (!payload?.ok) throw new Error(payload?.error || "Error en la respuesta");
        lastPayload = payload;
        if (mode === "patron") {
          renderHeaderPatron();
          renderRowsPatron(payload);
          renderTotalsPatron(payload);
        } else {
          renderHeaderCadencia();
          renderRowsCadencia(payload);
          renderTotalsCadencia(payload);
        }
        renderMeta(payload);
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("[frequency-controller]", err);
        const cols2 = mode === "patron" ? COLS_PATRON : COLS_CADENCIA;
        if (body) body.innerHTML = `<tr><td colspan="${cols2}">
          <div class="empty"><div class="eico">⚠️</div>
          <p>Error: ${escHtml(String(err.message || err))}</p></div>
        </td></tr>`;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function refreshDebounced(ms = 300) {
    clearTimeout(debTimer);
    debTimer = window.setTimeout(() => { debTimer = 0; lastKey = ""; refresh(); }, ms);
  }

  // ── Filtro de segmento local ──────────────────────────────

  function applySegFilter(seg) {
    segFilter = (segFilter === seg) ? "" : seg;
    updateSegPillsActive();
    if (lastPayload) { renderRowsCadencia(lastPayload); renderMeta(lastPayload); }
  }

  function updateSegPillsActive() {
    document.querySelectorAll(".freq-seg-pill").forEach(b => {
      b.classList.toggle("freq-seg-pill-on", b.dataset.seg === segFilter);
    });
  }

  // ── Poblar selector de familia desde el estado global ─────

  function populateGrupoFreqSelect(grupos) {
    const sel = document.getElementById("freqGrupoSel");
    if (!sel || !Array.isArray(grupos)) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Todas las familias</option>` +
      grupos.map(g => `<option value="${escHtml(String(g))}"${g === current ? " selected" : ""}>${escHtml(String(g))}</option>`).join("");
    if (grupoFreq && grupos.includes(grupoFreq)) sel.value = grupoFreq;
  }

  // ── Bind UI ──────────────────────────────────────────────

  function bindUI() {
    // Modo: cadencia | patron
    document.querySelectorAll(".freq-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".freq-mode-btn").forEach(b => {
          b.classList.toggle("on", b === btn);
          b.setAttribute("aria-selected", b === btn ? "true" : "false");
        });
        mode = btn.dataset.mode || "cadencia";
        // Mostrar/ocultar view buttons (solo cadencia)
        const viewRow = document.getElementById("freqViewRow");
        if (viewRow) viewRow.hidden = (mode === "patron");
        // v40: ocultar panel de segmentos en modo Patrón (no aplica)
        const segShell = document.getElementById("freqSegShell");
        if (segShell) segShell.hidden = (mode === "patron");
        lastKey = "";
        refresh();
      });
    });

    // Vista: cliente | agente | coordinador (solo cadencia)
    document.querySelectorAll(".freq-view-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".freq-view-btn").forEach(b => {
          b.classList.toggle("on", b === btn);
          b.setAttribute("aria-selected", b === btn ? "true" : "false");
        });
        view = btn.dataset.view || "cliente";
        lastKey = "";
        refresh();
      });
    });

    // Selector de familia interno
    const grupoSel = document.getElementById("freqGrupoSel");
    if (grupoSel) {
      grupoSel.addEventListener("change", () => {
        grupoFreq = grupoSel.value || "";
        lastKey   = "";
        refresh();
      });
    }

    // Actualizar
    const refreshBtn = document.getElementById("freqRefresh");
    if (refreshBtn) refreshBtn.addEventListener("click", () => { lastKey = ""; refresh(); });

    // Segmentos (delegado)
    const segPanel = document.getElementById("freqSegPanel");
    if (segPanel) {
      segPanel.addEventListener("click", ev => {
        const btn = ev.target.closest(".freq-seg-pill");
        if (!btn) return;
        applySegFilter(btn.dataset.seg || "");
      });
    }
  }

  return { refresh, refreshDebounced, bindUI, populateGrupoFreqSelect,
           getMode: () => mode, getView: () => view };
}
