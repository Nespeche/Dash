import {
  applyColumnFilters, buildColumnOptions, buildSearchPreview, compareByColumn,
  compareNumber, filterRowsBySearch, normalizeSortStack, sortRows, syncLegacySortFields
} from "./table-sort-filter.js";
import {
  buildNumericScaleMap, buildSummaryMetrics, renderNumericMeterCell, shouldRenderMetricMeter
} from "./table-scale.js";

export {
  applyColumnFilters, buildColumnOptions, buildSearchPreview,
  filterRowsBySearch, normalizeSortStack, sortRows, syncLegacySortFields
} from "./table-sort-filter.js";
export { buildNumericScaleMap, buildSummaryMetrics, renderNumericMeterCell } from "./table-scale.js";

function cell(label, content, className = "") {
  const cls = className ? ` class="${className}"` : "";
  return `<td data-label="${label}"${cls}>${content}</td>`;
}

function clipText(content, title = "", className = "") {
  const cls = className ? ` ${className}` : "";
  const safeTitle = String(title || "").replace(/&quot;/g, '"');
  return `<span class="td-clip${cls}" title="${safeTitle}">${content}</span>`;
}

function showToast(message = "", durationMs = 2000) {
  if (typeof document === "undefined") return;
  const existing = document.querySelector('.ux-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'ux-toast';
  toast.textContent = String(message || '').trim() || 'Accion completada';
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), Math.max(1000, Number(durationMs) || 2000));
}

function buildSkeletonRows(columnCount = 6, rowCount = 5) {
  const safeColumns = Math.max(1, Number(columnCount || 0));
  const safeRows = Math.max(1, Number(rowCount || 0));
  const cells = Array.from({ length: safeColumns }, (_, index) => {
    const wide = index === 1 || index === safeColumns - 2;
    return `<td data-label="Cargando"><span class="skel${wide ? ' skel--wide' : ''}"></span></td>`;
  }).join('');
  return Array.from({ length: safeRows }, () => `<tr class="skeleton-row">${cells}</tr>`).join('');
}

