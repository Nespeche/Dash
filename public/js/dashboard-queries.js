export function buildStateQueryString({
  periodo = {},
  filtros = {},
  includeDetail = false,
  detailGroups = [],
  getSelectedProducts,
  localeEs
} = {}) {
  const qs = new URLSearchParams();
  if (periodo.desde) qs.set("desde", periodo.desde);
  if (periodo.hasta) qs.set("hasta", periodo.hasta);
  if (filtros.coordinador) qs.set("coordinador", filtros.coordinador);
  if (filtros.agente) qs.set("agente", filtros.agente);
  if (filtros.cliente) qs.set("cliente", filtros.cliente);
  if (filtros.grupo) qs.set("grupo", filtros.grupo);
  if (filtros.marca) qs.set("marca", filtros.marca);
  if (includeDetail) qs.set("includeDetail", "1");

  for (const group of [...new Set((detailGroups || []).map(v => String(v || '').trim()).filter(Boolean))].sort((a, b) => localeEs(a, b))) {
    qs.append("detailGroup", group);
  }

  const selectedProducts = typeof getSelectedProducts === "function"
    ? getSelectedProducts()
    : Array.isArray(filtros.codProd) ? filtros.codProd.filter(Boolean) : [];

  for (const codigo of [...selectedProducts].sort((a, b) => localeEs(a, b))) {
    qs.append("codProd", codigo);
  }
  return qs.toString();
}

function appendDetailColumnFilters(qs, columnFilters = {}, localeEs = (a, b) => String(a).localeCompare(String(b)), { excludeKey = "" } = {}) {
  const entries = Object.entries(columnFilters || {})
    .map(([key, values]) => [String(key || ""), Array.isArray(values) ? [...new Set(values.map(value => String(value ?? "")).filter(value => value !== ""))] : []])
    .filter(([key, values]) => key && values.length && key !== excludeKey);

  entries.sort((a, b) => localeEs(a[0], b[0]));
  entries.forEach(([key, values]) => {
    values.sort((a, b) => localeEs(a, b)).forEach(value => qs.append(`xf_${key}`, value));
  });

  return qs;
}

export function buildDetailQueryString({
  periodo,
  filtros,
  detailGroups = [],
  offset = 0,
  limit,
  columnFilters = {},
  getSelectedProducts,
  localeEs
} = {}) {
  const qs = new URLSearchParams(buildStateQueryString({ periodo, filtros, detailGroups, getSelectedProducts, localeEs }));
  appendDetailColumnFilters(qs, columnFilters, localeEs);
  qs.set("offset", String(offset));
  qs.set("limit", String(limit));
  return qs.toString();
}

export function buildDetailOptionsQueryString({
  periodo,
  filtros,
  detailGroups = [],
  column = "",
  columnFilters = {},
  getSelectedProducts,
  localeEs
} = {}) {
  const qs = new URLSearchParams(buildStateQueryString({ periodo, filtros, detailGroups, getSelectedProducts, localeEs }));
  if (column) qs.set("column", String(column));
  appendDetailColumnFilters(qs, columnFilters, localeEs, { excludeKey: String(column || "") });
  return qs.toString();
}


export function buildCatalogScopeKey({
  periodo = {},
  filtros = {},
  kind = "clientes"
} = {}) {
  const qs = new URLSearchParams();
  if (periodo.desde) qs.set("desde", periodo.desde);
  if (periodo.hasta) qs.set("hasta", periodo.hasta);
  if (filtros.coordinador) qs.set("coordinador", filtros.coordinador);
  if (filtros.agente) qs.set("agente", filtros.agente);
  if (kind === "productos") {
    if (filtros.cliente) qs.set("cliente", filtros.cliente);
    if (filtros.grupo) qs.set("grupo", filtros.grupo);
    if (filtros.marca) qs.set("marca", filtros.marca);
  }
  return qs.toString();
}

