// ─── Helpers privados ─────────────────────────────────────────────────────────

function normText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeColumnFilterValue(value, column) {
  if (column?.type === "number") return String(Number(value || 0));
  return String(value ?? "");
}

function formatFilterValue(value, column, fmt) {
  if (column?.type === "number") return fmt(Number(value || 0));
  return String(value ?? "").trim() || "(vacio)";
}

function compareText(left, right, direction = "asc") {
  const a = normText(left);
  const b = normText(right);
  if (a === b) return 0;
  return direction === "asc" ? (a > b ? 1 : -1) : (a > b ? -1 : 1);
}

export function compareNumber(left, right, direction = "desc") {
  const a = Number(left || 0);
  const b = Number(right || 0);
  if (a === b) return 0;
  return direction === "asc" ? a - b : b - a;
}

function compareDate(left, right, direction = "desc") {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) return 0;
  return direction === "asc" ? (a > b ? 1 : -1) : (a > b ? -1 : 1);
}

export function compareByColumn(rowA, rowB, column, direction = "asc") {
  if (!column) return 0;
  if (column.type === "number") return compareNumber(rowA?.[column.key], rowB?.[column.key], direction);
  if (column.type === "date") return compareDate(rowA?.[column.key], rowB?.[column.key], direction);
  return compareText(rowA?.[column.key], rowB?.[column.key], direction);
}

// ─── Exports públicos ──────────────────────────────────────────────────────────

export function normalizeSortStack(explorer = {}, columns = [], fallback = []) {
  const valid = new Map(columns.map(column => [column.key, column]));
  const stack = [];
  const rawStack = Array.isArray(explorer.sortStack) ? explorer.sortStack : [];

  rawStack.forEach(item => {
    const key = String(item?.key || "");
    if (!valid.has(key)) return;
    const direction = item?.direction === "asc" ? "asc" : "desc";
    if (stack.some(existing => existing.key === key)) return;
    stack.push({ key, direction });
  });

  if (!stack.length) {
    const legacyKey = String(explorer.sort || "");
    if (legacyKey && legacyKey !== "default" && valid.has(legacyKey)) {
      stack.push({ key: legacyKey, direction: explorer.direction === "asc" ? "asc" : "desc" });
    }
  }

  if (!stack.length) {
    fallback.forEach(item => {
      const key = String(item?.key || "");
      if (!valid.has(key)) return;
      if (stack.some(existing => existing.key === key)) return;
      stack.push({ key, direction: item?.direction === "asc" ? "asc" : "desc" });
    });
  }

  return stack;
}

export function filterRowsBySearch(rows = [], searchTerm = "") {
  const search = normText(searchTerm);
  if (!search) return rows.slice();
  return rows.filter(row => Object.values(row).some(value => normText(value).includes(search)));
}

export function applyColumnFilters(rows = [], columns = [], explorer = {}) {
  const columnFilters = explorer?.columnFilters && typeof explorer.columnFilters === "object" ? explorer.columnFilters : {};
  const activeEntries = Object.entries(columnFilters)
    .map(([key, values]) => [key, Array.isArray(values) ? values.filter(value => value !== null && value !== undefined && value !== "") : []])
    .filter(([, values]) => values.length);

  if (!activeEntries.length) return rows.slice();
  const columnMap = new Map(columns.map(column => [column.key, column]));

  return rows.filter(row => activeEntries.every(([key, values]) => {
    const column = columnMap.get(key);
    if (!column) return true;
    const current = normalizeColumnFilterValue(row?.[key], column);
    return values.map(value => normalizeColumnFilterValue(value, column)).includes(current);
  }));
}