async function copyValueToClipboard(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(raw);
      return true;
    }
  } catch (_) {}
  try {
    const area = document.createElement('textarea');
    area.value = raw;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

export function bindCopyCells(root) {
  root?.querySelectorAll('[data-copy-value]').forEach(node => {
    node.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const value = node.getAttribute('data-copy-value') || '';
      const copied = await copyValueToClipboard(value);
      showToast(copied ? 'Copiado al portapapeles' : 'No se pudo copiar');
    });
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function highlightMatch(value, searchTerm = "") {
  const raw = String(value ?? "");
  const q = String(searchTerm || "").trim();
  if (!q) return escapeHtml(raw);
  const normalizedRaw = raw.toLowerCase();
  const normalizedQuery = q.toLowerCase();
  const index = normalizedRaw.indexOf(normalizedQuery);
  if (index < 0) return escapeHtml(raw);
  const before = escapeHtml(raw.slice(0, index));
  const match = escapeHtml(raw.slice(index, index + q.length));
  const after = escapeHtml(raw.slice(index + q.length));
  return `${before}<mark>${match}</mark>${after}`;
}

export function makeColumn(key, label, type = "text", className = "") {
  return { key, label, type, className };
}

const DETAIL_VIEW_OPTIONS = [
  ["detalle", "Detalle"],
  ["cliente", "Por cliente"],
  ["grupo", "Por grupo"],
  ["producto", "Por producto"],
  ["fecha", "Por dia"]
];

const DETAIL_TOP_N_OPTIONS = [
  ["all", "Todos"],
  ["10", "Top 10"],
  ["20", "Top 20"],
  ["50", "Top 50"],
  ["100", "Top 100"]
];

const DETAIL_PRESETS = [
  { id: "top-clientes", label: "Top clientes", icon: "👥", hint: "Ranking comercial por kilos visibles", view: "cliente", metric: "Kilos", topN: "20", groupOthers: true },
  { id: "top-grupos", label: "Top grupos", icon: "🧩", hint: "Familias con mayor peso relativo", view: "grupo", metric: "Kilos", topN: "10", groupOthers: true },
  { id: "top-productos", label: "Top productos", icon: "📦", hint: "Productos lideres del contexto", view: "producto", metric: "Kilos", topN: "20", groupOthers: true },
  { id: "ultimos", label: "Ultimos movimientos", icon: "🕒", hint: "Detalle cronologico reciente", view: "detalle", metric: "Fecha", topN: "40", groupOthers: false },
  { id: "mix-clientes", label: "Mayor mix", icon: "🌐", hint: "Clientes con mas variedad", view: "cliente", metric: "Productos", topN: "20", groupOthers: false },
  { id: "concentracion", label: "Concentracion", icon: "🎯", hint: "Foco en cuentas de mayor peso", view: "cliente", metric: "Kilos", topN: "10", groupOthers: true }
];

const DETAIL_UNIT_LABELS = {
  detalle: "filas",
  cliente: "clientes",
  grupo: "grupos",
  producto: "productos",
  fecha: "dias"
};

const GENERAL_COLUMN_LABELS = {
  Fecha: "Fecha",
  Cliente: "Cliente",
  Grupo_Familia: "Grupo",
  Cod_Producto: "Cod. Producto",
  Producto_Desc: "Producto",
  Kilos: "Kilos",
  Grupos: "Grupos",
  Productos: "Productos",
  Fechas: "Fechas",
  Registros: "Registros"
};

function parseTopN(topN = "all") {
  const raw = String(topN || "all").trim().toLowerCase();
  if (!raw || raw === "all") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.floor(value));
}

function preferredDirectionForKey(key = "") {
  if (["Cliente", "Grupo_Familia", "Producto_Desc", "Cod_Producto"].includes(key)) return "asc";
  return "desc";
}

function buildPrimarySortStackForView(view = "detalle", metric = "Kilos", columns = [], fallbackStack = []) {
  const validKeys = new Set((columns || []).map(column => column.key));
  const desiredKey = validKeys.has(metric) ? metric : (fallbackStack?.[0]?.key || columns?.[0]?.key || "Kilos");
  const nextStack = [];
  if (desiredKey && validKeys.has(desiredKey)) {
    nextStack.push({ key: desiredKey, direction: preferredDirectionForKey(desiredKey) });
  }
  (fallbackStack || []).forEach(item => {
    const key = String(item?.key || "");
    if (!key || key === desiredKey || !validKeys.has(key) || nextStack.some(entry => entry.key === key)) return;
    nextStack.push({ key, direction: item?.direction === "asc" ? "asc" : preferredDirectionForKey(key) });
  });
  return nextStack;
}

function getMetricOptionsForView(view = "detalle") {
  if (view === "cliente") {
    return [
      { value: "Kilos", label: "Kilos" },
      { value: "Registros", label: "Registros" },
      { value: "Productos", label: "Productos" },
      { value: "Grupos", label: "Grupos" },
      { value: "Fechas", label: "Fechas" }
    ];
  }
  if (view === "detalle") {
    return [
      { value: "Fecha", label: "Fecha" },
      { value: "Kilos", label: "Kilos" }
    ];
  }
  return [
    { value: "Kilos", label: "Kilos" },
    { value: "Fecha", label: "Fecha" }
  ];
}

function normalizeMetricForView(view = "detalle", requestedMetric = "") {
  const metricOptions = getMetricOptionsForView(view);
  const fallback = metricOptions[0]?.value || "Kilos";
  return metricOptions.some(option => option.value === requestedMetric) ? requestedMetric : fallback;
}

function buildViewCountLabel(view = "detalle", count = 0, fmt = value => String(value)) {
  const label = DETAIL_UNIT_LABELS[view] || "filas";
  return `${fmt(count)} ${label} visibles`;
}

function buildShownTotalLabel(view = "detalle", visibleCount = 0, hiddenCount = 0, groupedRemainder = false, fmt = value => String(value)) {
  const label = DETAIL_UNIT_LABELS[view] || "filas";
  if (hiddenCount > 0 && groupedRemainder) {
    return `Total mostrado · ${fmt(visibleCount)} ${label} + ${fmt(hiddenCount)} en Otros`;
  }
  return `Total mostrado · ${fmt(visibleCount)} ${label}`;
}

function buildHiddenSummaryLabel(view = "detalle", hiddenCount = 0, fmt = value => String(value)) {
  const label = DETAIL_UNIT_LABELS[view] || "filas";
  return `Otros · ${fmt(hiddenCount)} ${label} agrupados`;
}

function buildDrillDescriptor(view = "detalle", row = {}) {
  if (view === "cliente" && row?.Cliente) {
    return { key: "Cliente", value: String(row.Cliente), label: `Cliente · ${String(row.Cliente)}` };
  }
  if (view === "grupo" && row?.Grupo_Familia) {
    return { key: "Grupo_Familia", value: String(row.Grupo_Familia), label: `Grupo · ${String(row.Grupo_Familia)}` };
  }
  if (view === "producto" && row?.Cod_Producto) {
    const suffix = row?.Producto_Desc ? ` · ${String(row.Producto_Desc)}` : "";
    return { key: "Cod_Producto", value: String(row.Cod_Producto), label: `Producto · ${String(row.Cod_Producto)}${suffix}` };
  }
  if (view === "fecha" && row?.Fecha) {
    return { key: "Fecha", value: String(row.Fecha), label: `Fecha · ${String(row.Fecha)}` };
  }
  return null;
}

function buildDetailModel(rows = []) {
  return {
    key: "detalle",
    title: "Resumen filtrado",
    empty: "Sin resultados para los filtros actuales",
    columns: [
      makeColumn("Fecha", "Fecha", "date"),
      makeColumn("Cliente", "Cliente"),
      makeColumn("Grupo_Familia", "Grupo"),
      makeColumn("Cod_Producto", "Cod. Producto"),
      makeColumn("Producto_Desc", "Producto"),
      makeColumn("Kilos", "Kilos", "number", "num r")
    ],
    rows,
    sortOptions: [
      { value: "default", label: "Orden sugerido" },
      { value: "Fecha", label: "Fecha" },
      { value: "Cliente", label: "Cliente" },
      { value: "Grupo_Familia", label: "Grupo" },
      { value: "Cod_Producto", label: "Cod. Producto" },
      { value: "Producto_Desc", label: "Producto" },
      { value: "Kilos", label: "Kilos" }
    ],
    defaultSortStack: [
      { key: "Fecha", direction: "desc" },
      { key: "Kilos", direction: "desc" },
      { key: "Cliente", direction: "asc" },
      { key: "Producto_Desc", direction: "asc" }
    ],
    totalLabel: metrics => `Total visible · ${metrics.registros} filas`
  };
}

function buildClientModel(rows = []) {
  const buckets = new Map();
  rows.forEach(row => {
    const key = String(row.Cliente || "Sin cliente");
    if (!buckets.has(key)) {
      buckets.set(key, {
        Cliente: key,
        Grupos: new Set(),
        Productos: new Set(),
        Fechas: new Set(),
        Registros: 0,
        Kilos: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.Grupos.add(String(row.Grupo_Familia || ""));
    bucket.Productos.add(String(row.Cod_Producto || ""));
    bucket.Fechas.add(String(row.Fecha || ""));
    bucket.Registros += 1;
    bucket.Kilos += Number(row.Kilos || 0);
  });

  const modelRows = [...buckets.values()].map(bucket => ({
    Cliente: bucket.Cliente,
    Grupos: [...bucket.Grupos].filter(Boolean).length,
    Productos: [...bucket.Productos].filter(Boolean).length,
    Fechas: [...bucket.Fechas].filter(Boolean).length,
    Registros: bucket.Registros,
    Kilos: bucket.Kilos
  }));

  return {
    key: "cliente",
    title: "Resumen filtrado · Por cliente",
    empty: "No hay clientes para el alcance actual",
    columns: [
      makeColumn("Cliente", "Cliente"),
      makeColumn("Grupos", "Grupos", "number", "r"),
      makeColumn("Productos", "Productos", "number", "r"),
      makeColumn("Fechas", "Fechas", "number", "r"),
      makeColumn("Registros", "Registros", "number", "r"),
      makeColumn("Kilos", "Kilos", "number", "num r")
    ],
    rows: modelRows,
    sortOptions: [
      { value: "Kilos", label: "Kilos" },
      { value: "Cliente", label: "Cliente" },
      { value: "Grupos", label: "Grupos" },
      { value: "Productos", label: "Productos" },
      { value: "Fechas", label: "Fechas" },
      { value: "Registros", label: "Registros" }
    ],
    defaultSortStack: [
      { key: "Kilos", direction: "desc" },
      { key: "Cliente", direction: "asc" }
    ],
    totalLabel: metrics => `Total visible · ${metrics.clientes} clientes`
  };
}

function buildGroupedModel(rows = [], view = "grupo") {
  const configMap = {
    grupo: {
      title: "Resumen filtrado · Por grupo",
      empty: "No hay grupos para el alcance actual",
      columns: [
        makeColumn("Grupo_Familia", "Grupo"),
        makeColumn("Fecha", "Fecha", "date"),
        makeColumn("Cliente", "Cliente"),
        makeColumn("Cod_Producto", "Cod. Producto"),
        makeColumn("Producto_Desc", "Producto"),
        makeColumn("Kilos", "Kilos", "number", "num r")
      ],
      groupKeys: ["Grupo_Familia"],
      groupValue: row => String(row.Grupo_Familia || "Sin grupo"),
      groupLabel: row => String(row.Grupo_Familia || "Sin grupo"),
      defaultSortStack: [
        { key: "Kilos", direction: "desc" },
        { key: "Grupo_Familia", direction: "asc" },
        { key: "Fecha", direction: "desc" }
      ],
      rowDefaultSortStack: [
        { key: "Fecha", direction: "desc" },
        { key: "Kilos", direction: "desc" },
        { key: "Cliente", direction: "asc" }
      ],
      totalLabel: metrics => `Total visible · ${metrics.grupos} grupos`
    },
    producto: {
      title: "Resumen filtrado · Por producto",
      empty: "No hay productos para el alcance actual",
      columns: [
        makeColumn("Cod_Producto", "Cod. Producto"),
        makeColumn("Producto_Desc", "Producto"),
        makeColumn("Fecha", "Fecha", "date"),
        makeColumn("Cliente", "Cliente"),
        makeColumn("Grupo_Familia", "Grupo"),
        makeColumn("Kilos", "Kilos", "number", "num r")
      ],
      groupKeys: ["Cod_Producto", "Producto_Desc"],
      groupValue: row => `${String(row.Cod_Producto || "Sin codigo")}||${String(row.Producto_Desc || "Sin producto")}`,
      groupLabel: row => `${String(row.Cod_Producto || "Sin codigo")} · ${String(row.Producto_Desc || "Sin producto")}`,
      defaultSortStack: [
        { key: "Kilos", direction: "desc" },
        { key: "Cod_Producto", direction: "asc" },
        { key: "Producto_Desc", direction: "asc" }
      ],
      rowDefaultSortStack: [
        { key: "Fecha", direction: "desc" },
        { key: "Kilos", direction: "desc" },
        { key: "Cliente", direction: "asc" }
      ],
      totalLabel: metrics => `Total visible · ${metrics.productos} productos`
    },
    fecha: {
      title: "Resumen filtrado · Por dia",
      empty: "No hay fechas para el alcance actual",
      columns: [
        makeColumn("Fecha", "Fecha", "date"),
        makeColumn("Cliente", "Cliente"),
        makeColumn("Grupo_Familia", "Grupo"),
        makeColumn("Cod_Producto", "Cod. Producto"),
        makeColumn("Producto_Desc", "Producto"),
        makeColumn("Kilos", "Kilos", "number", "num r")
      ],
      groupKeys: ["Fecha"],
      groupValue: row => String(row.Fecha || "Sin fecha"),
      groupLabel: row => String(row.Fecha || "Sin fecha"),
      defaultSortStack: [
        { key: "Fecha", direction: "desc" },
        { key: "Kilos", direction: "desc" }
      ],
      rowDefaultSortStack: [
        { key: "Kilos", direction: "desc" },
        { key: "Cliente", direction: "asc" },
        { key: "Producto_Desc", direction: "asc" }
      ],
      totalLabel: metrics => `Total visible · ${metrics.fechas} dias`
    }
  };

  const config = configMap[view] || configMap.grupo;
  return {
    key: view,
    title: config.title,
    empty: config.empty,
    columns: config.columns,
    rows,
    groupKeys: config.groupKeys,
    groupValue: config.groupValue,
    groupLabel: config.groupLabel,
    sortOptions: [
      { value: "Kilos", label: "Kilos" },
      ...config.columns.filter(column => column.key !== "Kilos").map(column => ({ value: column.key, label: column.label }))
    ],
    defaultSortStack: config.defaultSortStack,
    rowDefaultSortStack: config.rowDefaultSortStack,
    totalLabel: config.totalLabel,
    grouped: true
  };
}

function buildModelForView(rows = [], view = "detalle") {
  if (view === "cliente") return buildClientModel(rows);
  if (view === "grupo" || view === "producto" || view === "fecha") return buildGroupedModel(rows, view);
  return buildDetailModel(rows);
}

function buildFlatPresentation(model, explorer = {}, fmt) {
  const stack = normalizeSortStack(explorer, model.columns, model.defaultSortStack);
  const sortedRows = sortRows(model.rows, model.columns, stack);
  const baseMetrics = buildSummaryMetrics(model.metricRows || model.rows || []);
  const limit = parseTopN(explorer.topN);
  const supportsGroupOthers = model.key !== "detalle";
  const visibleRows = limit ? sortedRows.slice(0, limit) : sortedRows.slice();
  const hiddenRows = limit ? sortedRows.slice(limit) : [];
  const visibleKilos = visibleRows.reduce((acc, row) => acc + Number(row?.Kilos || 0), 0);
  const hiddenKilos = hiddenRows.reduce((acc, row) => acc + Number(row?.Kilos || 0), 0);
  const shownKilos = visibleKilos + (supportsGroupOthers && explorer.groupOthers ? hiddenKilos : 0);
  const coveragePct = baseMetrics.kilos > 0 ? (shownKilos / baseMetrics.kilos) * 100 : 0;
  const rowModels = visibleRows.map(row => ({
    type: "data",
    row,
    drill: buildDrillDescriptor(model.key, row)
  }));

  if (hiddenRows.length && supportsGroupOthers && explorer.groupOthers) {
    rowModels.push({
      type: "summary",
      label: buildHiddenSummaryLabel(model.key, hiddenRows.length, fmt),
      value: hiddenKilos,
      colspan: Math.max(model.columns.length - 1, 1)
    });
  }

  if (visibleRows.length || (hiddenRows.length && supportsGroupOthers && explorer.groupOthers)) {
    rowModels.push({
      type: "total",
      label: buildShownTotalLabel(model.key, visibleRows.length, hiddenRows.length, Boolean(explorer.groupOthers && supportsGroupOthers), fmt),
      value: shownKilos,
      colspan: Math.max(model.columns.length - 1, 1)
    });
  }

  return {
    ...model,
    rowModels,
    stack,
    metrics: { ...baseMetrics, kilos: shownKilos },
    baseMetrics,
    visibleCount: visibleRows.length,
    hiddenCount: hiddenRows.length,
    visibleCountLabel: buildViewCountLabel(model.key, visibleRows.length, fmt),
    coveragePct,
    topNLimit: limit,
    topNActive: Boolean(limit),
    supportsGroupOthers,
    metricOptions: getMetricOptionsForView(model.key),
    activeMetric: normalizeMetricForView(model.key, explorer.metric),
    presetOptions: DETAIL_PRESETS,
    rowCountLabel: buildViewCountLabel(model.key, visibleRows.length, fmt),
    columnOptions: buildColumnOptions(model.optionRows || model.rows || [], model.columns, explorer, fmt)
  };
}

function compareGroupMeta(left, right, stack = [], model) {
  for (const item of stack) {
    if (item.key === "Kilos") {
      const diff = compareNumber(left.kilos, right.kilos, item.direction);
      if (diff !== 0) return diff;
      continue;
    }

    if (model.groupKeys.includes(item.key)) {
      const column = model.columns.find(entry => entry.key === item.key) || model.columns[0];
      const diff = compareByColumn(left.sample, right.sample, column, item.direction);
      if (diff !== 0) return diff;
      continue;
    }
  }

  const fallbackColumn = model.columns.find(column => model.groupKeys.includes(column.key)) || model.columns[0];
  return compareByColumn(left.sample, right.sample, fallbackColumn, "asc");
}

function buildGroupedPresentation(model, explorer = {}, fmt) {
  const stack = normalizeSortStack(explorer, model.columns, model.defaultSortStack);
  const groupStack = stack.filter(item => item.key === "Kilos" || model.groupKeys.includes(item.key));
  const rowStack = stack.filter(item => !model.groupKeys.includes(item.key));
  const effectiveRowStack = rowStack.length ? rowStack : model.rowDefaultSortStack;

  const buckets = new Map();
  model.rows.forEach(row => {
    const key = model.groupValue(row);
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: model.groupLabel(row),
        sample: row,
        rows: [],
        kilos: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.rows.push({ ...row });
    bucket.kilos += Number(row.Kilos || 0);
  });

  const groups = [...buckets.values()].sort((left, right) => compareGroupMeta(left, right, groupStack, model));
  const baseMetrics = buildSummaryMetrics(model.metricRows || model.rows || []);
  const limit = parseTopN(explorer.topN);
  const visibleGroups = limit ? groups.slice(0, limit) : groups.slice();
  const hiddenGroups = limit ? groups.slice(limit) : [];
  const hiddenKilos = hiddenGroups.reduce((acc, group) => acc + Number(group.kilos || 0), 0);
  const visibleKilos = visibleGroups.reduce((acc, group) => acc + Number(group.kilos || 0), 0);
  const shownKilos = visibleKilos + (explorer.groupOthers ? hiddenKilos : 0);
  const coveragePct = baseMetrics.kilos > 0 ? (shownKilos / baseMetrics.kilos) * 100 : 0;
  const rowModels = [];

  visibleGroups.forEach(group => {
    const sortedRows = sortRows(group.rows, model.columns, effectiveRowStack);
    sortedRows.forEach((row, index) => {
      const nextRow = { ...row };
      if (index > 0) {
        model.groupKeys.forEach(key => {
          nextRow[key] = "";
        });
      }
      rowModels.push({ type: "data", row: nextRow, drill: index === 0 ? buildDrillDescriptor(model.key, row) : null });
    });
    rowModels.push({
      type: "subtotal",
      label: `Subtotal ${group.label} · ${group.rows.length} fila${group.rows.length === 1 ? "" : "s"}`,
      value: group.kilos,
      colspan: Math.max(model.columns.length - 1, 1)
    });
  });

  if (hiddenGroups.length && explorer.groupOthers) {
    rowModels.push({
      type: "summary",
      label: buildHiddenSummaryLabel(model.key, hiddenGroups.length, fmt),
      value: hiddenKilos,
      colspan: Math.max(model.columns.length - 1, 1)
    });
  }

  if (visibleGroups.length || (hiddenGroups.length && explorer.groupOthers)) {
    rowModels.push({
      type: "total",
      label: buildShownTotalLabel(model.key, visibleGroups.length, hiddenGroups.length, Boolean(explorer.groupOthers), fmt),
      value: shownKilos,
      colspan: Math.max(model.columns.length - 1, 1)
    });
  }

  return {
    ...model,
    rowModels,
    stack,
    metrics: { ...baseMetrics, kilos: shownKilos },
    baseMetrics,
    visibleCount: visibleGroups.length,
    hiddenCount: hiddenGroups.length,
    visibleCountLabel: buildViewCountLabel(model.key, visibleGroups.length, fmt),
    coveragePct,
    topNLimit: limit,
    topNActive: Boolean(limit),
    supportsGroupOthers: true,
    metricOptions: getMetricOptionsForView(model.key),
    activeMetric: normalizeMetricForView(model.key, explorer.metric),
    presetOptions: DETAIL_PRESETS,
    rowCountLabel: buildViewCountLabel(model.key, visibleGroups.length, fmt),
    columnOptions: buildColumnOptions(model.optionRows || model.rows || [], model.columns, explorer, fmt)
  };
}

function buildDetailPresentation(rows = [], explorer = {}, fmt) {
  const view = String(explorer.view || "detalle");
  const rowsAfterSearch = filterRowsBySearch(rows, explorer.search);
  const searchPreview = buildSearchPreview(rowsAfterSearch, explorer.search);

  let model;
  if (view === "cliente") {
    const clientModel = buildClientModel(rowsAfterSearch);
    const filteredClientRows = applyColumnFilters(clientModel.rows, clientModel.columns, explorer);
    model = {
      ...clientModel,
      rows: filteredClientRows,
      optionRows: clientModel.rows,
      metricRows: rowsAfterSearch
    };
  } else if (view === "grupo" || view === "producto" || view === "fecha") {
    const baseModel = buildGroupedModel([], view);
    const filteredBaseRows = applyColumnFilters(rowsAfterSearch, baseModel.columns, explorer);
    model = {
      ...buildGroupedModel(filteredBaseRows, view),
      optionRows: rowsAfterSearch,
      metricRows: filteredBaseRows
    };
  } else {
    const detailModel = buildDetailModel(rowsAfterSearch);
    const filteredDetailRows = applyColumnFilters(detailModel.rows, detailModel.columns, explorer);
    model = {
      ...detailModel,
      rows: filteredDetailRows,
      optionRows: detailModel.rows,
      metricRows: filteredDetailRows
    };
  }

  const requestedMetric = normalizeMetricForView(view, explorer.metric);
  const fallbackStack = buildPrimarySortStackForView(view, requestedMetric, model.columns, model.defaultSortStack);
  const explorerForPresentation = {
    ...explorer,
    metric: requestedMetric,
    sortStack: normalizeSortStack(explorer, model.columns, fallbackStack)
  };

  const presentation = model.grouped ? buildGroupedPresentation(model, explorerForPresentation, fmt) : buildFlatPresentation(model, explorerForPresentation, fmt);

  return {
    ...presentation,
    view,
    explorer: explorerForPresentation,
    searchPreview,
    activeMetric: requestedMetric,
    metricOptions: getMetricOptionsForView(view),
    presetOptions: DETAIL_PRESETS,
    topNOptions: DETAIL_TOP_N_OPTIONS,
    getMetricOptionsForView,
    getColumnsForView: nextView => buildModelForView([], nextView).columns,
    getSortOptionsForView: nextView => buildModelForView([], nextView).sortOptions,
    getDefaultSortStackForView: nextView => buildModelForView([], nextView).defaultSortStack,
    activeColumnFilterCount: Object.values(explorer?.columnFilters || {}).filter(values => Array.isArray(values) && values.length).length
  };
}

function renderSearchPreview(preview = {}, search = "", fmt) {
  const q = String(search || "").trim();
  if (!q) return "";
  const totalMatches = Number(preview?.totalMatches || 0);
  const items = Array.isArray(preview?.items) ? preview.items : [];
  return `
    <div class="detail-search-preview detail-search-preview--compact" data-detail-search-preview>
      <div class="detail-search-preview-head">
        <div class="detail-search-preview-count"><strong>${fmt(totalMatches)}</strong> coincidencias visibles</div>
        <div class="detail-search-preview-note">${items.length ? "Seleccioná una sugerencia para afinar el filtro" : "Sin sugerencias precisas para aplicar"}</div>
      </div>
      ${items.length ? `<div class="detail-search-preview-list">${items.map((item, index) => `
        <button type="button" class="detail-search-preview-item detail-search-preview-item--compact detail-search-preview-item--action" data-detail-search-suggestion="${escapeHtml(item.searchValue)}" data-detail-search-index="${index}" aria-label="Filtrar por ${escapeHtml(item.matchedLabel)} ${escapeHtml(item.searchValue)}">
          <div class="detail-search-preview-kicker">
            <span class="detail-search-preview-tag">${escapeHtml(item.matchedLabel)}</span>
            <span class="detail-search-preview-arrow" aria-hidden="true">↗</span>
          </div>
          <div class="detail-search-preview-title">${highlightMatch(item.matchedValue, q)}</div>
          <div class="detail-search-preview-meta detail-search-preview-meta--compact">
            <span>${fmt(item.matchCount || 0)} coincidencias</span>
            <span>Kilos: ${fmt(item.kilos || 0)}</span>
          </div>
          ${item.hint ? `<div class="detail-search-preview-hint">Ejemplo: ${highlightMatch(item.hint, q)}</div>` : ""}
        </button>
      `).join("")}</div>` : `<div class="detail-search-preview-empty">No hay coincidencias dentro de las filas cargadas.</div>`}
    </div>`;
}

function renderGlanceCards(presentation = {}, explorer = {}, fmt = value => String(value)) {
  const viewLabel = presentation.viewOptions?.find(option => option[0] === presentation.view)?.[1]
    || presentation.title
    || "Vista";
  const visibleLabel = presentation.visibleCountLabel || `${fmt(presentation.visibleCount || 0)} filas visibles`;
  const kilosVisible = fmt(Number(presentation.metrics?.kilos || 0));
  const contextKilos = Number(presentation.baseMetrics?.kilos || presentation.metrics?.kilos || 0);
  const coverageLabel = Number.isFinite(Number(presentation.coveragePct)) ? `${Number(presentation.coveragePct).toFixed(0)}%` : "—";
  const topLabel = presentation.topNLimit ? `Top ${presentation.topNLimit}` : "Contexto completo";
  const activeMetricLabel = (presentation.metricOptions || []).find(option => option.value === presentation.activeMetric || option.value === explorer?.metric)?.label
    || presentation.activeMetric
    || explorer?.metric
    || "Kilos";
  const localRefinements = [];
  if (String(explorer?.search || "").trim()) localRefinements.push(`Busqueda: ${String(explorer.search).trim()}`);
  const activeColumnFilters = Object.values(explorer?.columnFilters || {}).filter(values => Array.isArray(values) && values.length).length;
  if (activeColumnFilters) localRefinements.push(`${activeColumnFilters} filtro${activeColumnFilters === 1 ? "" : "s"} de columna`);
  const cards = [
    { tone: "accent", label: "Lectura visible", value: visibleLabel, meta: viewLabel },
    { tone: "blu", label: "Kilos visibles", value: kilosVisible, meta: contextKilos > 0 && contextKilos !== Number(presentation.metrics?.kilos || 0) ? `de ${fmt(contextKilos)} del contexto` : "contexto visible" },
    { tone: "grn", label: "Cobertura", value: coverageLabel, meta: topLabel },
    { tone: "pur", label: "Refinamiento", value: localRefinements[0] || "Lectura general", meta: localRefinements[1] || `Metrica ${activeMetricLabel}` }
  ];
  return `<div class="detail-glance-grid">${cards.map(card => `
    <article class="detail-glance-card detail-glance-card--${card.tone}">
      <div class="detail-glance-card__eyebrow">${escapeHtml(card.label)}</div>
      <div class="detail-glance-card__value">${escapeHtml(String(card.value || "—"))}</div>
      <div class="detail-glance-card__meta">${escapeHtml(String(card.meta || ""))}</div>
    </article>
  `).join("")}</div>`;
}

function renderSortPills(stack = [], columns = []) {
  if (!stack.length) return `<span class="detail-toolbar-pill">Orden sugerido</span>`;
  const columnMap = new Map(columns.map(column => [column.key, column]));
  return stack.slice(0, 4).map((item, index) => {
    const label = columnMap.get(item.key)?.label || item.key;
    const arrow = item.direction === "asc" ? "↑" : "↓";
    return `<span class="detail-toolbar-pill"><strong>${index + 1}</strong> ${escapeHtml(label)} ${arrow}</span>`;
  }).join("");
}

function renderFilterPillSummary(explorer = {}) {
  const total = Object.values(explorer?.columnFilters || {}).filter(values => Array.isArray(values) && values.length).length;
  if (!total) return "";
  return `<span class="detail-toolbar-pill">Filtros de columna <strong>${total}</strong></span>`;
}

function renderCurrentPresetPill(activePreset = "", presets = DETAIL_PRESETS) {
  const preset = (Array.isArray(presets) ? presets : []).find(item => item.id === activePreset);
  if (!preset) return "";
  return `<span class="detail-toolbar-pill detail-toolbar-pill--accent">Preset <strong>${escapeHtml(preset.label)}</strong></span>`;
}

function renderPresetButtons(activePreset = "", presets = DETAIL_PRESETS) {
  return (Array.isArray(presets) ? presets : []).map(preset => `
    <button type="button" class="detail-preset-btn${preset.id === activePreset ? " is-active" : ""}" data-detail-preset="${escapeHtml(preset.id)}" title="${escapeHtml(preset.hint || preset.label)}">
      <span class="detail-preset-btn__icon" aria-hidden="true">${escapeHtml(preset.icon || "✨")}</span>
      <span class="detail-preset-btn__body">
        <span class="detail-preset-btn__title">${escapeHtml(preset.label)}</span>
        <span class="detail-preset-btn__hint">${escapeHtml(preset.hint || "Vista sugerida")}</span>
      </span>
    </button>
  `).join("");
}

function renderFavoriteOptions(favorites = [], selectedId = "") {
  const items = Array.isArray(favorites) ? favorites : [];
  return [`<option value="">Sin favorita activa</option>`, ...items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>`)].join("");
}

function renderActiveExplorerChips(explorer = {}, presentation = {}) {
  const chips = [];
  const search = String(explorer?.search || "").trim();
  if (search) {
    chips.push(`<button type="button" class="detail-filter-chip" data-clear-search="1">Busqueda · ${escapeHtml(search)}</button>`);
  }

  Object.entries(explorer?.columnFilters || {}).forEach(([key, values]) => {
    const selected = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!selected.length) return;
    const label = GENERAL_COLUMN_LABELS[key] || key;
    const suffix = selected.length === 1 ? selected[0] : `${selected.length} seleccionados`;
    chips.push(`<button type="button" class="detail-filter-chip" data-clear-filter-key="${escapeHtml(key)}">${escapeHtml(label)} · ${escapeHtml(suffix)}</button>`);
  });

  if (!chips.length) {
    return `<span class="detail-filter-chip detail-filter-chip--ghost">Sin refinamientos locales</span>`;
  }
  return chips.join("");
}

function buildPresetPatch(presetId, presentation = {}, viewOptions = DETAIL_VIEW_OPTIONS) {
  const presets = Array.isArray(presentation?.presetOptions) && presentation.presetOptions.length
    ? presentation.presetOptions
    : DETAIL_PRESETS;
  const preset = presets.find(item => item.id === presetId);
  if (!preset) return null;
  const nextView = preset.view || viewOptions?.[0]?.[0] || "detalle";
  const nextColumns = typeof presentation.getColumnsForView === "function"
    ? presentation.getColumnsForView(nextView)
    : presentation.columns;
  const fallbackStack = typeof presentation.getDefaultSortStackForView === "function"
    ? presentation.getDefaultSortStackForView(nextView)
    : presentation.defaultSortStack;
  const resolveMetric = typeof presentation.normalizeMetric === "function" ? presentation.normalizeMetric : normalizeMetricForView;
  const metric = resolveMetric(nextView, preset.metric);
  const nextStack = buildPrimarySortStackForView(nextView, metric, nextColumns || [], fallbackStack || []);
  return {
    view: nextView,
    metric,
    topN: preset.topN || "all",
    groupOthers: Boolean(preset.groupOthers),
    search: preset.search || "",
    sort: nextStack[0]?.key || "default",
    direction: nextStack[0]?.direction || "desc",
    sortStack: nextStack,
    columnFilters: {},
    openColumnMenu: "",
    currentPreset: preset.id,
    favoriteId: ""
  };
}

function renderExecutiveBlocks(presentation = {}) {
  const blocks = [];
  if (presentation?.executiveSummaryHtml) {
    blocks.push(`<article class="detail-exec-card"><div class="detail-exec-card__eyebrow">Insight</div><div class="detail-exec-card__body">${presentation.executiveSummaryHtml}</div></article>`);
  }
  if (presentation?.comparisonSummaryHtml) {
    blocks.push(`<article class="detail-exec-card"><div class="detail-exec-card__eyebrow">Comparacion</div><div class="detail-exec-card__body">${presentation.comparisonSummaryHtml}</div></article>`);
  }
  return blocks.length ? `<div class="detail-exec-grid">${blocks.join("")}</div>` : "";
}

function sanitizeExportFilename(value = "vista_explorador") {
  return String(value || "vista_explorador")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "vista_explorador";
}

function csvEscape(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function buildExportBundle(presentation = {}, fmt = value => String(value)) {
  const columns = Array.isArray(presentation?.exportColumns) && presentation.exportColumns.length
    ? presentation.exportColumns
    : (presentation?.columns || []);
  const rawRows = Array.isArray(presentation?.exportRows)
    ? presentation.exportRows
    : Array.isArray(presentation?.rowModels)
      ? presentation.rowModels.filter(item => item?.type === "data").map(item => item.row)
      : [];
  return {
    filename: sanitizeExportFilename(presentation?.exportFilename || `${presentation?.title || 'vista'}_${presentation?.view || 'detalle'}`),
    columns,
    rows: rawRows.map(row => Object.fromEntries(columns.map(column => {
      const raw = row?.[column.key];
      if (column.type === "number") return [column.label, Number(raw || 0)];
      return [column.label, raw ?? ""];
    }))),
    formatters: Object.fromEntries(columns.map(column => [column.label, column.type === "number" ? value => fmt(Number(value || 0)) : value => String(value ?? "")]))
  };
}

function downloadExportBundle(bundle = {}) {
  const columns = Array.isArray(bundle?.columns) ? bundle.columns.map(column => column.label) : [];
  const rows = Array.isArray(bundle?.rows) ? bundle.rows : [];
  if (!columns.length || !rows.length) return false;
  const formatters = bundle?.formatters || {};
  const csv = [
    columns.join(","),
    ...rows.map(row => columns.map(label => csvEscape((formatters[label] || (value => String(value ?? "")))(row?.[label]))).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeExportFilename(bundle.filename || 'vista_explorador')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

export function renderToolbar(toolsNode, explorer, presentation, fmt, onExplorerPatch, toolbarActions = {}) {
  if (!toolsNode) return;
  const active = document.activeElement;
  const shouldRefocusSearch = active?.id === "detailSearch";
  const caretStart = shouldRefocusSearch && Number.isFinite(active?.selectionStart) ? active.selectionStart : null;
  const caretEnd = shouldRefocusSearch && Number.isFinite(active?.selectionEnd) ? active.selectionEnd : caretStart;
  const view = String(explorer?.view || "detalle");
  const resolveMetric = typeof presentation.normalizeMetric === "function" ? presentation.normalizeMetric : normalizeMetricForView;
  const metric = resolveMetric(view, explorer?.metric);
  const stack = normalizeSortStack(explorer, presentation.columns, presentation.defaultSortStack);
  const primarySort = stack[0]?.key || (view === "detalle" ? "default" : presentation.sortOptions?.[0]?.value || "Kilos");
  const primaryDirection = stack[0]?.direction || preferredDirectionForKey(primarySort);
  const search = String(explorer?.search || "");
  const showAdvanced = Boolean(explorer?.showAdvanced);
  const sortOptions = presentation.sortOptions || [];
  const viewOptions = Array.isArray(presentation.viewOptions) && presentation.viewOptions.length ? presentation.viewOptions : DETAIL_VIEW_OPTIONS;
  const searchPlaceholder = presentation.searchPlaceholder || "Cliente, grupo, producto o codigo";
  const toolbarTip = presentation.toolbarTip || `Los encabezados permiten orden multi-criterio y filtros por columna sobre el contexto filtrado cargado.`;
  const favorites = Array.isArray(toolbarActions.favorites) ? toolbarActions.favorites : [];
  const allowFavorites = Boolean(toolbarActions.onSaveFavorite || toolbarActions.onApplyFavorite || toolbarActions.onDeleteFavorite || favorites.length);
  const canExport = buildExportBundle(presentation, fmt).rows.length > 0;
  const topNValue = String(explorer?.topN || "all");
  const topNLabel = topNValue === "all" ? "Todo el alcance cargado" : `${presentation.topNLimit ? `Top ${presentation.topNLimit}` : `Top ${topNValue}`}`;
  const coverageLabel = Number.isFinite(presentation.coveragePct) ? `${presentation.coveragePct.toFixed(0)}% del kilo visible` : "—";
  const executiveBlocks = renderExecutiveBlocks(presentation);

  const buildStackForView = (nextView, nextMetric) => {
    const nextColumns = typeof presentation.getColumnsForView === "function"
      ? presentation.getColumnsForView(nextView)
      : presentation.columns;
    const fallbackStack = typeof presentation.getDefaultSortStackForView === "function"
      ? presentation.getDefaultSortStackForView(nextView)
      : presentation.defaultSortStack;
    return buildPrimarySortStackForView(nextView, resolveMetric(nextView, nextMetric), nextColumns || [], fallbackStack || []);
  };

  const refocusSearch = () => {
    const searchInput = toolsNode.querySelector("#detailSearch");
    if (shouldRefocusSearch && searchInput) {
      searchInput.focus({ preventScroll: true });
      if (caretStart !== null) {
        const nextCaretStart = Math.min(caretStart, searchInput.value.length);
        const nextCaretEnd = Math.min(caretEnd ?? nextCaretStart, searchInput.value.length);
        searchInput.setSelectionRange(nextCaretStart, nextCaretEnd);
      }
    }
  };

  const bindSharedInteractions = () => {
    const searchInput = toolsNode.querySelector("#detailSearch");
    searchInput?.addEventListener("input", event => onExplorerPatch?.({ search: event.target.value || "", currentPreset: "custom", favoriteId: "" }));

    const suggestionButtons = [...toolsNode.querySelectorAll("[data-detail-search-suggestion]")];
    const focusSuggestion = index => {
      const target = suggestionButtons[index];
      if (!target) return;
      target.focus({ preventScroll: true });
    };

    searchInput?.addEventListener("keydown", event => {
      if (event.key === "ArrowDown" && suggestionButtons.length) {
        event.preventDefault();
        focusSuggestion(0);
      }
    });

    suggestionButtons.forEach((button, index) => {
      button.addEventListener("click", event => {
        event.preventDefault();
        const value = button.getAttribute("data-detail-search-suggestion") || "";
        if (!value) return;
        onExplorerPatch?.({ search: value, currentPreset: "custom", favoriteId: "" });
        showToast("Sugerencia aplicada");
      });
      button.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusSuggestion((index + 1) % suggestionButtons.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          if (index === 0) searchInput?.focus({ preventScroll: true });
          else focusSuggestion(index - 1);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          searchInput?.focus({ preventScroll: true });
        }
      });
    });

    toolsNode.querySelector("#detailView")?.addEventListener("change", event => {
      const nextView = event.target.value || viewOptions?.[0]?.[0] || "detalle";
      const nextMetric = resolveMetric(nextView, metric);
      const nextStack = buildStackForView(nextView, nextMetric);
      onExplorerPatch?.({
        view: nextView,
        metric: nextMetric,
        sort: nextStack[0]?.key || "default",
        direction: nextStack[0]?.direction || "desc",
        sortStack: nextStack,
        columnFilters: {},
        openColumnMenu: "",
        currentPreset: "custom",
        favoriteId: ""
      });
    });

    toolsNode.querySelector("#detailSort")?.addEventListener("change", event => {
      const nextKey = event.target.value || "default";
      if (nextKey === "default") {
        onExplorerPatch?.({ sort: "default", direction: preferredDirectionForKey(metric), sortStack: [], openColumnMenu: "", currentPreset: "custom", favoriteId: "" });
        return;
      }
      const nextDirection = preferredDirectionForKey(nextKey);
      onExplorerPatch?.({
        sort: nextKey,
        direction: nextDirection,
        sortStack: [{ key: nextKey, direction: nextDirection }],
        openColumnMenu: "",
        currentPreset: "custom",
        favoriteId: ""
      });
    });

    toolsNode.querySelector("#detailDir")?.addEventListener("change", event => {
      const nextDirection = event.target.value === "asc" ? "asc" : "desc";
      const nextStack = stack.length ? [{ ...stack[0], direction: nextDirection }, ...stack.slice(1)] : [];
      onExplorerPatch?.({ direction: nextDirection, sortStack: nextStack, openColumnMenu: "", currentPreset: "custom", favoriteId: "" });
    });

    toolsNode.querySelector("#detailMetric")?.addEventListener("change", event => {
      const nextMetric = resolveMetric(view, event.target.value || metric);
      const nextStack = buildStackForView(view, nextMetric);
      onExplorerPatch?.({
        metric: nextMetric,
        sort: nextStack[0]?.key || "default",
        direction: nextStack[0]?.direction || "desc",
        sortStack: nextStack,
        openColumnMenu: "",
        currentPreset: "custom",
        favoriteId: ""
      });
    });

    toolsNode.querySelector("#detailTopN")?.addEventListener("change", event => {
      onExplorerPatch?.({ topN: event.target.value || "all", currentPreset: "custom", favoriteId: "" });
    });

    toolsNode.querySelector("#detailToggleAdvanced")?.addEventListener("click", () => onExplorerPatch?.({ showAdvanced: !showAdvanced }));
    toolsNode.querySelector("#detailSheetClose")?.addEventListener("click", () => onExplorerPatch?.({ showAdvanced: false }));
    toolsNode.querySelector("#detailSheetBackdrop")?.addEventListener("click", () => onExplorerPatch?.({ showAdvanced: false }));

    toolsNode.querySelectorAll("[data-detail-preset]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        const patch = buildPresetPatch(button.getAttribute("data-detail-preset") || "", presentation, viewOptions);
        if (patch) onExplorerPatch?.(patch);
      });
    });

    toolsNode.querySelector("#detailFavorite")?.addEventListener("change", event => {
      const favoriteId = event.target.value || "";
      if (favoriteId) toolbarActions.onApplyFavorite?.(favoriteId);
      else onExplorerPatch?.({ favoriteId: "" });
    });
    toolsNode.querySelector("#detailSaveFavorite")?.addEventListener("click", () => toolbarActions.onSaveFavorite?.());
    toolsNode.querySelector("#detailDeleteFavorite")?.addEventListener("click", () => toolbarActions.onDeleteFavorite?.(String(explorer?.favoriteId || "")));

    toolsNode.querySelectorAll("[data-clear-search]").forEach(button => {
      button.addEventListener("click", () => onExplorerPatch?.({ search: "", currentPreset: "custom", favoriteId: "" }));
    });
    toolsNode.querySelectorAll("[data-clear-filter-key]").forEach(button => {
      button.addEventListener("click", () => {
        const key = button.getAttribute("data-clear-filter-key") || "";
        if (!key) return;
        const current = { ...(explorer?.columnFilters || {}) };
        delete current[key];
        onExplorerPatch?.({ columnFilters: current, openColumnMenu: "", currentPreset: "custom", favoriteId: "" });
      });
    });

    toolsNode.querySelector("#detailGroupOthers")?.addEventListener("change", event => {
      onExplorerPatch?.({ groupOthers: Boolean(event.target.checked), currentPreset: "custom", favoriteId: "" });
    });

    toolsNode.querySelector("#detailClearSearch")?.addEventListener("click", () => onExplorerPatch?.({ search: "", currentPreset: "custom", favoriteId: "" }));
    toolsNode.querySelector("#detailClearColumnFilters")?.addEventListener("click", () => onExplorerPatch?.({ columnFilters: {}, openColumnMenu: "", currentPreset: "custom", favoriteId: "" }));
    toolsNode.querySelector("#detailResetView")?.addEventListener("click", () => {
      const resetView = presentation.resetView || viewOptions?.[0]?.[0] || "detalle";
      const resetMetric = resolveMetric(resetView, resetView === "detalle" ? "Fecha" : "Kilos");
      const resetStack = buildStackForView(resetView, resetMetric);
      onExplorerPatch?.({
        view: resetView,
        metric: resetMetric,
        sort: resetStack[0]?.key || "default",
        direction: resetStack[0]?.direction || "desc",
        search: "",
        sortStack: resetStack,
        columnFilters: {},
        topN: "50",
        groupOthers: true,
        currentPreset: "custom",
        favoriteId: "",
        openColumnMenu: "",
        showAdvanced: false
      });
    });

    toolsNode.querySelector("#detailExportView")?.addEventListener("click", () => {
      downloadExportBundle(buildExportBundle(presentation, fmt));
    });

    refocusSearch();
  };

  if (!Array.isArray(presentation.presetOptions)) {
    toolsNode.innerHTML = `
      <div class="detail-toolbar-main">
        <div class="detail-tool-field detail-tool-field--wide">
          <label for="detailSearch">Buscar dentro del resumen</label>
          <input id="detailSearch" type="text" placeholder="${escapeHtml(searchPlaceholder)}" value="${escapeHtml(search)}" autocomplete="off" spellcheck="false">
          ${renderSearchPreview(presentation.searchPreview, search, fmt)}
        </div>
        <div class="detail-tool-field">
          <label for="detailView">Vista</label>
          <select id="detailView">${viewOptions.map(([value, label]) => `<option value="${value}" ${value === view ? "selected" : ""}>${label}</option>`).join("")}</select>
        </div>
        <div class="detail-tool-field">
          <label for="detailSort">Ordenar por</label>
          <select id="detailSort">${sortOptions.map(option => `<option value="${option.value}" ${option.value === primarySort ? "selected" : ""}>${option.label}</option>`).join("")}</select>
        </div>
        <div class="detail-tool-field">
          <label for="detailDir">Direccion</label>
          <select id="detailDir">
            <option value="desc" ${primaryDirection === "desc" ? "selected" : ""}>Mayor a menor</option>
            <option value="asc" ${primaryDirection === "asc" ? "selected" : ""}>Menor a mayor</option>
          </select>
        </div>
        <div class="detail-tool-actions">
          ${canExport ? `<button type="button" class="detail-tool-btn" id="detailExportView">Exportar vista</button>` : ""}
          <button type="button" class="detail-tool-btn" id="detailClearSearch">Limpiar busqueda</button>
          <button type="button" class="detail-tool-btn" id="detailClearColumnFilters">Limpiar columnas</button>
          <button type="button" class="detail-tool-btn detail-tool-btn--accent" id="detailResetView">Restablecer vista</button>
        </div>
      </div>
      <div class="detail-toolbar-meta">
        <div class="detail-toolbar-pills">
          <span class="detail-toolbar-pill"><strong>${fmt(presentation.visibleCount)}</strong> filas visibles</span>
          <span class="detail-toolbar-pill"><strong>${fmt(presentation.metrics.kilos)}</strong> kilos visibles</span>
          <span class="detail-toolbar-pill">Vista <strong>${viewOptions.find(option => option[0] === view)?.[1] || "Detalle"}</strong></span>
          ${renderCurrentPresetPill(String(explorer?.currentPreset || ""), presentation.presetOptions)}
          ${renderFilterPillSummary(explorer)}
          ${renderSortPills(stack, presentation.columns)}
        </div>
        <div class="detail-toolbar-tip">${escapeHtml(toolbarTip)}</div>
      </div>
      ${renderGlanceCards(presentation, explorer, fmt)}
      ${executiveBlocks}`;
    bindSharedInteractions();
    return;
  }

  toolsNode.innerHTML = `
    <div class="detail-toolbar-shell${showAdvanced ? " is-sheet-open" : ""}" data-sheet-open="${showAdvanced ? "true" : "false"}">
      <div class="detail-toolbar-main detail-toolbar-main--compact">
        <div class="detail-tool-field detail-tool-field--wide">
          <label for="detailSearch">Buscar dentro del resumen</label>
          <input id="detailSearch" type="text" placeholder="${escapeHtml(searchPlaceholder)}" value="${escapeHtml(search)}" autocomplete="off" spellcheck="false">
          ${renderSearchPreview(presentation.searchPreview, search, fmt)}
        </div>
        <div class="detail-tool-field">
          <label for="detailView">Vista</label>
          <select id="detailView">${viewOptions.map(([value, label]) => `<option value="${value}" ${value === view ? "selected" : ""}>${label}</option>`).join("")}</select>
        </div>
        <div class="detail-tool-field">
          <label for="detailMetric">Metrica principal</label>
          <select id="detailMetric">${(presentation.metricOptions || []).map(option => `<option value="${option.value}" ${option.value === metric ? "selected" : ""}>${option.label}</option>`).join("")}</select>
        </div>
        <div class="detail-tool-field">
          <label for="detailTopN">Nivel de foco</label>
          <select id="detailTopN">${(presentation.topNOptions || DETAIL_TOP_N_OPTIONS).map(([value, label]) => `<option value="${value}" ${value === topNValue ? "selected" : ""}>${label}</option>`).join("")}</select>
        </div>
        <div class="detail-tool-actions detail-tool-actions--compact">
          <button type="button" class="detail-tool-btn" id="detailToggleAdvanced">${showAdvanced ? "Ocultar avanzado" : "Mostrar avanzado"}</button>
          ${canExport ? `<button type="button" class="detail-tool-btn" id="detailExportView">Exportar vista</button>` : ""}
          ${allowFavorites ? `<button type="button" class="detail-tool-btn detail-tool-btn--accent" id="detailSaveFavorite">Guardar vista</button>` : ""}
        </div>
      </div>
      <div class="detail-toolbar-meta detail-toolbar-meta--context">
        <div class="detail-toolbar-pills">
          <span class="detail-toolbar-pill"><strong>${presentation.visibleCountLabel || `${fmt(presentation.visibleCount)} filas visibles`}</strong></span>
          <span class="detail-toolbar-pill"><strong>${fmt(presentation.metrics.kilos)}</strong> kilos mostrados</span>
          <span class="detail-toolbar-pill">Vista <strong>${viewOptions.find(option => option[0] === view)?.[1] || "Detalle"}</strong></span>
          <span class="detail-toolbar-pill">Metrica <strong>${escapeHtml((presentation.metricOptions || []).find(option => option.value === metric)?.label || metric)}</strong></span>
          <span class="detail-toolbar-pill">Foco <strong>${escapeHtml(topNLabel)}</strong></span>
          <span class="detail-toolbar-pill">Cobertura <strong>${escapeHtml(coverageLabel)}</strong></span>
          ${renderCurrentPresetPill(String(explorer?.currentPreset || ""), presentation.presetOptions)}
          ${renderFilterPillSummary(explorer)}
          ${renderSortPills(stack, presentation.columns)}
        </div>
        <div class="detail-toolbar-tip">${escapeHtml(toolbarTip)}</div>
      </div>
      ${renderGlanceCards(presentation, explorer, fmt)}
      <div class="detail-toolbar-presets detail-toolbar-presets--inline">
        <div class="detail-toolbar-presets__head">
          <div class="detail-toolbar-section-title">Presets sugeridos</div>
          <div class="detail-toolbar-tip">Atajos visuales para Resumen y Proyectado.</div>
        </div>
        <div class="detail-preset-row detail-preset-row--rail">${renderPresetButtons(String(explorer?.currentPreset || ""), presentation.presetOptions)}</div>
      </div>
      <div class="detail-toolbar-filters-row">
        ${renderActiveExplorerChips(explorer, presentation)}
      </div>
      ${executiveBlocks}
      <div class="detail-toolbar-sheetbackdrop" id="detailSheetBackdrop"></div>
      <div class="detail-toolbar-sheet">
        <div class="detail-toolbar-sheet__head">
          <div>
            <div class="detail-toolbar-section-title">Opciones avanzadas</div>
            <div class="detail-toolbar-tip">Ajustes finos para explorar, comparar y exportar la vista actual.</div>
          </div>
          <button type="button" class="detail-tool-btn" id="detailSheetClose">Cerrar</button>
        </div>
        ${allowFavorites ? `<div class="detail-toolbar-secondary">
          <div class="detail-toolbar-favorites">
            <div class="detail-toolbar-section-title">Vistas guardadas</div>
            <div class="detail-favorite-row">
              <select id="detailFavorite">${renderFavoriteOptions(favorites, String(explorer?.favoriteId || ""))}</select>
              <button type="button" class="detail-tool-btn" id="detailDeleteFavorite" ${explorer?.favoriteId ? "" : "disabled"}>Quitar</button>
            </div>
          </div>
        </div>` : ""}
        <div class="detail-toolbar-advanced${allowFavorites ? "" : " detail-toolbar-advanced--wide"}">
          <div class="detail-tool-field">
            <label for="detailSort">Ordenar por</label>
            <select id="detailSort">${sortOptions.map(option => `<option value="${option.value}" ${option.value === primarySort ? "selected" : ""}>${option.label}</option>`).join("")}</select>
          </div>
          <div class="detail-tool-field">
            <label for="detailDir">Direccion</label>
            <select id="detailDir">
              <option value="desc" ${primaryDirection === "desc" ? "selected" : ""}>Mayor a menor</option>
              <option value="asc" ${primaryDirection === "asc" ? "selected" : ""}>Menor a mayor</option>
            </select>
          </div>
          <label class="detail-toggle detail-toggle--switch">
            <input id="detailGroupOthers" type="checkbox" ${explorer?.groupOthers ? "checked" : ""} ${presentation.supportsGroupOthers ? "" : "disabled"}>
            <span>Agrupar resto en Otros</span>
          </label>
          <div class="detail-tool-actions detail-tool-actions--advanced">
            <button type="button" class="detail-tool-btn" id="detailClearSearch">Limpiar busqueda</button>
            <button type="button" class="detail-tool-btn" id="detailClearColumnFilters">Limpiar columnas</button>
            <button type="button" class="detail-tool-btn detail-tool-btn--accent" id="detailResetView">Restablecer vista</button>
          </div>
        </div>
      </div>
    </div>`;

  bindSharedInteractions();
}

function isColumnFiltered(explorer = {}, columnKey = "") {
  const values = explorer?.columnFilters?.[columnKey];
  return Array.isArray(values) && values.length > 0;
}

function getSortStateForColumn(stack = [], key = "") {
  const index = stack.findIndex(item => item.key === key);
  if (index < 0) return { active: false, direction: "desc", priority: 0 };
  return { active: true, direction: stack[index].direction, priority: index + 1 };
}

function renderHeaderMenu(column, presentation, explorer = {}, fmt, menuAlign = "") {
  const openColumnMenu = String(explorer?.openColumnMenu || "");
  if (openColumnMenu !== column.key) return "";
  const sortState = getSortStateForColumn(presentation.stack, column.key);
  const selected = Array.isArray(explorer?.columnFilters?.[column.key]) ? explorer.columnFilters[column.key] : [];
  const selectedSet = new Set(selected);
  const options = [...(presentation.columnOptions?.[column.key] || [])].sort((left, right) => {
    const leftSelected = selectedSet.has(left.value);
    const rightSelected = selectedSet.has(right.value);
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    return String(left.label || left.value || "").localeCompare(String(right.label || right.value || ""), "es");
  });
  const loading = presentation.columnOptionsLoadingKey === column.key;
  const selectedLabel = selected.length ? `${selected.length} seleccionado${selected.length === 1 ? "" : "s"}` : "Sin filtros aplicados";
  return `
    <div class="detail-col-menu ${menuAlign}" data-col-menu="${escapeHtml(column.key)}" data-floating-state="pending">
      <div class="detail-col-menu__head">${escapeHtml(column.label)}</div>
      <div class="detail-col-menu__actions">
        <button type="button" class="detail-col-menu__btn" data-col-sort="desc" data-col-key="${escapeHtml(column.key)}">Orden desc</button>
        <button type="button" class="detail-col-menu__btn" data-col-sort="asc" data-col-key="${escapeHtml(column.key)}">Orden asc</button>
        ${sortState.active ? `<button type="button" class="detail-col-menu__btn" data-col-sort-clear="${escapeHtml(column.key)}">Quitar orden</button>` : ""}
      </div>
      <div class="detail-col-menu__meta">${loading ? "Cargando valores del contexto filtrado..." : `${selectedLabel} · Aplicá cambios juntos para evitar recargas innecesarias.`}</div>
      <div class="detail-col-menu__searchwrap">
        <input type="search" class="detail-col-menu__search" data-col-filter-search="${escapeHtml(column.key)}" placeholder="Buscar valor..." autocomplete="off" spellcheck="false">
      </div>
      <div class="detail-col-menu__list">
        ${loading && !options.length ? `<div class="detail-col-menu__empty">Cargando opciones...</div>` : (options.length ? options.map(option => {
          const checked = selectedSet.has(option.value);
          return `<label class="detail-col-menu__item" data-col-option-item="${escapeHtml(column.key)}" data-col-option-label="${escapeHtml(String(option.label || option.value || "").toLowerCase())}">
            <input type="checkbox" data-col-filter-key="${escapeHtml(column.key)}" data-col-filter-value="${escapeHtml(option.value)}" ${checked ? "checked" : ""}>
            <span>${escapeHtml(option.label)}</span>
          </label>`;
        }).join("") : `<div class="detail-col-menu__empty">No hay valores para filtrar.</div>`)}
      </div>
      <div class="detail-col-menu__footer">
        <button type="button" class="detail-col-menu__btn" data-col-filter-selectall="${escapeHtml(column.key)}">Todos</button>
        <button type="button" class="detail-col-menu__btn" data-col-filter-clear="${escapeHtml(column.key)}">Limpiar</button>
        <button type="button" class="detail-col-menu__btn detail-col-menu__btn--accent" data-col-filter-apply="${escapeHtml(column.key)}">Aplicar</button>
        <button type="button" class="detail-col-menu__btn" data-col-menu-close="${escapeHtml(column.key)}">Cerrar</button>
      </div>
    </div>`;
}

export function renderHeaderCell(column, presentation, explorer = {}, fmt, context = {}) {
  const sortState = getSortStateForColumn(presentation.stack, column.key);
  const filtered = isColumnFiltered(explorer, column.key);
  const index = Number(context.index || 0);
  const totalColumns = Number(context.totalColumns || 1);
  const menuAlign = index <= 1 ? "detail-col-menu--left" : (index >= totalColumns - 2 ? "detail-col-menu--right" : "");
  return `<th class="detail-head${column.className?.includes("r") ? " r" : ""}${sortState.active ? " is-sorted" : ""}${filtered ? " is-filtered" : ""}">
    <div class="detail-head-wrap">
      <button type="button" class="detail-head-sort" data-head-sort="${escapeHtml(column.key)}">
        <span>${escapeHtml(column.label)}</span>
        ${sortState.active ? `<span class="detail-head-sortstate">${sortState.direction === "asc" ? "↑" : "↓"}<b>${sortState.priority}</b></span>` : ""}
      </button>
      <button type="button" class="detail-head-filter" data-head-menu="${escapeHtml(column.key)}" aria-label="Filtrar ${escapeHtml(column.label)}">
        ${filtered ? `<span class="detail-head-filtercount">${(explorer?.columnFilters?.[column.key] || []).length}</span>` : "▾"}
      </button>
    </div>
    ${renderHeaderMenu(column, presentation, explorer, fmt, menuAlign)}
  </th>`;
}

export function renderDataCellContent(raw, column, explorer = {}, fmt, escHtml) {
  if (column.type === "number") return fmt(Number(raw || 0));
  if (!raw && raw !== 0) return "";
  if (typeof raw === "string" && explorer?.search) return highlightMatch(raw, explorer.search);
  return escHtml(raw ?? "");
}

function renderBodyRow(rowModel, presentation, explorer = {}, fmt, escHtml) {
  if (rowModel.type === "subtotal") {
    return `<tr class="detail-subtotal-row"><td colspan="${rowModel.colspan}" class="detail-total-label">${escapeHtml(rowModel.label)}</td><td class="num r detail-total-value">${fmt(rowModel.value)}</td></tr>`;
  }
  if (rowModel.type === "summary") {
    return `<tr class="detail-summary-row"><td colspan="${rowModel.colspan}" class="detail-total-label">${escapeHtml(rowModel.label)}</td><td class="num r detail-total-value">${fmt(rowModel.value)}</td></tr>`;
  }
  if (rowModel.type === "total") {
    return `<tr class="detail-grandtotal-row"><td colspan="${rowModel.colspan}" class="detail-total-label">${escapeHtml(rowModel.label)}</td><td class="num r detail-total-value">${fmt(rowModel.value)}</td></tr>`;
  }

  const drill = rowModel.drill;
  const rowAttrs = drill
    ? ` class="detail-data-row detail-data-row--drill" data-drill-key="${escapeHtml(drill.key)}" data-drill-value="${escapeHtml(drill.value)}" data-drill-label="${escapeHtml(drill.label)}" title="Abrir detalle para ${escapeHtml(drill.label)}"`
    : "";
  return `<tr${rowAttrs}>${presentation.columns.map(column => {
    const raw = rowModel.row?.[column.key];
    let content = renderDataCellContent(raw, column, explorer, fmt, escHtml);
    if (column.type === "number") {
      const useMeter = shouldRenderMetricMeter(column, presentation.metricMeterKeys || []);
      const renderedValue = useMeter
        ? renderNumericMeterCell(raw, column, fmt, { scaleMap: presentation.numericScaleMap || {} })
        : content;
      content = `<button type="button" class="detail-copy-cell" data-copy-value="${escapeHtml(String(raw ?? ''))}" title="Copiar valor">${renderedValue}</button>`;
    }
    return cell(column.label, content, column.className || (column.type === "number" ? "r" : ""));
  }).join("")}</tr>`;
}

function cycleSortStack(existing = [], key = "") {
  const stack = Array.isArray(existing) ? existing.slice() : [];
  const index = stack.findIndex(item => item.key === key);
  if (index < 0) {
    stack.push({ key, direction: "desc" });
    return stack;
  }
  if (stack[index].direction === "desc") {
    stack[index] = { key, direction: "asc" };
    return stack;
  }
  stack.splice(index, 1);
  return stack;
}

const DETAIL_COL_MENU_LAYER_ID = "detailColumnMenuLayer";
const floatingColumnMenuState = {
  rafId: 0,
  teardown: null,
  entries: []
};
const floatingColumnMenuDismissState = {
  teardown: null
};

function resolveFloatingMenuHost(headNode) {
  return headNode?.closest(".card")
    || headNode?.closest(".tw")?.parentElement
    || document.body;
}

function getDetailColumnMenuLayer(hostNode) {
  const host = hostNode || document.body;
  let layer = document.getElementById(DETAIL_COL_MENU_LAYER_ID);
  if (!layer) {
    layer = document.createElement("div");
    layer.id = DETAIL_COL_MENU_LAYER_ID;
    layer.className = "detail-col-menu-layer";
  }
  if (layer.parentElement !== host) host.appendChild(layer);
  return layer;
}

function normalizeFloatingMenuContext(target) {
  if (!target) return { headNode: null, hostNode: null };
  if (typeof Element !== "undefined" && target instanceof Element) {
    return { headNode: target, hostNode: resolveFloatingMenuHost(target) };
  }
  if (target?.headNode && typeof Element !== "undefined" && target.headNode instanceof Element) {
    return {
      headNode: target.headNode,
      hostNode: target.hostNode || resolveFloatingMenuHost(target.headNode)
    };
  }
  return { headNode: null, hostNode: null };
}

function clearFloatingColumnMenuTracking() {
  if (floatingColumnMenuState.rafId) {
    window.cancelAnimationFrame(floatingColumnMenuState.rafId);
    floatingColumnMenuState.rafId = 0;
  }
  if (typeof floatingColumnMenuState.teardown === "function") {
    floatingColumnMenuState.teardown();
  }
  floatingColumnMenuState.teardown = null;
  floatingColumnMenuState.entries = [];
}

function clearFloatingColumnMenuDismissHandlers() {
  if (typeof floatingColumnMenuDismissState.teardown === "function") {
    floatingColumnMenuDismissState.teardown();
  }
  floatingColumnMenuDismissState.teardown = null;
}

function bindFloatingColumnMenuDismissHandlers(headNode, explorer = {}, onExplorerPatch) {
  clearFloatingColumnMenuDismissHandlers();
  if (!headNode || typeof onExplorerPatch !== "function") return;
  const openColumnMenu = String(explorer?.openColumnMenu || "").trim();
  if (!openColumnMenu) return;

  const layer = document.getElementById(DETAIL_COL_MENU_LAYER_ID);
  let dismissed = false;
  const closeMenu = () => {
    if (dismissed) return;
    dismissed = true;
    onExplorerPatch({ openColumnMenu: "" });
  };

  const onPointerDown = event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (headNode.contains(target)) return;
    if (layer?.contains(target)) return;
    closeMenu();
  };

  const onKeyDown = event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeMenu();
  };

  const onScroll = event => {
    const target = event.target;
    if (target instanceof Element && (headNode.contains(target) || layer?.contains(target))) return;
    closeMenu();
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", onScroll, true);
  floatingColumnMenuDismissState.teardown = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", onScroll, true);
  };
}

function positionFloatingColumnMenuEntries(entries = []) {
  if (!entries.length) return;
  const viewportWidth  = window.innerWidth  || document.documentElement.clientWidth  || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const gutter = 12;
  const gap    = 8;

  // chromeHeight = todo el contenido del menú EXCEPTO la lista de opciones:
  // cabecera + botones de orden + meta + campo de búsqueda + footer con botones + gaps de grid.
  // Se ajustó al estilo actual (footer con padding-top:10px + border + botones min-height:34px).
  const chromeHeight = 198;

  entries.forEach(({ menu, trigger, host }) => {
    if (!menu?.isConnected || !trigger?.isConnected || !host?.isConnected) return;

    const hostRect = host.getBoundingClientRect();

    // Paso 1: Colocar el menú fuera de vista (invisible) para medir su ancho
    menu.style.position   = "absolute";
    menu.style.left       = "0px";
    menu.style.top        = "0px";
    menu.style.right      = "auto";
    menu.style.bottom     = "auto";
    menu.style.margin     = "0";
    menu.style.maxHeight  = "";
    menu.style.maxWidth   = `min(320px, calc(100vw - ${gutter * 2}px))`;
    menu.style.minWidth   = `min(240px, calc(100vw - ${gutter * 2}px))`;
    menu.dataset.floatingState = "pending";

    // Paso 2: Leer la posición del trigger para calcular espacio disponible
    const triggerRect   = trigger.getBoundingClientRect();
    const triggerCenter = triggerRect.left + (triggerRect.width / 2);
    const belowTop      = triggerRect.bottom + gap;
    const belowSpace    = Math.max(0, viewportHeight - belowTop - gutter);
    const aboveSpace    = Math.max(0, triggerRect.top - gutter - gap);

    // Paso 3: Calcular maxHeight de la lista ANTES de medir el menú,
    // para que getBoundingClientRect() devuelva el alto final correcto.
    const renderAbove     = belowSpace < 220 && aboveSpace > belowSpace;
    const availableHeight = Math.max(renderAbove ? aboveSpace : belowSpace, chromeHeight + 96);
    const listMaxHeight   = Math.max(96, Math.min(180, Math.floor(availableHeight - chromeHeight)));
    const expectedMenuH   = Math.min(chromeHeight + listMaxHeight, availableHeight);
    const clampedMenuH    = Math.max(180, expectedMenuH);

    // Aplicar maxHeight y variable de lista ANTES de leer el ancho real del menú
    menu.style.maxHeight = `${Math.round(clampedMenuH)}px`;
    menu.style.setProperty("--detail-col-menu-list-max-height", `${Math.round(listMaxHeight)}px`);

    // Paso 4: Ahora leer el ancho real (getBoundingClientRect fuerza un reflow)
    const menuRect = menu.getBoundingClientRect();

    // Paso 5: Calcular posición horizontal dentro del viewport
    const canOpenToRight = triggerRect.left + menuRect.width <= viewportWidth - gutter;
    const canOpenToLeft  = triggerRect.right - menuRect.width >= gutter;
    const desiredLeft    = canOpenToRight
      ? triggerRect.left
      : (canOpenToLeft ? triggerRect.right - menuRect.width : triggerCenter - (menuRect.width / 2));
    const leftViewport = Math.max(gutter, Math.min(desiredLeft, viewportWidth - menuRect.width - gutter));

    // Paso 6: Calcular posición vertical dentro del viewport (nunca fuera de pantalla)
    const topViewport = renderAbove
      ? Math.max(gutter, triggerRect.top - clampedMenuH - gap)
      : Math.max(gutter, Math.min(belowTop, viewportHeight - clampedMenuH - gutter));

    // Paso 7: Convertir coords de viewport a coords relativas al host y aplicar
    const anchor = Math.max(18, Math.min(menuRect.width - 18, triggerCenter - leftViewport));

    menu.style.left = `${Math.round(leftViewport - hostRect.left)}px`;
    menu.style.top  = `${Math.round(topViewport  - hostRect.top)}px`;
    menu.style.zIndex = "48";
    menu.style.setProperty("--detail-col-menu-anchor", `${Math.round(anchor)}px`);
    menu.dataset.floatingState = "ready";
    menu.dataset.placement = renderAbove ? "top" : "bottom";
  });
}

function scheduleFloatingColumnMenuPosition() {
  if (!floatingColumnMenuState.entries.length) return;
  if (floatingColumnMenuState.rafId) return;
  floatingColumnMenuState.rafId = window.requestAnimationFrame(() => {
    floatingColumnMenuState.rafId = 0;
    positionFloatingColumnMenuEntries(floatingColumnMenuState.entries);
  });
}

function trackFloatingColumnMenus(entries = []) {
  clearFloatingColumnMenuTracking();
  floatingColumnMenuState.entries = entries.filter(entry => entry?.menu && entry?.trigger && entry?.host);
  if (!floatingColumnMenuState.entries.length) return;

  const onViewportChange = () => scheduleFloatingColumnMenuPosition();
  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("orientationchange", onViewportChange, { passive: true });

  let resizeObserver = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => scheduleFloatingColumnMenuPosition());
    floatingColumnMenuState.entries.forEach(({ menu, trigger, host }) => {
      resizeObserver.observe(menu);
      resizeObserver.observe(trigger);
      if (host && host !== document.body) resizeObserver.observe(host);
    });
  }

  floatingColumnMenuState.teardown = () => {
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("orientationchange", onViewportChange);
    resizeObserver?.disconnect();
  };

  scheduleFloatingColumnMenuPosition();
}

export function cleanupFloatingColumnMenus() {
  clearFloatingColumnMenuTracking();
  clearFloatingColumnMenuDismissHandlers();
  const layer = document.getElementById(DETAIL_COL_MENU_LAYER_ID);
  if (!layer) return;
  layer.replaceChildren();
}

export function positionOpenColumnMenus(target) {
  const { headNode, hostNode } = normalizeFloatingMenuContext(target);
  cleanupFloatingColumnMenus();
  if (!headNode) return;
  const menus = [...headNode.querySelectorAll("[data-col-menu]")];
  if (!menus.length) return;
  const host = hostNode || resolveFloatingMenuHost(headNode);
  const layer = getDetailColumnMenuLayer(host);
  const entries = menus.map(menu => {
    const key = menu.getAttribute("data-col-menu") || "";
    const trigger = headNode.querySelector(`[data-head-menu="${key}"]`);
    if (!trigger) return null;
    layer.appendChild(menu);
    return { key, menu, trigger, host };
  }).filter(Boolean);
  if (!entries.length) return;
  trackFloatingColumnMenus(entries);
}

export function bindHeaderInteractions(headNode, presentation, explorer = {}, onExplorerPatch, fmt) {
  if (!headNode || typeof onExplorerPatch !== "function") return;
  bindFloatingColumnMenuDismissHandlers(headNode, explorer, onExplorerPatch);

  headNode.querySelectorAll("[data-head-sort]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      const key = button.getAttribute("data-head-sort") || "";
      const nextStack = cycleSortStack(presentation.stack, key);
      const legacy = syncLegacySortFields(nextStack);
      onExplorerPatch({ ...legacy, sortStack: nextStack, openColumnMenu: "" });
    });
  });

  headNode.querySelectorAll("[data-head-menu]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.getAttribute("data-head-menu") || "";
      onExplorerPatch({ openColumnMenu: explorer?.openColumnMenu === key ? "" : key });
    });
  });

  headNode.querySelectorAll("[data-col-sort]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.getAttribute("data-col-key") || "";
      const direction = button.getAttribute("data-col-sort") === "asc" ? "asc" : "desc";
      const nextStack = [
        { key, direction },
        ...presentation.stack.filter(item => item.key !== key)
      ];
      const legacy = syncLegacySortFields(nextStack);
      onExplorerPatch({ ...legacy, sortStack: nextStack, openColumnMenu: key });
    });
  });

  headNode.querySelectorAll("[data-col-sort-clear]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.getAttribute("data-col-sort-clear") || "";
      const nextStack = presentation.stack.filter(item => item.key !== key);
      const legacy = syncLegacySortFields(nextStack);
      onExplorerPatch({ ...legacy, sortStack: nextStack, openColumnMenu: key });
    });
  });

  headNode.querySelectorAll("[data-col-filter-key]").forEach(input => {
    input.addEventListener("change", event => {
      event.stopPropagation();
    });
  });

  headNode.querySelectorAll("[data-col-filter-search]").forEach(input => {
    input.addEventListener("input", event => {
      event.stopPropagation();
      const key = input.getAttribute("data-col-filter-search") || "";
      const query = String(event.target.value || "").trim().toLowerCase();
      // Use closest menu ancestor so this works after the menu is moved to the floating layer
      const menuRoot = input.closest("[data-col-menu]") || headNode;
      menuRoot.querySelectorAll(`[data-col-option-item="${CSS.escape(key)}"]`).forEach(item => {
        const label = String(item.getAttribute("data-col-option-label") || "");
        item.hidden = query ? !label.includes(query) : false;
      });
    });
  });

  headNode.querySelectorAll("[data-col-filter-clear]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.getAttribute("data-col-filter-clear") || "";
      // Use closest menu ancestor so this works after the menu is moved to the floating layer
      const menuRoot = button.closest("[data-col-menu]") || headNode;
      menuRoot.querySelectorAll(`[data-col-filter-key="${CSS.escape(key)}"]`).forEach(input => {
        input.checked = false;
      });
    });
  });

  headNode.querySelectorAll("[data-col-filter-selectall]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.getAttribute("data-col-filter-selectall") || "";
      // Use closest menu ancestor so this works after the menu is moved to the floating layer
      const menuRoot = button.closest("[data-col-menu]") || headNode;
      menuRoot.querySelectorAll(`[data-col-filter-key="${CSS.escape(key)}"]`).forEach(input => {
        const item = input.closest("[data-col-option-item]");
        if (!item || !item.hidden) input.checked = true;
      });
    });
  });

  headNode.querySelectorAll("[data-col-filter-apply]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.getAttribute("data-col-filter-apply") || "";
      const current = { ...(explorer?.columnFilters || {}) };
      // Use closest menu ancestor so this works after the menu is moved to the floating layer
      const menuRoot = button.closest("[data-col-menu]") || headNode;
      const selected = [...menuRoot.querySelectorAll(`[data-col-filter-key="${CSS.escape(key)}"]:checked`)].map(input => input.getAttribute("data-col-filter-value") || "").filter(Boolean);
      if (selected.length) current[key] = [...new Set(selected)];
      else delete current[key];
      onExplorerPatch({ columnFilters: current, openColumnMenu: key });
      showToast(selected.length ? 'Filtro aplicado' : 'Filtro limpiado');
    });
  });

  headNode.querySelectorAll("[data-col-menu-close]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onExplorerPatch({ openColumnMenu: "" });
    });
  });
}

export function detailRowHtml(row, { escHtml, fmt }) {
  return `<tr>
    ${cell("Fecha", escHtml(row.Fecha))}
    ${cell("Cliente", escHtml(row.Cliente))}
    ${cell("Grupo", escHtml(row.Grupo_Familia))}
    ${cell("Cod. Producto", escHtml(row.Cod_Producto))}
    ${cell("Producto", escHtml(row.Producto_Desc))}
    ${cell("Kilos", fmt(row.Kilos), "num r")}
  </tr>`;
}

export function renderDetailTable({
  headNode,
  bodyNode,
  toolsNode,
  titleNode,
  badgeNode,
  noteNode,
  rows = [],
  total = 0,
  showSummary = false,
  detailLoading = false,
  pageSize = 200,
  onMore,
  onAll,
  explorer = {},
  onExplorerPatch,
  toolbarActions = {},
  onRowDrill,
  columnOptionsOverride = null,
  columnOptionsLoadingKey = "",
  fmt,
  escHtml
}) {
  if (!bodyNode) return;

  const safeTotal = Number(total || 0);
  if (badgeNode) {
    badgeNode.classList.toggle('is-updating', Boolean(detailLoading));
    badgeNode.textContent = showSummary
      ? (detailLoading ? 'Actualizando resumen...' : `${fmt(safeTotal)} filas resumen`)
      : 'Elegí período o filtros';
  }

  if (!showSummary) {
    cleanupFloatingColumnMenus();
    if (titleNode) titleNode.textContent = "Resumen filtrado";
    if (toolsNode) toolsNode.innerHTML = "";
    if (headNode) {
      headNode.innerHTML = `<tr><th>Fecha</th><th>Cliente</th><th>Grupo</th><th>Cod. Producto</th><th>Producto</th><th class="r">Kilos</th></tr>`;
    }
    bodyNode.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="eico">🎯</div><p>Elegí un período rápido (Este mes, 30d) o aplicá un filtro de coordinador o agente para ver el resumen.</p></div></td></tr>`;
    if (noteNode) noteNode.style.display = "none";
    return;
  }

  const presentationBase = buildDetailPresentation(rows, explorer, fmt);
  const presentationRows = presentationBase.rowModels
    .filter(rowModel => rowModel?.type === "data")
    .map(rowModel => rowModel.row || {})
    .filter(Boolean);
  const metricMeterKeys = presentationBase.view === "detalle"
    ? ["Kilos"]
    : (presentationBase.view === "cliente"
      ? ["Kilos", "Registros", "Productos", "Grupos", "Fechas"]
      : ["Kilos"]);
  const presentation = {
    ...presentationBase,
    columnOptions: { ...(presentationBase.columnOptions || {}), ...(columnOptionsOverride || {}) },
    columnOptionsLoadingKey: String(columnOptionsLoadingKey || ""),
    metricMeterKeys,
    numericScaleMap: buildNumericScaleMap(presentationRows, presentationBase.columns, { includeKeys: metricMeterKeys })
  };
  if (titleNode) titleNode.textContent = presentation.title;
  renderToolbar(toolsNode, presentation.explorer || explorer, presentation, fmt, onExplorerPatch, toolbarActions);

  if (headNode) {
    cleanupFloatingColumnMenus();
    headNode.innerHTML = `<tr>${presentation.columns.map((column, index) => renderHeaderCell(column, presentation, presentation.explorer || explorer, fmt, { index, totalColumns: presentation.columns.length })).join("")}</tr>`;
    bindHeaderInteractions(headNode, presentation, presentation.explorer || explorer, onExplorerPatch, fmt);
    positionOpenColumnMenus(headNode); // sync: no RAF delay for faster open
  }

  if (!presentation.rowModels.length) {
    if (detailLoading) {
      bodyNode.innerHTML = buildSkeletonRows(presentation.columns.length, 5);
    } else {
      const hasLocalRefinement = Boolean(String(presentation.explorer?.search || '').trim()) || Number(presentation.activeColumnFilterCount || 0) > 0;
      const emptyMessage = hasLocalRefinement
        ? 'Sin resultados dentro de la vista actual. Probá limpiar la búsqueda o los filtros de columna.'
        : (presentation.empty || 'Sin resultados para los filtros actuales. Probá ampliar el período o quitar algún filtro.');
      bodyNode.innerHTML = `<tr><td colspan="${presentation.columns.length}"><div class="empty"><div class="eico">🔍</div><p>${escapeHtml(emptyMessage)}</p></div></td></tr>`;
    }
  } else {
    const allModels = presentation.rowModels;
    const RENDER_CHUNK = 100;

    function bindTableInteractions(node) {
      node.querySelectorAll("[data-drill-key]").forEach(rowNode => {
        rowNode.addEventListener("click", event => {
          if (event.target.closest("button, a, input, label, select")) return;
          onRowDrill?.({
            key: rowNode.getAttribute("data-drill-key") || "",
            value: rowNode.getAttribute("data-drill-value") || "",
            label: rowNode.getAttribute("data-drill-label") || "",
            view: presentation.view
          });
        });
      });
      bindCopyCells(node);
    }

    if (allModels.length <= RENDER_CHUNK) {
      bodyNode.innerHTML = allModels.map(rowModel => renderBodyRow(rowModel, presentation, presentation.explorer || explorer, fmt, escHtml)).join("");
      bindTableInteractions(bodyNode);
    } else {
      bodyNode.innerHTML = buildSkeletonRows(presentation.columns.length, 5);
      let offset = 0;
      const renderNextChunk = () => {
        const slice = allModels.slice(offset, offset + RENDER_CHUNK);
        const html = slice.map(rowModel => renderBodyRow(rowModel, presentation, presentation.explorer || explorer, fmt, escHtml)).join("");
        if (offset === 0) {
          bodyNode.innerHTML = html;
        } else {
          bodyNode.insertAdjacentHTML("beforeend", html);
        }
        offset += RENDER_CHUNK;
        if (offset < allModels.length) {
          setTimeout(renderNextChunk, 0);
        } else {
          bindTableInteractions(bodyNode);
        }
      };
      setTimeout(renderNextChunk, 0);
    }
  }

  if (!noteNode) return;

  const remaining = safeTotal - rows.length;
  noteNode.style.display = "flex";
  if (detailLoading && !rows.length) {
    noteNode.innerHTML = `
      <div class="table-note-main">Actualizando resumen filtrado y preparando la tabla...</div>
      <div class="table-actions"></div>
    `;
    noteNode.classList.add("table-note");
    return;
  }
  noteNode.innerHTML = `
    <div class="table-note-main">Cargadas <strong>${fmt(rows.length)}</strong> de <strong>${fmt(safeTotal)}</strong> filas. Resumen local: <strong>${escapeHtml(presentation.visibleCountLabel || `${fmt(presentation.visibleCount)} filas visibles`)}</strong>. ${presentation.hiddenCount ? `Fuera del foco actual quedaron <strong>${fmt(presentation.hiddenCount)}</strong> ${escapeHtml(DETAIL_UNIT_LABELS[presentation.view] || 'filas')}. ` : ""}Subtotales, presets y filtros de encabezado trabajan sobre el contexto filtrado completo sin hidratar todo el detalle.</div>
    <div class="table-actions">
      ${remaining > 0 ? `<button id="btnMore" type="button" class="table-action-btn" ${detailLoading ? "disabled" : ""}>${detailLoading ? "Cargando..." : `+ Ver ${fmt(Math.min(pageSize, remaining))} mas`}</button>` : ""}
      ${remaining > 0 ? `<button id="btnAll" type="button" class="table-action-btn table-action-btn--accent" ${detailLoading ? "disabled" : ""}>${detailLoading ? "Cargando..." : `Ver todos (${fmt(safeTotal)})`}</button>` : ""}
    </div>
  `;
  noteNode.classList.add("table-note");

  noteNode.querySelector("#btnMore")?.addEventListener("click", () => {
    if (typeof onMore === "function") onMore();
  });
  noteNode.querySelector("#btnAll")?.addEventListener("click", () => {
    if (typeof onAll === "function") onAll();
  });
}

export function aggRows(entries = [], total = 0, { escHtml, fmt, palette }) {
  const maxKilos = Number(entries?.[0]?.kilos || 0) || 1;
  return entries.map((item, index) => {
    const kilos = Number(item.kilos || 0);
    const pct = total > 0 ? ((kilos / total) * 100).toFixed(1) : "0.0";
    const width = ((kilos / maxKilos) * 100).toFixed(0);

    return `<tr>
      ${cell("#", index + 1, "acum-rank")}
      ${cell("Nombre", clipText(escHtml(item.name), escHtml(item.name)))}
      ${cell("Kilos", fmt(kilos), "r num")}
      ${cell("%", `${pct}%`, "r")}
      ${cell("Dist.", `<div class="mini-bar-track"><div class="mini-bar" style="width:${width}%;background:${palette[index % palette.length]}"></div></div>`, "acum-bar-cell")}
    </tr>`;
  }).join("");
}

export function clientAcumRows(entries = [], total = 0, { escHtml, fmt, palette }) {
  const maxKilos = Number(entries?.[0]?.kilos || 0) || 1;
  return entries.slice(0, 20).map((item, index) => {
    const kilos = Number(item.kilos || 0);
    const pct = total > 0 ? ((kilos / total) * 100).toFixed(1) : "0.0";
    const width = ((kilos / maxKilos) * 100).toFixed(0);

    return `<tr>
      ${cell("#", index + 1, "acum-rank")}
      ${cell("Cliente", clipText(escHtml(item.nombre), escHtml(item.nombre)))}
      ${cell("Coord.", clipText(`<span class="td-clip__muted">${escHtml(item.coordinador)}</span>`, escHtml(item.coordinador), "td-clip--muted"))}
      ${cell("Agente", clipText(`<span class="td-clip__muted">${escHtml(item.agente)}</span>`, escHtml(item.agente), "td-clip--muted"))}
      ${cell("Kilos", fmt(kilos), "r num")}
      ${cell("%", `${pct}%`, "r")}
      ${cell("Dist.", `<div class="mini-bar-track"><div class="mini-bar" style="width:${width}%;background:${palette[index % palette.length]}"></div></div>`, "acum-bar-cell")}
    </tr>`;
  }).join("");
}

function ensureAccumulatedMobilePreset(table, tbody, layoutKey) {
  if (typeof window === "undefined" || !table || !tbody) return;
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 767px)").matches;
  if (!isMobile) return;

  const widthMap = {
    coord: ["6%", "35%", "24%", "10%", "25%"],
    agent: ["6%", "35%", "24%", "10%", "25%"],
    group: ["6%", "35%", "24%", "10%", "25%"],
    brand: ["6%", "35%", "24%", "10%", "25%"],
    "client-top20": ["5%", "22%", "10%", "15%", "20%", "8%", "20%"]
  };
  const widths = widthMap[layoutKey];
  if (!widths || !table.tHead) return;

  let colgroup = table.querySelector('colgroup[data-mobile-colgroup="true"]');
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    colgroup.setAttribute("data-mobile-colgroup", "true");
    table.insertBefore(colgroup, table.firstChild);
  }
  colgroup.innerHTML = widths.map(width => `<col style="width:${width}">`).join("");

  table.style.width = "100%";
  table.style.minWidth = "100%";
  table.style.maxWidth = "100%";
  table.style.tableLayout = "fixed";

  table.tHead.style.display = "table-header-group";
  tbody.style.display = "table-row-group";
  Array.from(table.tHead.rows || []).forEach(row => { row.style.display = "table-row"; });
  Array.from(tbody.rows || []).forEach(row => {
    row.style.display = "table-row";
    Array.from(row.cells || []).forEach((cellNode, index) => {
      cellNode.style.display = "table-cell";
      cellNode.style.whiteSpace = "nowrap";
      cellNode.style.overflow = "hidden";
      cellNode.style.textOverflow = "ellipsis";
      cellNode.style.verticalAlign = "middle";
      if (layoutKey === "client-top20") {
        cellNode.style.paddingLeft = index === 0 ? "4px" : "3px";
        cellNode.style.paddingRight = index === 0 ? "2px" : "3px";
      }
    });
  });
  Array.from(table.tHead.querySelectorAll("th")).forEach((th, index) => {
    th.style.display = "table-cell";
    th.style.whiteSpace = "nowrap";
    th.style.overflow = "hidden";
    th.style.textOverflow = "ellipsis";
    if (layoutKey === "client-top20") {
      th.style.paddingLeft = index === 0 ? "4px" : "3px";
      th.style.paddingRight = index === 0 ? "2px" : "3px";
    }
  });
}

function bindAccumulatedMobileLayout(el, tbodyId, layoutKey) {
  const tbody = el(tbodyId);
  if (!tbody) return null;
  const table = tbody.closest("table");
  const wrap = tbody.closest(".tw");
  if (table) {
    table.dataset.mobileLayout = layoutKey;
    table.classList.add(`acum-mobile-${layoutKey}`);
  }
  if (wrap) {
    wrap.dataset.mobileLayout = layoutKey;
    wrap.classList.add(`acum-wrap-${layoutKey}`);
  }
  const applyPreset = () => {
    if (!table) return;
    ensureAccumulatedMobilePreset(table, tbody, layoutKey);
  };
  if (typeof queueMicrotask === "function") queueMicrotask(applyPreset);
  else setTimeout(applyPreset, 0);
  return tbody;
}

export function renderAccumulatedTables({
  dashboardState,
  emptyDashboardState,
  setKPIBlock,
  setText,
  el,
  fmt,
  escHtml,
  palette
}) {
  const kpis = dashboardState.kpis || emptyDashboardState().kpis;
  setKPIBlock(kpis, "a");

  const total = Number(kpis.kilos || 0);
  const empty5 = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--mut);font-size:12px">Sin datos</td></tr>`;
  const empty6 = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--mut);font-size:12px">Sin datos</td></tr>`;
  const rowsConfig = [
    ["at-coord", "ab1", dashboardState.rankings.coordinadores || []],
    ["at-agte", "ab2", dashboardState.rankings.agentes || []],
    ["at-grp", "ab3", dashboardState.rankings.grupos || []],
    ["at-mrc", "ab4", dashboardState.rankings.marcas || []]
  ];

  rowsConfig.forEach(([tbodyId, badgeId, entries]) => {
    setText(badgeId, entries.length);
    const layoutMap = {
      "at-coord": "coord",
      "at-agte": "agent",
      "at-grp": "group",
      "at-mrc": "brand"
    };
    const tbody = bindAccumulatedMobileLayout(el, tbodyId, layoutMap[tbodyId] || tbodyId);
    if (!tbody) return;
    tbody.innerHTML = entries.length ? aggRows(entries, total, { escHtml, fmt, palette }) : empty5;
  });

  const clientes = dashboardState.rankings.clientes || [];
  setText("ab5", clientes.length);
  const tbodyClientes = bindAccumulatedMobileLayout(el, "at-clie", "client-top20");
  if (tbodyClientes) {
    tbodyClientes.innerHTML = clientes.length ? clientAcumRows(clientes, total, { escHtml, fmt, palette }) : empty6;
  }
}
