// ─── Helpers privados ─────────────────────────────────────────────────────────

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inferMetricMeterTone(column = {}, value = 0, explicitTone = "") {
  if (explicitTone) return explicitTone;
  const key = String(column?.key || "");
  if (key === "VarKg") return Number(value || 0) < 0 ? "negative" : Number(value || 0) > 0 ? "positive" : "neutral";
  if (key === "KilosProyectados" || key === "Kilos") return "accent";
  if (key === "Kilos2025") return "soft";
  if (["Registros", "Productos", "Grupos", "Fechas", "Clientes", "Participacion"].includes(key)) return "soft";
  return Number(value || 0) < 0 ? "negative" : Number(value || 0) > 0 ? "positive" : "neutral";
}

// ─── Exports públicos ──────────────────────────────────────────────────────────

export function shouldRenderMetricMeter(column = {}, includeKeys = []) {
  const key = String(column?.key || "");
  if (column?.type !== "number" || !key) return false;
  if (Array.isArray(includeKeys) && includeKeys.length) return includeKeys.includes(key);
  return ["Kilos", "Kilos2025", "KilosProyectados", "VarKg", "Participacion", "Grupos", "Productos", "Fechas", "Registros", "Clientes"].includes(key);
}

export function buildSummaryMetrics(rows = []) {
  const uniqueClientes = new Set();
  const uniqueGrupos = new Set();
  const uniqueProductos = new Set();
  const uniqueFechas = new Set();
  let kilos = 0;

  rows.forEach(row => {
    uniqueClientes.add(String(row.Cliente || ""));
    uniqueGrupos.add(String(row.Grupo_Familia || ""));
    uniqueProductos.add(String(row.Cod_Producto || ""));
    uniqueFechas.add(String(row.Fecha || ""));
    kilos += Number(row.Kilos || 0);
  });

  return {
    kilos,
    clientes: [...uniqueClientes].filter(Boolean).length,
    grupos: [...uniqueGrupos].filter(Boolean).length,
    productos: [...uniqueProductos].filter(Boolean).length,
    fechas: [...uniqueFechas].filter(Boolean).length,
    registros: rows.length
  };
}

export function buildNumericScaleMap(rows = [], columns = [], options = {}) {
  const includeKeys = Array.isArray(options?.includeKeys) ? options.includeKeys.map(value => String(value || "")).filter(Boolean) : [];
  const includeSet = includeKeys.length ? new Set(includeKeys) : null;
  const scaleMap = {};
  (Array.isArray(columns) ? columns : []).forEach(column => {
    const key = String(column?.key || "");
    if (column?.type !== "number" || !key) return;
    if (includeSet && !includeSet.has(key)) return;
    let maxAbs = 0;
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const value = Math.abs(Number(row?.[key] || 0));
      if (value > maxAbs) maxAbs = value;
    });
    if (maxAbs > 0) scaleMap[key] = maxAbs;
  });
  return scaleMap;
}

export function renderNumericMeterCell(raw, column, fmt, options = {}) {
  const num = Number(raw || 0);
  const maxAbs = Number(options?.scaleMap?.[column?.key] || 0);
  const fillPct = maxAbs > 0 ? Math.max(num ? 14 : 0, Math.min(100, (Math.abs(num) / maxAbs) * 100)) : 0;
  const tone = inferMetricMeterTone(column, num, options?.tone || "");
  const formatter = typeof options?.valueFormatter === "function" ? options.valueFormatter : fmt;
  const displayValue = formatter(num);
  return `<span class="metric-meter metric-meter--${tone}${fillPct > 0 ? ' has-fill' : ''}" style="--metric-fill:${fillPct.toFixed(1)}%"><span class="metric-meter__fill" aria-hidden="true"></span><span class="metric-meter__value">${esc(displayValue)}</span></span>`;
}