export function buildSearchPreview(rows = [], searchTerm = "", config = {}) {
  const q = String(searchTerm || "").trim();
  if (!q) return { totalMatches: rows.length, items: [] };

  const normalizedQuery = normText(q);
  const itemsMap = new Map();
  const fieldsConfig = Array.isArray(config.fields) && config.fields.length
    ? config.fields
    : [
        ["Cliente", row => row.Cliente, "Cliente"],
        ["Grupo", row => row.Grupo_Familia, "Grupo_Familia"],
        ["Producto", row => row.Producto_Desc, "Producto_Desc"],
        ["Codigo", row => row.Cod_Producto, "Cod_Producto"],
        ["Fecha", row => row.Fecha, "Fecha"]
      ];
  const titleResolver = typeof config.titleResolver === "function"
    ? config.titleResolver
    : row => row.Cliente || row.Producto_Desc || row.Grupo_Familia || row.Cod_Producto || row.Fecha || "Resultado";
  const kilosResolver = typeof config.kilosResolver === "function"
    ? config.kilosResolver
    : row => Number(row.Kilos || 0);
  const limit = Number.isFinite(Number(config.limit)) ? Math.max(1, Number(config.limit)) : 5;

  for (const row of rows) {
    const title = String(titleResolver(row) || "Resultado").trim() || "Resultado";
    const kilos = Number(kilosResolver(row) || 0);
    const normalizedTitle = normText(title);
    const fields = fieldsConfig.map(entry => {
      if (Array.isArray(entry)) {
        return {
          label: entry[0],
          value: typeof entry[1] === "function" ? entry[1](row) : row?.[entry[1]],
          key: entry[2] || ""
        };
      }
      return {
        label: entry?.label || entry?.key || "Campo",
        value: typeof entry?.get === "function" ? entry.get(row) : row?.[entry?.key],
        key: entry?.key || ""
      };
    });

    const matchedField = fields.find(field => normText(field?.value).includes(normalizedQuery));
    if (!matchedField) continue;

    const rawValue = String(matchedField.value ?? "").trim() || title;
    const mapKey = `${matchedField.label}::${normText(rawValue)}`;
    const existing = itemsMap.get(mapKey) || {
      title,
      matchedLabel: matchedField.label,
      matchedValue: rawValue,
      searchValue: rawValue,
      columnKey: matchedField.key || "",
      kilos: 0,
      matchCount: 0,
      hint: normalizedTitle !== normText(rawValue) ? title : ""
    };
    existing.kilos += kilos;
    existing.matchCount += 1;
    if (!existing.hint && normalizedTitle !== normText(rawValue)) existing.hint = title;
    itemsMap.set(mapKey, existing);
  }

  const items = [...itemsMap.values()]
    .sort((left, right) => {
      const countDiff = Number(right.matchCount || 0) - Number(left.matchCount || 0);
      if (countDiff !== 0) return countDiff;
      const kilosDiff = Number(right.kilos || 0) - Number(left.kilos || 0);
      if (kilosDiff !== 0) return kilosDiff;
      return String(left.matchedValue || "").localeCompare(String(right.matchedValue || ""), "es");
    })
    .slice(0, limit);

  return {
    totalMatches: rows.length,
    items
  };
}

export function sortRows(rows = [], columns = [], stack = []) {
  const columnMap = new Map(columns.map(column => [column.key, column]));
  const next = rows.slice();
  next.sort((left, right) => {
    for (const item of stack) {
      const column = columnMap.get(item.key);
      const diff = compareByColumn(left, right, column, item.direction);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return next;
}

export function buildColumnOptions(rows = [], columns = [], explorer = {}, fmt) {
  const options = {};
  const activeFilters = explorer?.columnFilters && typeof explorer.columnFilters === "object" ? explorer.columnFilters : {};

  columns.forEach(column => {
    const relaxedFilters = { ...activeFilters };
    delete relaxedFilters[column.key];
    const baseRows = applyColumnFilters(rows, columns, { columnFilters: relaxedFilters });
    const values = new Map();
    baseRows.forEach(row => {
      const raw = normalizeColumnFilterValue(row?.[column.key], column);
      if (!values.has(raw)) values.set(raw, formatFilterValue(row?.[column.key], column, fmt));
    });
    const sorted = [...values.entries()].sort((left, right) => {
      if (column.type === "number") return compareNumber(left[0], right[0], "desc");
      if (column.type === "date") return compareDate(left[0], right[0], "desc");
      return compareText(left[1], right[1], "asc");
    }).map(([value, label]) => ({ value, label }));
    options[column.key] = sorted;
  });

  return options;
}

export function syncLegacySortFields(stack = []) {
  if (!stack.length) return { sort: "default", direction: "desc" };
  return {
    sort: stack[0].key,
    direction: stack[0].direction === "asc" ? "asc" : "desc"
  };
}
