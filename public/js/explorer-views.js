import {
  applyColumnFilters,
  bindCopyCells,
  bindHeaderInteractions,
  buildColumnOptions,
  buildNumericScaleMap,
  buildSearchPreview,
  cleanupFloatingColumnMenus,
  escapeHtml,
  filterRowsBySearch,
  makeColumn,
  normalizeSortStack,
  renderDataCellContent,
  renderHeaderCell,
  renderNumericMeterCell,
  renderToolbar,
  positionOpenColumnMenus,
  sortRows
} from "./table-ui.js";
import {
  projectValue,
  projectionDelta,
  projectionTrendClass
} from "./projection.js";

function uniqueCount(values = []) {
  return [...new Set((values || []).map(value => String(value || "").trim()).filter(Boolean))].length;
}

export function createExplorerState(defaults = {}) {
  const view = String(defaults.view || "detalle");
  return {
    view,
    sort: String(defaults.sort || "default"),
    direction: defaults.direction === "asc" ? "asc" : "desc",
    search: String(defaults.search || ""),
    sortStack: Array.isArray(defaults.sortStack) ? defaults.sortStack.map(item => ({
      key: String(item?.key || ""),
      direction: item?.direction === "asc" ? "asc" : "desc"
    })).filter(item => item.key) : [],
    columnFilters: defaults.columnFilters && typeof defaults.columnFilters === "object"
      ? Object.fromEntries(Object.entries(defaults.columnFilters).map(([key, values]) => [
          String(key || ""),
          Array.isArray(values) ? [...new Set(values.map(value => String(value ?? "")).filter(value => value !== ""))] : []
        ]).filter(([key, values]) => key && values.length))
      : {},
    openColumnMenu: String(defaults.openColumnMenu || ""),
    metric: String(defaults.metric || "Kilos"),
    topN: String(defaults.topN || "50"),
    groupOthers: Object.prototype.hasOwnProperty.call(defaults, "groupOthers") ? Boolean(defaults.groupOthers) : true,
    showAdvanced: Boolean(defaults.showAdvanced),
    currentPreset: String(defaults.currentPreset || "custom"),
    favoriteId: String(defaults.favoriteId || "")
  };
}

export function patchExplorerState(current = {}, patch = {}, defaults = {}) {
  const base = createExplorerState({ ...defaults, ...current });
  const nextSortStack = Object.prototype.hasOwnProperty.call(patch, "sortStack")
    ? (Array.isArray(patch.sortStack) ? patch.sortStack.map(item => ({
        key: String(item?.key || ""),
        direction: item?.direction === "asc" ? "asc" : "desc"
      })).filter(item => item.key) : [])
    : base.sortStack;

  const nextColumnFilters = Object.prototype.hasOwnProperty.call(patch, "columnFilters")
    ? Object.fromEntries(Object.entries(patch.columnFilters || {}).map(([key, values]) => [
        String(key || ""),
        Array.isArray(values) ? [...new Set(values.map(value => String(value ?? "")).filter(value => value !== ""))] : []
      ]).filter(([key, values]) => key && values.length))
    : base.columnFilters;

  return {
    ...base,
    ...patch,
    view: Object.prototype.hasOwnProperty.call(patch, "view") ? String(patch.view || defaults.view || base.view) : base.view,
    sort: Object.prototype.hasOwnProperty.call(patch, "sort") ? String(patch.sort || defaults.sort || base.sort) : base.sort,
    direction: Object.prototype.hasOwnProperty.call(patch, "direction")
      ? (patch.direction === "asc" ? "asc" : "desc")
      : base.direction,
    search: Object.prototype.hasOwnProperty.call(patch, "search") ? String(patch.search || "") : base.search,
    sortStack: nextSortStack,
    columnFilters: nextColumnFilters,
    openColumnMenu: Object.prototype.hasOwnProperty.call(patch, "openColumnMenu") ? String(patch.openColumnMenu || "") : base.openColumnMenu,
    metric: Object.prototype.hasOwnProperty.call(patch, "metric") ? String(patch.metric || base.metric || "Kilos") : base.metric,
    topN: Object.prototype.hasOwnProperty.call(patch, "topN") ? String(patch.topN || base.topN || "50") : base.topN,
    groupOthers: Object.prototype.hasOwnProperty.call(patch, "groupOthers") ? Boolean(patch.groupOthers) : base.groupOthers,
    showAdvanced: Object.prototype.hasOwnProperty.call(patch, "showAdvanced") ? Boolean(patch.showAdvanced) : base.showAdvanced,
    currentPreset: Object.prototype.hasOwnProperty.call(patch, "currentPreset") ? String(patch.currentPreset || "custom") : base.currentPreset,
    favoriteId: Object.prototype.hasOwnProperty.call(patch, "favoriteId") ? String(patch.favoriteId || "") : base.favoriteId
  };
}

const EXPLORER_TOP_N_OPTIONS = [["10", "Top 10"], ["20", "Top 20"], ["50", "Top 50"], ["100", "Top 100"], ["all", "Todo"]];