export function buildInsightsQueryString({ periodo, filtros, getSelectedProducts, localeEs } = {}) {
  return buildStateQueryString({ periodo, filtros, getSelectedProducts, localeEs });
}

export function daysInMonthLocal(year, month) {
  return new Date(year, month, 0).getDate();
}

export function monthRangeLocal(year, month) {
  return {
    desde: `${year}-${String(month).padStart(2, "0")}-01`,
    hasta: `${year}-${String(month).padStart(2, "0")}-${String(daysInMonthLocal(year, month)).padStart(2, "0")}`
  };
}

export function projectionIsoFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function shiftProjectionIsoToCompareYear(isoDate, compareYear, anchorYear, { parseIsoDateParts } = {}) {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return "";
  const targetYear = Number(compareYear) + (Number(parts.year) - Number(anchorYear));
  const safeDay = Math.min(parts.day, daysInMonthLocal(targetYear, parts.month));
  return projectionIsoFromParts(targetYear, parts.month, safeDay);
}

export function isProjectionFullMonthRange(desdeIso, hastaIso, { parseIsoDateParts } = {}) {
  const desde = parseIsoDateParts(desdeIso);
  const hasta = parseIsoDateParts(hastaIso);
  if (!desde || !hasta) return false;
  if (desde.day !== 1) return false;
  return hasta.day === daysInMonthLocal(hasta.year, hasta.month);
}

export function formatProjectionPeriodLabel(desdeIso, hastaIso, { parseIsoDateParts, monthNameEs } = {}) {
  const desde = parseIsoDateParts(desdeIso);
  const hasta = parseIsoDateParts(hastaIso);
  if (!desde || !hasta) return "";

  const fullMonthRange = isProjectionFullMonthRange(desdeIso, hastaIso, { parseIsoDateParts });
  if (fullMonthRange && desde.year === hasta.year && desde.month === hasta.month) {
    return `${monthNameEs(desde.month)} ${desde.year}`;
  }
  if (fullMonthRange && desde.year === hasta.year) {
    return `${monthNameEs(desde.month)}-${monthNameEs(hasta.month)} ${desde.year}`;
  }
  if (fullMonthRange) {
    return `${monthNameEs(desde.month)} ${desde.year}-${monthNameEs(hasta.month)} ${hasta.year}`;
  }
  if (desde.year === hasta.year && desde.month === hasta.month) {
    return `${desde.day}-${hasta.day} ${monthNameEs(desde.month)} ${desde.year}`;
  }
  if (desde.year === hasta.year) {
    return `${desde.day} ${monthNameEs(desde.month)}-${hasta.day} ${monthNameEs(hasta.month)} ${desde.year}`;
  }
  return `${desde.day} ${monthNameEs(desde.month)} ${desde.year}-${hasta.day} ${monthNameEs(hasta.month)} ${hasta.year}`;
}

