export function normalizeProjectionValue(value) {
  const digits = String(value ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

export function getProjectionMeta(projectionConfig = {}) {
  const habiles = parseInt(projectionConfig.habiles || '', 10);
  const transcurridos = parseInt(projectionConfig.transcurridos || '', 10);

  if (!Number.isFinite(habiles) || habiles <= 0 || !Number.isFinite(transcurridos) || transcurridos <= 0) {
    return {
      ok: false,
      reason: 'missing',
      habiles: Number.isFinite(habiles) ? habiles : 0,
      transcurridos: Number.isFinite(transcurridos) ? transcurridos : 0,
      message: 'Ingresá los días hábiles del mes y los días hábiles transcurridos para calcular la proyección.'
    };
  }

  if (transcurridos > habiles) {
    return {
      ok: false,
      reason: 'range',
      habiles,
      transcurridos,
      message: 'Los días hábiles transcurridos no pueden ser mayores que los días hábiles del mes.'
    };
  }

  const coef = transcurridos / habiles;
  const multiplier = habiles / transcurridos;
  return {
    ok: true,
    habiles,
    transcurridos,
    coef,
    multiplier,
    porcentaje: coef * 100
  };
}

export function projectValue(value, meta) {
  if (!meta?.ok) return 0;
  return Number(value || 0) * meta.multiplier;
}

export function projectRankEntries(entries, meta) {
  return (entries || []).map(item => ({ ...item, kilos: projectValue(item.kilos, meta) }));
}

export function projectionDelta(kilosProyectados, kilos2025, deps = {}) {
  const { fmtSignedPct } = deps;
  const projected = Number(kilosProyectados || 0);
  const base = Number(kilos2025 || 0);
  const deltaKg = projected - base;
  let deltaPct = null;
  let deltaPctLabel = '—';
  if (base > 0) {
    deltaPct = (deltaKg / base) * 100;
    deltaPctLabel = fmtSignedPct(deltaPct);
  } else if (projected > 0) {
    deltaPctLabel = 'Nuevo';
  } else {
    deltaPct = 0;
    deltaPctLabel = '0,0%';
  }
  const trend = deltaKg > 0 ? 'positive' : deltaKg < 0 ? 'negative' : 'neutral';
  return { deltaKg, deltaPct, deltaPctLabel, trend };
}

export function projectionTrendClass(trend) {
  if (trend === 'positive') return 'trend-chip positive';
  if (trend === 'negative') return 'trend-chip negative';
  return 'trend-chip neutral';
}

export function formatProjectionDateLabel(value, deps = {}) {
  const { parseIsoDateParts, monthNameEs } = deps;
  const parts = parseIsoDateParts(value);
  if (!parts) return String(value || '—');
  return `${parts.day} ${monthNameEs(parts.month)} ${parts.year}`;
}

export function projectionTableHeaders(expanded = false) {
  return expanded
    ? ['Fecha', 'Cliente', 'Grupo', 'Cód. Producto', 'Producto', 'Kilos 2025', 'Kilos Proy.', 'Var. Kg', 'Var. %']
    : ['Fecha', 'Cliente', 'Kilos 2025', 'Kilos Proy.', 'Var. Kg', 'Var. %'];
}

export function projectionTableColspan(expanded = false) {
  return expanded ? 9 : 6;
}

function cell(label, content, className = '') {
  const cls = className ? ` class="${className}"` : '';
  return `<td data-label="${label}"${cls}>${content}</td>`;
}

export function projectionDetailedRowHtml(r, meta, deps = {}) {
  const { toNum, escHtml, fmt, fmtSigned, fmtSignedPct } = deps;
  const kilosActuales = toNum(r.KilosActuales);
  const kilos2025 = toNum(r.Kilos2025);
  const kilosProyectados = projectValue(kilosActuales, meta);
  const delta = projectionDelta(kilosProyectados, kilos2025, { fmtSignedPct });
  return `<tr>
    ${cell('Fecha', escHtml(r.Fecha))}
    ${cell('Cliente', escHtml(r.Cliente))}
    ${cell('Grupo', escHtml(r.Grupo_Familia))}
    ${cell('Cód. Producto', escHtml(r.Cod_Producto))}
    ${cell('Producto', escHtml(r.Producto_Desc))}
    ${cell('Kilos 2025', fmt(kilos2025), 'num r')}
    ${cell('Kilos Proy.', fmt(kilosProyectados), 'num r')}
    ${cell('Var. Kg', `<span class="${projectionTrendClass(delta.trend)}">${fmtSigned(delta.deltaKg)}</span>`, 'num r')}
    ${cell('Var. %', `<span class="${projectionTrendClass(delta.trend)}">${delta.deltaPctLabel}</span>`, 'num r')}
  </tr>`;
}

export function projectionSummaryRowHtml(r, meta, deps = {}) {
  const { toNum, escHtml, fmt, fmtSigned, fmtSignedPct } = deps;
  const kilosActuales = toNum(r.KilosActuales);
  const kilos2025 = toNum(r.Kilos2025);
  const kilosProyectados = projectValue(kilosActuales, meta);
  const delta = projectionDelta(kilosProyectados, kilos2025, { fmtSignedPct });
  return `<tr>
    ${cell('Fecha', escHtml(r.Fecha))}
    ${cell('Cliente', escHtml(r.Cliente))}
    ${cell('Kilos 2025', fmt(kilos2025), 'num r')}
    ${cell('Kilos Proy.', fmt(kilosProyectados), 'num r')}
    ${cell('Var. Kg', `<span class="${projectionTrendClass(delta.trend)}">${fmtSigned(delta.deltaKg)}</span>`, 'num r')}
    ${cell('Var. %', `<span class="${projectionTrendClass(delta.trend)}">${delta.deltaPctLabel}</span>`, 'num r')}
  </tr>`;
}

export function projectionTotalRowHtml(summary, meta, expanded = false, deps = {}) {
  const { toNum, fmt, fmtSigned, fmtSignedPct } = deps;
  const kilosActuales = toNum(summary.kilosActuales);
  const kilos2025 = toNum(summary.kilos2025);
  const kilosProyectados = projectValue(kilosActuales, meta);
  const delta = projectionDelta(kilosProyectados, kilos2025, { fmtSignedPct });
  return `<tr class="row-total" style="background:rgba(245,158,11,.08);border-top:1px solid rgba(245,158,11,.28)">
    <td colspan="${expanded ? 5 : 2}" style="font-weight:700;color:var(--acc)">TOTAL FILTRADO</td>
    <td data-label="Kilos 2025" class="num r" style="font-weight:700">${fmt(kilos2025)}</td>
    <td data-label="Kilos Proy." class="num r" style="font-weight:700">${fmt(kilosProyectados)}</td>
    <td data-label="Var. Kg" class="num r"><span class="${projectionTrendClass(delta.trend)}">${fmtSigned(delta.deltaKg)}</span></td>
    <td data-label="Var. %" class="num r"><span class="${projectionTrendClass(delta.trend)}">${delta.deltaPctLabel}</span></td>
  </tr>`;
}

export function toProjectionDetailObjects(headers, rows, deps = {}) {
  const { toNum } = deps;
  const idx = Object.fromEntries((headers || []).map((h, i) => [h, i]));
  return (rows || []).map(row => ({
    Fecha: String(row[idx['Fecha']] ?? ''),
    Cliente: String(row[idx['Cliente']] ?? ''),
    Grupo_Familia: String(row[idx['Grupo_Familia']] ?? ''),
    Cod_Producto: String(row[idx['Cod_Producto']] ?? ''),
    Producto_Desc: String(row[idx['Producto_Desc']] ?? ''),
    KilosActuales: toNum(row[idx['KilosActuales']]),
    Kilos2025: toNum(row[idx['Kilos2025']])
  }));
}