const PROJECTION_PRESETS = [
  { id: "projection-clientes", label: "Top clientes", icon: "👥", hint: "Clientes con mayor proyeccion", view: "cliente", metric: "KilosProyectados", topN: "20", groupOthers: true },
  { id: "projection-productos", label: "Top productos", icon: "📦", hint: "Productos con mayor traccion proyectada", view: "producto", metric: "KilosProyectados", topN: "20", groupOthers: true },
  { id: "projection-gap", label: "Mayor brecha", icon: "📉", hint: "Mayor diferencia contra 2025", view: "cliente", metric: "VarKg", topN: "20", groupOthers: false },
  { id: "projection-fechas", label: "Fechas clave", icon: "🗓️", hint: "Seguimiento diario comparado", view: "fecha", metric: "KilosProyectados", topN: "20", groupOthers: false }
];

const ACCUM_PRESETS = [
  { id: "accum-clientes", label: "Top clientes", view: "clientes", metric: "Kilos", topN: "20", groupOthers: true },
  { id: "accum-coords", label: "Top coordinadores", view: "coordinadores", metric: "Kilos", topN: "10", groupOthers: true },
  { id: "accum-grupos", label: "Top grupos", view: "grupos", metric: "Kilos", topN: "10", groupOthers: true },
  { id: "accum-mix", label: "Mayor mix comercial", view: "clientes", metric: "Kilos", topN: "20", groupOthers: false }
];

function parseTopN(value = "all") {
  const raw = String(value || "all").trim().toLowerCase();
  if (!raw || raw === "all") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
}

function normalizeMetricKey(metric = "", fallback = "Kilos") {
  const next = String(metric || fallback);
  return next || fallback;
}

function normalizeFilterValue(value, type = "text") {
  return type === "number" ? String(Number(value || 0)) : String(value ?? "");
}

function buildSelectionComparison(rows = [], columns = [], explorer = {}, metricKey = "Kilos", fmtMetric = value => String(value)) {
  const activeFilters = explorer?.columnFilters && typeof explorer.columnFilters === "object" ? explorer.columnFilters : {};
  const entry = Object.entries(activeFilters).find(([, values]) => Array.isArray(values) && values.length === 2);
  if (!entry) return "";
  const [key, selectedValues] = entry;
  const column = columns.find(item => item.key === key);
  if (!column) return "";
  const relaxedFilters = { ...activeFilters };
  delete relaxedFilters[key];
  const universe = applyColumnFilters(rows, columns, { columnFilters: relaxedFilters });
  if (!universe.length) return "";
  const metricLabel = metricKey === "KilosProyectados" ? "kilos proyectados" : metricKey === "VarKg" ? "brecha visible" : "kilos visibles";
  const items = selectedValues.map(value => {
    const matches = universe.filter(row => normalizeFilterValue(row?.[key], column.type) === normalizeFilterValue(value, column.type));
    return {
      label: String(value || "(vacio)"),
      rows: matches.length,
      total: matches.reduce((acc, row) => acc + Number(row?.[metricKey] || 0), 0)
    };
  });
  if (items.some(item => item.rows === 0)) return "";
  const delta = items[0].total - items[1].total;
  const leader = delta >= 0 ? items[0] : items[1];
  const lagger = delta >= 0 ? items[1] : items[0];
  return `<div class="detail-compare-row"><span><strong>${escapeHtml(leader.label)}</strong> ${fmtMetric(leader.total)}</span><span><strong>${escapeHtml(lagger.label)}</strong> ${fmtMetric(lagger.total)}</span><span>Diferencia <strong>${fmtMetric(Math.abs(delta))}</strong> en ${metricLabel}</span></div>`;
}

function buildExecutiveSummary({ rows = [], visibleRows = [], totalMetric = 0, metricKey = "Kilos", fmtMetric = value => String(value), mixLabel = "mix visible" } = {}) {
  if (!rows.length || !visibleRows.length) return "";
  const topValue = Number(visibleRows[0]?.[metricKey] || 0);
  const topShare = totalMetric > 0 ? (topValue / totalMetric) * 100 : 0;
  const top5Value = visibleRows.slice(0, 5).reduce((acc, row) => acc + Number(row?.[metricKey] || 0), 0);
  const top5Share = totalMetric > 0 ? (top5Value / totalMetric) * 100 : 0;
  const tone = topShare >= 45 || top5Share >= 80
    ? "Alta concentracion"
    : topShare >= 25 || top5Share >= 60
      ? "Concentracion media"
      : "Distribucion abierta";
  return `<div class="detail-insight-stack"><span><strong>${tone}</strong> · Top 1 ${topShare.toFixed(0)}% · Top 5 ${top5Share.toFixed(0)}%</span><span>${escapeHtml(mixLabel)} · ${fmtMetric(totalMetric)}</span></div>`;
}

function createOthersRow(view = "cliente", rows = [], metricKey = "Kilos", extra = {}) {
  if (!rows.length) return null;
  const base = rows.reduce((acc, row) => ({
    ...acc,
    Kilos: acc.Kilos + Number(row?.Kilos || 0),
    Kilos2025: acc.Kilos2025 + Number(row?.Kilos2025 || 0),
    KilosProyectados: acc.KilosProyectados + Number(row?.KilosProyectados || 0),
    VarKg: acc.VarKg + Number(row?.VarKg || 0),
    Participacion: acc.Participacion + Number(row?.Participacion || 0)
  }), { Kilos: 0, Kilos2025: 0, KilosProyectados: 0, VarKg: 0, Participacion: 0 });
  const label = `Otros (${rows.length})`;
  if (view === "cliente") return { Cliente: label, Fechas: uniqueCount(rows.map(row => row.Fecha)), Productos: uniqueCount(rows.map(row => row.Cod_Producto)), Clientes: rows.length, ...base, VarPctValue: null, VarPctLabel: "Otros", Trend: "neutral", ...extra };
  if (view === "grupo") return { Grupo_Familia: label, Clientes: uniqueCount(rows.map(row => row.Cliente)), Productos: uniqueCount(rows.map(row => row.Cod_Producto)), ...base, VarPctValue: null, VarPctLabel: "Otros", Trend: "neutral", ...extra };
  if (view === "producto") return { Cod_Producto: "OTROS", Producto_Desc: label, Clientes: uniqueCount(rows.map(row => row.Cliente)), ...base, VarPctValue: null, VarPctLabel: "Otros", Trend: "neutral", ...extra };
  if (view === "fecha") return { Fecha: label, Clientes: uniqueCount(rows.map(row => row.Cliente)), Productos: uniqueCount(rows.map(row => row.Cod_Producto)), ...base, VarPctValue: null, VarPctLabel: "Otros", Trend: "neutral", ...extra };
  return { Nombre: label, Cliente: label, ...base, ...extra };
}