export function buildProjectionCompareContext({ periodo = {}, toISO, parseIsoDateParts, monthNameEs } = {}) {
  const todayIso = toISO(new Date());
  const today = parseIsoDateParts(todayIso);
  const desde = parseIsoDateParts(periodo.desde);
  const hasta = parseIsoDateParts(periodo.hasta);

  const ref = hasta || desde || today;
  if (!ref) {
    return {
      valid: false,
      reason: "missing",
      mode: "month",
      currentLabel: "",
      compareLabel: "",
      message: "No se pudo determinar el período a comparar."
    };
  }

  let currentDesde = periodo.desde;
  let currentHasta = periodo.hasta;
  if (!(desde && hasta)) {
    const fallbackRange = monthRangeLocal(ref.year, ref.month);
    currentDesde = currentDesde || fallbackRange.desde;
    currentHasta = currentHasta || fallbackRange.hasta;
  }

  const currentDesdeParts = parseIsoDateParts(currentDesde);
  const currentHastaParts = parseIsoDateParts(currentHasta);
  if (!currentDesdeParts || !currentHastaParts) {
    return {
      valid: false,
      reason: "missing",
      mode: "month",
      currentLabel: "",
      compareLabel: "",
      message: "No se pudo determinar el período a comparar."
    };
  }

  const currentRangeKey = Number(`${currentDesdeParts.year}${String(currentDesdeParts.month).padStart(2, "0")}${String(currentDesdeParts.day).padStart(2, "0")}`);
  const currentEndKey = Number(`${currentHastaParts.year}${String(currentHastaParts.month).padStart(2, "0")}${String(currentHastaParts.day).padStart(2, "0")}`);
  if (currentRangeKey > currentEndKey) {
    return {
      valid: false,
      reason: "invalid-range",
      mode: "range",
      currentLabel: "",
      compareLabel: "",
      message: "El rango de fechas seleccionado no es válido."
    };
  }

  const compareYear = 2025;
  const compareDesde = shiftProjectionIsoToCompareYear(currentDesde, compareYear, currentDesdeParts.year, { parseIsoDateParts });
  const compareHasta = shiftProjectionIsoToCompareYear(currentHasta, compareYear, currentDesdeParts.year, { parseIsoDateParts });
  const isSingleFullMonth = isProjectionFullMonthRange(currentDesde, currentHasta, { parseIsoDateParts })
    && currentDesdeParts.year === currentHastaParts.year
    && currentDesdeParts.month === currentHastaParts.month;

  return {
    valid: true,
    mode: isSingleFullMonth ? "month" : "range",
    currentYear: currentHastaParts.year,
    currentMonth: currentHastaParts.month,
    currentDesde,
    currentHasta,
    compareYear,
    compareMonth: currentDesdeParts.month,
    compareDesde,
    compareHasta,
    currentLabel: formatProjectionPeriodLabel(currentDesde, currentHasta, { parseIsoDateParts, monthNameEs }),
    compareLabel: formatProjectionPeriodLabel(compareDesde, compareHasta, { parseIsoDateParts, monthNameEs })
  };
}

export function normalizeProjectionGroupSelection(values) {
  return [...new Set((values || []).map(v => String(v || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

export function buildProjectionCompareQueryString({
  context,
  periodo,
  filtros,
  getSelectedProducts,
  localeEs,
  projectionGroups = []
} = {}) {
  const qs = new URLSearchParams(buildStateQueryString({ periodo, filtros, getSelectedProducts, localeEs }));
  qs.set("compareYear", String(context.compareYear));
  qs.set("compareMonth", String(context.compareMonth));
  qs.set("compareDesde", String(context.compareDesde || ""));
  qs.set("compareHasta", String(context.compareHasta || ""));
  qs.set("compareMode", String(context.mode || "month"));
  for (const groupName of normalizeProjectionGroupSelection(projectionGroups)) {
    qs.append("projGroup", groupName);
  }
  return qs.toString();
}

export function buildProjectionDetailBaseQueryString({
  context,
  periodo,
  filtros,
  getSelectedProducts,
  localeEs,
  projectionGroups = []
} = {}) {
  const groups = normalizeProjectionGroupSelection(projectionGroups);
  const qs = new URLSearchParams(buildProjectionCompareQueryString({
    context,
    periodo,
    filtros,
    getSelectedProducts,
    localeEs,
    projectionGroups: groups
  }));
  qs.set("detailView", groups.length ? "detail" : "summary");
  groups.forEach(group => qs.append("detailGroup", group));
  return qs.toString();
}

export function buildProjectionDetailQueryString({
  context,
  periodo,
  filtros,
  getSelectedProducts,
  localeEs,
  projectionGroups = [],
  offset = 0,
  limit
} = {}) {
  const qs = new URLSearchParams(buildProjectionDetailBaseQueryString({
    context,
    periodo,
    filtros,
    getSelectedProducts,
    localeEs,
    projectionGroups
  }));
  qs.set("offset", String(offset));
  qs.set("limit", String(limit));
  return qs.toString();
}