function computeProjectionRow(row, meta, fmtSignedPct) {
  const kilosActuales = Number(row.KilosActuales || 0);
  const kilos2025 = Number(row.Kilos2025 || 0);
  const kilosProyectados = projectValue(kilosActuales, meta);
  const delta = projectionDelta(kilosProyectados, kilos2025, { fmtSignedPct });
  return {
    Fecha: String(row.Fecha || ""),
    Cliente: String(row.Cliente || ""),
    Grupo_Familia: String(row.Grupo_Familia || ""),
    Cod_Producto: String(row.Cod_Producto || ""),
    Producto_Desc: String(row.Producto_Desc || ""),
    Kilos2025: kilos2025,
    KilosProyectados: kilosProyectados,
    VarKg: delta.deltaKg,
    VarPctValue: Number.isFinite(Number(delta.deltaPct)) ? Number(delta.deltaPct) : null,
    VarPctLabel: delta.deltaPctLabel,
    Trend: delta.trend
  };
}

function aggregateProjectionRows(rows = [], view = "detalle", fmtSignedPct) {
  if (view === "detalle") return rows.slice();

  const map = new Map();
  const keyFor = row => {
    if (view === "cliente") return String(row.Cliente || "Sin cliente");
    if (view === "grupo") return String(row.Grupo_Familia || "Sin grupo");
    if (view === "producto") return `${String(row.Cod_Producto || "")}|${String(row.Producto_Desc || "")}`;
    if (view === "fecha") return String(row.Fecha || "Sin fecha");
    return String(row.Cliente || "Sin cliente");
  };

  rows.forEach(row => {
    const key = keyFor(row);
    if (!map.has(key)) {
      map.set(key, {
        Cliente: String(row.Cliente || ""),
        Grupo_Familia: String(row.Grupo_Familia || ""),
        Cod_Producto: String(row.Cod_Producto || ""),
        Producto_Desc: String(row.Producto_Desc || ""),
        Fecha: String(row.Fecha || ""),
        Kilos2025: 0,
        KilosProyectados: 0,
        _clientes: new Set(),
        _productos: new Set(),
        _fechas: new Set()
      });
    }
    const bucket = map.get(key);
    bucket.Kilos2025 += Number(row.Kilos2025 || 0);
    bucket.KilosProyectados += Number(row.KilosProyectados || 0);
    bucket._clientes.add(String(row.Cliente || ""));
    bucket._productos.add(String(row.Cod_Producto || ""));
    bucket._fechas.add(String(row.Fecha || ""));
  });

  return [...map.values()].map(bucket => {
    const delta = projectionDelta(bucket.KilosProyectados, bucket.Kilos2025, { fmtSignedPct });
    return {
      Fecha: bucket.Fecha,
      Cliente: bucket.Cliente,
      Grupo_Familia: bucket.Grupo_Familia,
      Cod_Producto: bucket.Cod_Producto,
      Producto_Desc: bucket.Producto_Desc,
      Fechas: bucket._fechas.size,
      Clientes: bucket._clientes.size,
      Productos: bucket._productos.size,
      Kilos2025: bucket.Kilos2025,
      KilosProyectados: bucket.KilosProyectados,
      VarKg: delta.deltaKg,
      VarPctValue: Number.isFinite(Number(delta.deltaPct)) ? Number(delta.deltaPct) : null,
      VarPctLabel: delta.deltaPctLabel,
      Trend: delta.trend
    };
  });
}

function getProjectionViewOptions(expanded = false) {
  return expanded
    ? [["detalle", "Detalle"], ["cliente", "Por cliente"], ["grupo", "Por grupo"], ["producto", "Por producto"], ["fecha", "Por dia"]]
    : [["cliente", "Por cliente"], ["fecha", "Por dia"]];
}

function getProjectionColumns(view = "detalle", expanded = false) {
  if (!expanded) {
    if (view === "fecha") {
      return [
        makeColumn("Fecha", "Fecha", "date"),
        makeColumn("Clientes", "Clientes", "number", "r"),
        makeColumn("Kilos2025", "Kilos 2025", "number", "r"),
        makeColumn("KilosProyectados", "Kilos Proy.", "number", "r"),
        makeColumn("VarKg", "Var. Kg", "number", "r"),
        makeColumn("VarPctValue", "Var. %", "number", "r")
      ];
    }
    return [
      makeColumn("Cliente", "Cliente"),
      makeColumn("Fechas", "Fechas", "number", "r"),
      makeColumn("Kilos2025", "Kilos 2025", "number", "r"),
      makeColumn("KilosProyectados", "Kilos Proy.", "number", "r"),
      makeColumn("VarKg", "Var. Kg", "number", "r"),
      makeColumn("VarPctValue", "Var. %", "number", "r")
    ];
  }

  if (view === "cliente") {
    return [
      makeColumn("Cliente", "Cliente"),
      makeColumn("Fechas", "Fechas", "number", "r"),
      makeColumn("Productos", "Productos", "number", "r"),
      makeColumn("Kilos2025", "Kilos 2025", "number", "r"),
      makeColumn("KilosProyectados", "Kilos Proy.", "number", "r"),
      makeColumn("VarKg", "Var. Kg", "number", "r"),
      makeColumn("VarPctValue", "Var. %", "number", "r")
    ];
  }
  if (view === "grupo") {
    return [
      makeColumn("Grupo_Familia", "Grupo"),
      makeColumn("Clientes", "Clientes", "number", "r"),
      makeColumn("Productos", "Productos", "number", "r"),
      makeColumn("Kilos2025", "Kilos 2025", "number", "r"),
      makeColumn("KilosProyectados", "Kilos Proy.", "number", "r"),
      makeColumn("VarKg", "Var. Kg", "number", "r"),
      makeColumn("VarPctValue", "Var. %", "number", "r")
    ];
  }
  if (view === "producto") {
    return [
      makeColumn("Cod_Producto", "Cód. Producto"),
      makeColumn("Producto_Desc", "Producto"),
      makeColumn("Clientes", "Clientes", "number", "r"),
      makeColumn("Kilos2025", "Kilos 2025", "number", "r"),
      makeColumn("KilosProyectados", "Kilos Proy.", "number", "r"),
      makeColumn("VarKg", "Var. Kg", "number", "r"),
      makeColumn("VarPctValue", "Var. %", "number", "r")
    ];
  }
  if (view === "fecha") {
    return [
      makeColumn("Fecha", "Fecha", "date"),
      makeColumn("Clientes", "Clientes", "number", "r"),
      makeColumn("Productos", "Productos", "number", "r"),
      makeColumn("Kilos2025", "Kilos 2025", "number", "r"),
      makeColumn("KilosProyectados", "Kilos Proy.", "number", "r"),
      makeColumn("VarKg", "Var. Kg", "number", "r"),
      makeColumn("VarPctValue", "Var. %", "number", "r")
    ];
  }
  return [
    makeColumn("Fecha", "Fecha", "date"),
    makeColumn("Cliente", "Cliente"),
    makeColumn("Grupo_Familia", "Grupo"),
    makeColumn("Cod_Producto", "Cód. Producto"),
    makeColumn("Producto_Desc", "Producto"),
    makeColumn("Kilos2025", "Kilos 2025", "number", "r"),
    makeColumn("KilosProyectados", "Kilos Proy.", "number", "r"),
    makeColumn("VarKg", "Var. Kg", "number", "r"),
    makeColumn("VarPctValue", "Var. %", "number", "r")
  ];
}

function getProjectionDefaultSortStack(view = "detalle", expanded = false) {
  if (!expanded) {
    return view === "fecha"
      ? [{ key: "Fecha", direction: "desc" }, { key: "KilosProyectados", direction: "desc" }]
      : [{ key: "KilosProyectados", direction: "desc" }, { key: "Cliente", direction: "asc" }];
  }
  if (view === "detalle") return [{ key: "KilosProyectados", direction: "desc" }, { key: "Fecha", direction: "desc" }, { key: "Cliente", direction: "asc" }];
  if (view === "fecha") return [{ key: "Fecha", direction: "desc" }, { key: "KilosProyectados", direction: "desc" }];
  return [{ key: "KilosProyectados", direction: "desc" }];
}

function getProjectionSortOptions(columns = []) {
  return columns.map(column => ({ value: column.key, label: column.label }));
}

function getProjectionMetricOptions(view = "detalle") {
  if (view === "detalle") {
    return [
      { value: "KilosProyectados", label: "Kilos Proy." },
      { value: "VarKg", label: "Var. Kg" },
      { value: "Kilos2025", label: "Kilos 2025" },
      { value: "Fecha", label: "Fecha" }
    ];
  }
  return [
    { value: "KilosProyectados", label: "Kilos Proy." },
    { value: "VarKg", label: "Var. Kg" },
    { value: "Kilos2025", label: "Kilos 2025" }
  ];
}

function normalizeProjectionMetric(view = "detalle", metric = "") {
  const options = getProjectionMetricOptions(view);
  return options.some(option => option.value === metric) ? metric : options[0].value;
}

function renderProjectionCell(row, column, explorer, fmt, escHtmlFn, options = {}) {
  const scaleMap = options?.scaleMap || {};
  if (column.key === "VarKg") {
    return renderNumericMeterCell(row.VarKg, column, fmt, {
      scaleMap,
      tone: row?.Trend === "positive" ? "positive" : row?.Trend === "negative" ? "negative" : "neutral"
    });
  }
  if (column.key === "Kilos2025") {
    return renderNumericMeterCell(row.Kilos2025, column, fmt, { scaleMap, tone: "soft" });
  }
  if (column.key === "KilosProyectados") {
    return renderNumericMeterCell(row.KilosProyectados, column, fmt, { scaleMap, tone: "accent" });
  }
  if (column.key === "VarPctValue") {
    return `<span class="${projectionTrendClass(row.Trend)}">${escapeHtml(row.VarPctLabel)}</span>`;
  }
  return renderDataCellContent(row?.[column.key], column, explorer, fmt, escHtmlFn);
}

function sumProjectionRows(rows = [], key = "KilosProyectados") {
  return rows.reduce((acc, row) => acc + Number(row?.[key] || 0), 0);
}

export function renderProjectionExplorerTable({
  toolsNode,
  headNode,
  bodyNode,
  badgeNode,
  noteNode,
  rows = [],
  total = 0,
  totalKnown = true,
  loading = false,
  meta,
  explorer = {},
  onExplorerPatch,
  onMore,
  onAll,
  pageSize = 50,
  fmt,
  fmtSignedPct,
  escHtml: escHtmlFn
} = {}) {
  if (!bodyNode || !headNode) return;
  const expanded = rows.some(row => row && Object.prototype.hasOwnProperty.call(row, "Grupo_Familia"));
  const viewOptions = getProjectionViewOptions(expanded);
  const requestedView = viewOptions.some(option => option[0] === explorer.view) ? explorer.view : viewOptions[0][0];
  const metricKey = normalizeProjectionMetric(requestedView, explorer.metric);
  const baseRows = rows.map(row => computeProjectionRow(row, meta, fmtSignedPct));
  const searchedRows = filterRowsBySearch(baseRows, explorer.search);
  const preview = buildSearchPreview(searchedRows, explorer.search, {
    fields: expanded
      ? [["Cliente", row => row.Cliente], ["Grupo", row => row.Grupo_Familia], ["Producto", row => row.Producto_Desc], ["Codigo", row => row.Cod_Producto], ["Fecha", row => row.Fecha]]
      : [["Cliente", row => row.Cliente], ["Fecha", row => row.Fecha]],
    titleResolver: row => row.Cliente || row.Producto_Desc || row.Grupo_Familia || row.Fecha || "Resultado",
    kilosResolver: row => row.KilosProyectados,
    limit: 3
  });
  const aggregatedRows = aggregateProjectionRows(searchedRows, requestedView, fmtSignedPct);
  const columns = getProjectionColumns(requestedView, expanded);
  const filteredRows = applyColumnFilters(aggregatedRows, columns, explorer);
  const defaultSortStack = getProjectionDefaultSortStack(requestedView, expanded);
  const stack = normalizeSortStack(explorer, columns, defaultSortStack);
  const sortedRows = sortRows(filteredRows, columns, stack);
  const topN = parseTopN(explorer.topN || "50");
  const visibleRows = topN ? sortedRows.slice(0, topN) : sortedRows.slice();
  const hiddenRows = topN ? sortedRows.slice(topN) : [];
  const supportsGroupOthers = requestedView !== "detalle";
  const displayRows = visibleRows.slice();
  if (supportsGroupOthers && explorer.groupOthers && hiddenRows.length) {
    const othersRow = createOthersRow(requestedView, hiddenRows, metricKey, {});
    if (othersRow) displayRows.push(othersRow);
  }
  const visibleProjected = sumProjectionRows(displayRows, "KilosProyectados");
  const visible2025 = sumProjectionRows(displayRows, "Kilos2025");
  const visibleDelta = projectionDelta(visibleProjected, visible2025, { fmtSignedPct });
  const totalProjectedContext = sumProjectionRows(sortedRows, "KilosProyectados");
  const coveragePct = totalProjectedContext > 0 ? (visibleProjected / totalProjectedContext) * 100 : 0;
  const visibleCountLabel = `${fmt(displayRows.length)} filas visibles`;
  const comparisonSummaryHtml = buildSelectionComparison(aggregatedRows, columns, explorer, metricKey, value => fmt(Number(value || 0)));
  const mixLabel = `${uniqueCount(aggregatedRows.map(row => row.Cliente))} clientes · ${uniqueCount(aggregatedRows.map(row => row.Cod_Producto))} productos en el contexto`;
  const executiveSummaryHtml = buildExecutiveSummary({
    rows: sortedRows,
    visibleRows,
    totalMetric: totalProjectedContext,
    metricKey: "KilosProyectados",
    fmtMetric: value => fmt(Number(value || 0)),
    mixLabel
  });

  const projectionMeterKeys = ["Kilos2025", "KilosProyectados", "VarKg"];
  const numericScaleMap = buildNumericScaleMap(sortedRows, columns, { includeKeys: projectionMeterKeys });
  const presentation = {
    columns,
    defaultSortStack,
    sortOptions: getProjectionSortOptions(columns),
    viewOptions,
    view: requestedView,
    visibleCount: displayRows.length,
    visibleCountLabel,
    metrics: { kilos: visibleProjected },
    searchPreview: preview,
    searchPlaceholder: expanded ? "Cliente, grupo, producto o codigo" : "Cliente o fecha",
    toolbarTip: 'Explorador proyectado con presets, foco Top N, exportación exacta y filtros por columna sobre el contexto filtrado ya hidratado.',
    getColumnsForView: nextView => getProjectionColumns(nextView, expanded),
    getDefaultSortStackForView: nextView => getProjectionDefaultSortStack(nextView, expanded),
    getSortOptionsForView: nextView => getProjectionSortOptions(getProjectionColumns(nextView, expanded)),
    metricOptions: getProjectionMetricOptions(requestedView),
    normalizeMetric: normalizeProjectionMetric,
    presetOptions: PROJECTION_PRESETS,
    topNOptions: EXPLORER_TOP_N_OPTIONS,
    supportsGroupOthers,
    topNLimit: topN,
    coveragePct,
    executiveSummaryHtml,
    comparisonSummaryHtml,
    exportColumns: columns,
    exportRows: displayRows.concat([{
      [columns[0]?.key || "Cliente"]: "TOTAL VISIBLE",
      Kilos2025: visible2025,
      KilosProyectados: visibleProjected,
      VarKg: visibleDelta.deltaKg,
      VarPctValue: visibleDelta.deltaPct,
      VarPctLabel: visibleDelta.deltaPctLabel,
      Trend: visibleDelta.trend
    }]),
    exportFilename: `detalle_proyectado_${requestedView}`,
    numericScaleMap
  };

  renderToolbar(toolsNode, { ...explorer, view: requestedView, metric: metricKey }, presentation, fmt, onExplorerPatch, { allowFavorites: false });
  if (badgeNode) badgeNode.textContent = `${fmt(displayRows.length)} visibles · ${fmt(total)}${totalKnown ? "" : "+"} base`;

  const columnOptions = buildColumnOptions(aggregatedRows, columns, explorer, fmt);
  cleanupFloatingColumnMenus();
  headNode.innerHTML = `<tr>${columns.map(column => renderHeaderCell(column, { ...presentation, stack, columnOptions }, explorer, fmt)).join("")}</tr>`;
  bindHeaderInteractions(headNode, { ...presentation, stack, columnOptions }, explorer, onExplorerPatch, fmt);
  window.requestAnimationFrame(() => positionOpenColumnMenus(headNode));

  if (!displayRows.length) {
    bodyNode.innerHTML = `<tr><td colspan="${columns.length}"><div class="empty"><div class="eico">🔍</div><p>Sin filas proyectadas para la vista actual.</p></div></td></tr>`;
  } else {
    const drillConfig = requestedView === "cliente"
      ? { key: "Cliente", field: "Cliente" }
      : requestedView === "grupo"
        ? { key: "Grupo_Familia", field: "Grupo_Familia" }
        : requestedView === "producto"
          ? { key: "Cod_Producto", field: "Cod_Producto" }
          : requestedView === "fecha"
            ? { key: "Fecha", field: "Fecha" }
            : null;
    const totalStart = Math.max(columns.length - 4, 1);
    const totalRow = `<tr class="detail-grandtotal-row"><td colspan="${totalStart}" class="detail-total-label">TOTAL VISIBLE</td>${columns.slice(totalStart).map(column => {
      if (column.key === "Kilos2025") return `<td class="num r detail-total-value">${fmt(visible2025)}</td>`;
      if (column.key === "KilosProyectados") return `<td class="num r detail-total-value">${fmt(visibleProjected)}</td>`;
      if (column.key === "VarKg") return `<td class="num r detail-total-value"><span class="${projectionTrendClass(visibleDelta.trend)}">${fmt(visibleDelta.deltaKg)}</span></td>`;
      if (column.key === "VarPctValue") return `<td class="num r detail-total-value"><span class="${projectionTrendClass(visibleDelta.trend)}">${escapeHtml(visibleDelta.deltaPctLabel)}</span></td>`;
      return `<td></td>`;
    }).join("")}</tr>`;

    bodyNode.innerHTML = displayRows.map(row => {
      const isDrillable = Boolean(drillConfig && row?.[drillConfig.field] && !String(row?.[drillConfig.field] || "").startsWith("Otros"));
      return `<tr${isDrillable ? ` class="detail-data-row--drill" data-proj-drill-key="${escapeHtml(drillConfig.key)}" data-proj-drill-value="${escapeHtml(row[drillConfig.field])}"` : ""}>${columns.map(column => {
        const rendered = renderProjectionCell(row, column, explorer, fmt, escHtmlFn, { scaleMap: numericScaleMap });
        const copyValue = column.key === "VarPctValue"
          ? String(row?.VarPctLabel || "")
          : (column.type === "number" ? String(row?.[column.key] ?? "") : "");
        const content = copyValue
          ? `<button type="button" class="detail-copy-cell" data-copy-value="${escapeHtml(copyValue)}" title="Copiar valor">${rendered}</button>`
          : rendered;
        return `<td data-label="${escapeHtml(column.label)}"${column.className ? ` class="${column.className}"` : ""}>${content}</td>`;
      }).join("")}</tr>`;
    }).join("") + totalRow;

    bodyNode.querySelectorAll("[data-proj-drill-key]").forEach(rowNode => {
      rowNode.addEventListener("click", event => {
        if (event.target.closest("button, a, input, label, select")) return;
        const key = rowNode.getAttribute("data-proj-drill-key") || "";
        const value = rowNode.getAttribute("data-proj-drill-value") || "";
        if (!key || !value) return;
        const nextFilters = { ...(explorer?.columnFilters || {}) };
        nextFilters[key] = [value];
        onExplorerPatch?.({
          view: expanded ? "detalle" : requestedView,
          columnFilters: nextFilters,
          topN: "50",
          currentPreset: "custom",
          openColumnMenu: ""
        });
      });
    });
    bindCopyCells(bodyNode);
  }

  if (!noteNode) return;
  const remaining = Math.max(Number(total || 0) - rows.length, 0);
  noteNode.style.display = "flex";
  noteNode.classList.add("table-note");
  noteNode.innerHTML = `
    <div class="table-note-main">Vista local: <strong>${fmt(displayRows.length)}</strong> filas · Kilos proyectados visibles: <strong>${fmt(visibleProjected)}</strong>. Los filtros de encabezado ya usan el contexto proyectado hidratado; el foco Top N solo recorta la vista.</div>
    <div class="table-actions">
      ${remaining > 0 ? `<button id="pExplorerMore" type="button" class="table-action-btn" ${loading ? "disabled" : ""}>${loading ? "Cargando..." : `+ Ver ${fmt(Math.min(pageSize, remaining))} mas`}</button>` : ""}
      ${remaining > 0 ? `<button id="pExplorerAll" type="button" class="table-action-btn table-action-btn--accent" ${loading ? "disabled" : ""}>${loading ? "Cargando..." : (totalKnown ? `Ver todos (${fmt(total)})` : "Ver todo el resto")}</button>` : ""}
    </div>`;
  noteNode.querySelector("#pExplorerMore")?.addEventListener("click", () => onMore?.());
  noteNode.querySelector("#pExplorerAll")?.addEventListener("click", () => onAll?.());
}

function buildAccumRows(view = "coordinadores", rankings = {}, total = 0) {
  const entries = rankings?.[view] || [];
  if (view === "clientes") {
    return entries.map((item, index) => ({
      Posicion: index + 1,
      Cliente: String(item?.nombre || ""),
      Coordinador: String(item?.coordinador || ""),
      Agente: String(item?.agente || ""),
      Kilos: Number(item?.kilos || 0),
      Participacion: total > 0 ? (Number(item?.kilos || 0) / total) * 100 : 0
    }));
  }
  return entries.map((item, index) => ({
    Posicion: index + 1,
    Nombre: String(item?.name || ""),
    Kilos: Number(item?.kilos || 0),
    Participacion: total > 0 ? (Number(item?.kilos || 0) / total) * 100 : 0
  }));
}

function getAccumViewOptions() {
  return [["coordinadores", "Por coordinador"], ["agentes", "Por agente"], ["grupos", "Por grupo"], ["marcas", "Por marca"], ["clientes", "Por cliente"]];
}

function getAccumColumns(view = "coordinadores") {
  if (view === "clientes") {
    return [
      makeColumn("Posicion", "#", "number", "r"),
      makeColumn("Cliente", "Cliente"),
      makeColumn("Coordinador", "Coord."),
      makeColumn("Agente", "Agente"),
      makeColumn("Kilos", "Kilos", "number", "r"),
      makeColumn("Participacion", "%", "number", "r")
    ];
  }
  return [
    makeColumn("Posicion", "#", "number", "r"),
    makeColumn("Nombre", "Nombre"),
    makeColumn("Kilos", "Kilos", "number", "r"),
    makeColumn("Participacion", "%", "number", "r")
  ];
}

function getAccumDefaultSortStack(view = "coordinadores") {
  return view === "clientes"
    ? [{ key: "Kilos", direction: "desc" }, { key: "Cliente", direction: "asc" }]
    : [{ key: "Kilos", direction: "desc" }, { key: view === "clientes" ? "Cliente" : "Nombre", direction: "asc" }];
}

function getAccumMetricOptions(view = "coordinadores") {
  return [
    { value: "Kilos", label: "Kilos" },
    { value: "Participacion", label: "%" },
    { value: view === "clientes" ? "Cliente" : "Nombre", label: view === "clientes" ? "Cliente" : "Nombre" }
  ];
}

function normalizeAccumMetric(view = "coordinadores", metric = "") {
  const options = getAccumMetricOptions(view);
  return options.some(option => option.value === metric) ? metric : options[0].value;
}

export function renderAccumulatedExplorer({
  titleNode,
  badgeNode,
  toolsNode,
  headNode,
  bodyNode,
  noteNode,
  rankings = {},
  totalKilos = 0,
  explorer = {},
  onExplorerPatch,
  fmt,
  escHtml: escHtmlFn
} = {}) {
  if (!bodyNode || !headNode) return;
  const viewOptions = getAccumViewOptions();
  const view = viewOptions.some(option => option[0] === explorer.view) ? explorer.view : "coordinadores";
  const metricKey = normalizeAccumMetric(view, explorer.metric);
  const baseRows = buildAccumRows(view, rankings, totalKilos);
  const searchedRows = filterRowsBySearch(baseRows, explorer.search);
  const columns = getAccumColumns(view);
  const filteredRows = applyColumnFilters(searchedRows, columns, explorer);
  const defaultSortStack = getAccumDefaultSortStack(view);
  const stack = normalizeSortStack(explorer, columns, defaultSortStack);
  const sortedRows = sortRows(filteredRows, columns, stack);
  const topN = parseTopN(explorer.topN || "50");
  const visibleRows = topN ? sortedRows.slice(0, topN) : sortedRows.slice();
  const hiddenRows = topN ? sortedRows.slice(topN) : [];
  const displayRows = visibleRows.slice();
  if (explorer.groupOthers && hiddenRows.length) {
    const othersRow = createOthersRow(view === "clientes" ? "cliente" : "coordinadores", hiddenRows, metricKey, {
      Nombre: `Otros (${hiddenRows.length})`,
      Cliente: `Otros (${hiddenRows.length})`,
      Coordinador: "—",
      Agente: "—"
    });
    if (othersRow) displayRows.push(othersRow);
  }
  const visibleKilos = sumProjectionRows(displayRows, "Kilos");
  const totalVisibleShare = totalKilos > 0 ? (visibleKilos / totalKilos) * 100 : 0;
  const comparisonSummaryHtml = buildSelectionComparison(searchedRows, columns, explorer, metricKey, value => metricKey === "Participacion" ? `${fmt(Number(value || 0))}%` : fmt(Number(value || 0)));
  const executiveSummaryHtml = buildExecutiveSummary({
    rows: sortedRows,
    visibleRows,
    totalMetric: totalKilos > 0 ? totalKilos : visibleKilos,
    metricKey: "Kilos",
    fmtMetric: value => fmt(Number(value || 0)),
    mixLabel: view === "clientes"
      ? `${uniqueCount(searchedRows.map(row => row.Coordinador))} coordinadores · ${uniqueCount(searchedRows.map(row => row.Agente))} agentes`
      : `${fmt(sortedRows.length)} filas del ranking actual`
  });

  const presentation = {
    columns,
    defaultSortStack,
    sortOptions: columns.map(column => ({ value: column.key, label: column.label })),
    viewOptions,
    view,
    visibleCount: displayRows.length,
    visibleCountLabel: `${fmt(displayRows.length)} filas visibles`,
    metrics: { kilos: visibleKilos },
    searchPreview: buildSearchPreview(searchedRows, explorer.search, {
      fields: view === "clientes"
        ? [["Cliente", row => row.Cliente], ["Coordinador", row => row.Coordinador], ["Agente", row => row.Agente]]
        : [["Nombre", row => row.Nombre]],
      titleResolver: row => row.Cliente || row.Nombre || "Resultado",
      kilosResolver: row => row.Kilos,
      limit: 3
    }),
    searchPlaceholder: view === "clientes" ? "Cliente, coordinador o agente" : "Buscar dentro del ranking",
    toolbarTip: 'Explorador acumulado con foco Top N, presets ejecutivos, exportación exacta e insights automáticos de concentración.',
    getColumnsForView: nextView => getAccumColumns(nextView),
    getDefaultSortStackForView: nextView => getAccumDefaultSortStack(nextView),
    getSortOptionsForView: nextView => getAccumColumns(nextView).map(column => ({ value: column.key, label: column.label })),
    metricOptions: getAccumMetricOptions(view),
    normalizeMetric: normalizeAccumMetric,
    presetOptions: ACCUM_PRESETS,
    topNOptions: EXPLORER_TOP_N_OPTIONS,
    supportsGroupOthers: true,
    topNLimit: topN,
    coveragePct: totalVisibleShare,
    executiveSummaryHtml,
    comparisonSummaryHtml,
    exportColumns: columns,
    exportRows: displayRows.concat([{ [view === "clientes" ? "Cliente" : "Nombre"]: "TOTAL VISIBLE", Kilos: visibleKilos, Participacion: totalVisibleShare }]),
    exportFilename: `acumulados_${view}`
  };

  renderToolbar(toolsNode, { ...explorer, view, metric: metricKey }, presentation, fmt, onExplorerPatch, { allowFavorites: false });
  if (titleNode) titleNode.textContent = `Explorador de acumulados · ${viewOptions.find(option => option[0] === view)?.[1] || "Por coordinador"}`;
  if (badgeNode) badgeNode.textContent = `${fmt(displayRows.length)} filas visibles`;

  const columnOptions = buildColumnOptions(searchedRows, columns, explorer, fmt);
  cleanupFloatingColumnMenus();
  headNode.innerHTML = `<tr>${columns.map(column => renderHeaderCell(column, { ...presentation, stack, columnOptions }, explorer, fmt)).join("")}</tr>`;
  bindHeaderInteractions(headNode, { ...presentation, stack, columnOptions }, explorer, onExplorerPatch, fmt);
  window.requestAnimationFrame(() => positionOpenColumnMenus(headNode));

  if (!displayRows.length) {
    bodyNode.innerHTML = `<tr><td colspan="${columns.length}"><div class="empty"><div class="eico">📉</div><p>Sin resultados para la vista acumulada actual.</p></div></td></tr>`;
  } else {
    const totalRow = `<tr class="detail-grandtotal-row"><td colspan="${Math.max(columns.length - 2, 1)}" class="detail-total-label">TOTAL VISIBLE</td><td class="num r detail-total-value">${fmt(visibleKilos)}</td><td class="num r detail-total-value">${fmt(totalVisibleShare)}%</td></tr>`;
    bodyNode.innerHTML = displayRows.map(row => `<tr>${columns.map(column => {
      let content;
      if (column.key === "Participacion") content = `${fmt(Number(row.Participacion || 0))}%`;
      else content = renderDataCellContent(row?.[column.key], column, explorer, fmt, escHtmlFn);
      return `<td data-label="${escapeHtml(column.label)}"${column.className ? ` class="${column.className}"` : ""}>${content}</td>`;
    }).join("")}</tr>`).join("") + totalRow;
  }

  if (!noteNode) return;
  noteNode.style.display = "flex";
  noteNode.classList.add("table-note");
  noteNode.innerHTML = `<div class="table-note-main">Explorador consolidado sobre rankings acumulados. Kilos visibles: <strong>${fmt(visibleKilos)}</strong> de <strong>${fmt(totalKilos)}</strong>. El foco Top N ya no altera los valores disponibles en los filtros de columna.</div>`;
}
