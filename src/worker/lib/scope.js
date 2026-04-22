import { getCurrentYearMonthKeys, getExactYearMonthKey, yearMonthKey } from "./dates.js";
import { hasBusinessFilter, hasProjectionGroupFilter, hasDateFilter } from "./filters.js";

export function canUseMaterializedScope(runtime, f) {
  return Boolean(runtime?.hasScopeCatalogo && !hasDateFilter(f));
}

export function isGlobalStateFastPath(runtime, f) {
  return Boolean(
    canUseMaterializedScope(runtime, f) &&
    !hasBusinessFilter(f) &&
    runtime?.hasAgentesCatalogo &&
    runtime?.hasClientesCatalogo &&
    runtime?.hasProductosCatalogo &&
    runtime?.hasStateSnapshotGlobal &&
    runtime?.hasRankingGruposGlobal
  );
}

export function isMonthStateFastPath(runtime, f) {
  return Boolean(
    getExactYearMonthKey(f) &&
    !hasBusinessFilter(f) &&
    runtime?.hasStateOptionsMonthGlobal &&
    runtime?.hasStateSnapshotMonth &&
    runtime?.hasRankingGruposMonth
  );
}

export function isMonthInsightsFastPath(runtime, f) {
  return Boolean(
    getExactYearMonthKey(f) &&
    !hasBusinessFilter(f) &&
    runtime?.hasInsightsRankingsMonth &&
    runtime?.hasStateSnapshotMonth
  );
}

export function hasCompactVentasMesScope(runtime) {
  return Boolean(runtime?.hasVentasMesScope && runtime?.hasVentasScopeDim);
}

export function hasSingleCurrentMonthSnapshot(runtime, f) {
  return Boolean(runtime?.hasStateSnapshotMonth && getExactYearMonthKey(f) && !hasBusinessFilter(f) && !hasProjectionGroupFilter(f));
}

export function canUseCurrentMonthScope(runtime, f) {
  const yearMonthKeys = getCurrentYearMonthKeys(f);
  return Boolean(runtime?.hasVentas && Array.isArray(yearMonthKeys) && yearMonthKeys.length);
}

export function hasCompactVentasDiaScope(runtime) {
  return Boolean(runtime?.hasVentasDiaScope && runtime?.hasVentasScopeDim);
}

export function canUseCurrentDayScope(runtime, f) {
  return Boolean(hasCompactVentasDiaScope(runtime) && f?.desde && f?.hasta);
}

export function canUseCurrentPeriodScope(runtime, f) {
  const yearMonthKeys = getCurrentYearMonthKeys(f);
  const fullMonthRange = Array.isArray(yearMonthKeys) && yearMonthKeys.length;
  if (fullMonthRange) {
    return Boolean(hasCompactVentasMesScope(runtime) || canUseCurrentDayScope(runtime, f));
  }
  return Boolean(canUseCurrentDayScope(runtime, f));
}

const BUSINESS_COLUMN_MAP_DEFAULT = {
  coordinador: "Coordinador",
  agente: "Cod_Agente",
  cliente: "Cod_Cliente",
  grupo: "Grupo_Familia",
  marca: "Marca",
  codProd: "Cod_Producto",
  region: "Region"
};

export function buildBusinessWhere(f, dims = [], columns = BUSINESS_COLUMN_MAP_DEFAULT) {
  const where = [];
  const params = [];
  if (dims.includes("coordinador") && f.coordinador) { where.push(`${columns.coordinador || BUSINESS_COLUMN_MAP_DEFAULT.coordinador} = ?`); params.push(f.coordinador); }
  if (dims.includes("agente") && f.agente) { where.push(`${columns.agente || BUSINESS_COLUMN_MAP_DEFAULT.agente} = ?`); params.push(f.agente); }
  if (dims.includes("cliente") && f.cliente) { where.push(`${columns.cliente || BUSINESS_COLUMN_MAP_DEFAULT.cliente} = ?`); params.push(f.cliente); }
  if (dims.includes("grupo") && f.grupo) { where.push(`${columns.grupo || BUSINESS_COLUMN_MAP_DEFAULT.grupo} = ?`); params.push(f.grupo); }
  if (dims.includes("projGroups") && Array.isArray(f.projGroups) && f.projGroups.length) {
    const groupColumn = columns.grupo || BUSINESS_COLUMN_MAP_DEFAULT.grupo;
    where.push(`${groupColumn} IN (${f.projGroups.map(() => "?").join(",")})`);
    params.push(...f.projGroups);
  }
  if (dims.includes("detailGroups") && Array.isArray(f.detailGroups) && f.detailGroups.length) {
    const groupColumn = columns.grupo || BUSINESS_COLUMN_MAP_DEFAULT.grupo;
    where.push(`${groupColumn} IN (${f.detailGroups.map(() => "?").join(",")})`);
    params.push(...f.detailGroups);
  }
  if (dims.includes("marca") && f.marca) { where.push(`${columns.marca || BUSINESS_COLUMN_MAP_DEFAULT.marca} = ?`); params.push(f.marca); }
  if (dims.includes("region") && f.region) { where.push(`${columns.region || BUSINESS_COLUMN_MAP_DEFAULT.region} = ?`); params.push(f.region); }
  if (dims.includes("codProd") && Array.isArray(f.codProd) && f.codProd.length) {
    where.push(`${columns.codProd || BUSINESS_COLUMN_MAP_DEFAULT.codProd} IN (${f.codProd.map(() => "?").join(",")})`);
    params.push(...f.codProd);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export function buildCurrentDaySource(runtime, f, dims = [], { factAlias = "d", dimAlias = `${factAlias}_scope` } = {}) {
  const compact = hasCompactVentasDiaScope(runtime);
  const fromSql = compact
    ? `FROM ventas_dia_scope ${factAlias} INNER JOIN ventas_scope_dim ${dimAlias} ON ${dimAlias}.scope_id = ${factAlias}.scope_id`
    : `FROM ventas_dia_scope ${factAlias}`;
  const columns = compact
    ? {
        fecha: `${factAlias}.Fecha`,
        yearMonth: `${factAlias}.YearMonth`,
        coordinador: `${dimAlias}.Coordinador`,
        agente: `${dimAlias}.Cod_Agente`,
        cliente: `${dimAlias}.Cod_Cliente`,
        grupo: `${dimAlias}.Grupo_Familia`,
        marca: `${dimAlias}.Marca`,
        codProd: `${dimAlias}.Cod_Producto`,
        registros: `${factAlias}.Registros`,
        kilos: `${factAlias}.Kilos`
      }
    : {
        fecha: `${factAlias}.Fecha`,
        yearMonth: `${factAlias}.YearMonth`,
        coordinador: `${factAlias}.Coordinador`,
        agente: `${factAlias}.Cod_Agente`,
        cliente: `${factAlias}.Cod_Cliente`,
        grupo: `${factAlias}.Grupo_Familia`,
        marca: `${factAlias}.Marca`,
        codProd: `${factAlias}.Cod_Producto`,
        registros: `${factAlias}.Registros`,
        kilos: `${factAlias}.Kilos`
      };
  const where = [];
  const params = [];
  if (f?.desde) { where.push(`${factAlias}.Fecha >= ?`); params.push(f.desde); }
  if (f?.hasta) { where.push(`${factAlias}.Fecha <= ?`); params.push(f.hasta); }
  const business = buildBusinessWhere(f, dims, columns);
  if (business.sql) {
    where.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }
  return {
    compact,
    factAlias,
    dimAlias,
    columns,
    fromSql,
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    sourceLabel: compact ? "ventas_dia_scope+ventas_scope_dim" : "ventas_dia_scope"
  };
}

function buildRawVentasSource(f, dims = [], { factAlias = "v", dimAlias = `${factAlias}_scope` } = {}) {
  const columns = {
    fecha: `${factAlias}.Fecha`,
    yearMonth: `substr(${factAlias}.Fecha, 1, 7)`,
    coordinador: `${factAlias}.Coordinador`,
    agente: `${factAlias}.Cod_Agente`,
    cliente: `${factAlias}.Cod_Cliente`,
    grupo: `${factAlias}.Grupo_Familia`,
    marca: `${factAlias}.Marca`,
    codProd: `${factAlias}.Cod_Producto`,
    registros: "1",
    kilos: `${factAlias}.Kilos`
  };
  const where = [];
  const params = [];
  if (f?.desde) { where.push(`${factAlias}.Fecha >= ?`); params.push(f.desde); }
  if (f?.hasta) { where.push(`${factAlias}.Fecha <= ?`); params.push(f.hasta); }
  const business = buildBusinessWhere(f, dims, columns);
  if (business.sql) {
    where.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }
  return {
    compact: false,
    factAlias,
    dimAlias,
    columns,
    fromSql: `FROM ventas ${factAlias}`,
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    sourceLabel: "ventas"
  };
}

export function hasCompactVentas2025MesScope(runtime) {
  return Boolean(runtime?.hasVentas2025MesScope && runtime?.hasVentas2025ScopeDim);
}

export function hasNormalizedVentas2025MesScope(runtime) {
  return Boolean(
    runtime?.hasVentas2025ClientesCatalogo &&
    runtime?.hasVentas2025ProductosCatalogo
  );
}

export function hasHistoricalSnapshotMonth(runtime) {
  return Boolean(runtime?.hasVentas2025SnapshotMonth);
}

export function buildCurrentMonthSource(runtime, f, dims = [], { factAlias = "m", dimAlias = `${factAlias}_scope` } = {}) {
  const yearMonthKeys = Array.isArray(getCurrentYearMonthKeys(f))
    ? getCurrentYearMonthKeys(f).filter(Boolean)
    : [];
  const placeholders = yearMonthKeys.map(() => "?").join(",");
  const compact = hasCompactVentasMesScope(runtime);
  const params = compact
    ? (yearMonthKeys.length > 1
        ? yearMonthKeys.slice()
        : [yearMonthKeys[0] || getExactYearMonthKey(f) || ""])
    : [f?.desde || "", f?.hasta || ""];
  const fromSql = compact
    ? `FROM ventas_mes_scope ${factAlias} INNER JOIN ventas_scope_dim ${dimAlias} ON ${dimAlias}.scope_id = ${factAlias}.scope_id`
    : `FROM ventas ${factAlias}`;
  const columns = compact
    ? {
        coordinador: `${dimAlias}.Coordinador`,
        agente: `${dimAlias}.Cod_Agente`,
        cliente: `${dimAlias}.Cod_Cliente`,
        grupo: `${dimAlias}.Grupo_Familia`,
        marca: `${dimAlias}.Marca`,
        codProd: `${dimAlias}.Cod_Producto`,
        registros: `${factAlias}.Registros`,
        kilos: `${factAlias}.Kilos`,
        yearMonth: `${factAlias}.YearMonth`
      }
    : {
        coordinador: `${factAlias}.Coordinador`,
        agente: `${factAlias}.Cod_Agente`,
        cliente: `${factAlias}.Cod_Cliente`,
        grupo: `${factAlias}.Grupo_Familia`,
        marca: `${factAlias}.Marca`,
        codProd: `${factAlias}.Cod_Producto`,
        registros: "1",
        kilos: `${factAlias}.Kilos`,
        yearMonth: `substr(${factAlias}.Fecha, 1, 7)`
      };
  const where = compact
    ? [yearMonthKeys.length > 1 ? `${factAlias}.YearMonth IN (${placeholders})` : `${factAlias}.YearMonth = ?`]
    : [`${factAlias}.Fecha >= ?`, `${factAlias}.Fecha <= ?`];
  const business = buildBusinessWhere(f, dims, columns);
  if (business.sql) {
    where.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }
  return {
    compact,
    factAlias,
    dimAlias,
    columns,
    fromSql,
    whereSql: `WHERE ${where.join(" AND ")}`,
    params,
    yearMonthKeys,
    sourceLabel: compact ? "ventas_mes_scope+ventas_scope_dim" : "ventas-month-filtered-fallback"
  };
}

export function buildCurrentScopedSource(runtime, f, dims = [], { factAlias = "s", dimAlias = `${factAlias}_scope` } = {}) {
  const yearMonthKeys = Array.isArray(getCurrentYearMonthKeys(f))
    ? getCurrentYearMonthKeys(f).filter(Boolean)
    : [];

  if (yearMonthKeys.length) {
    if (hasCompactVentasMesScope(runtime)) {
      return buildCurrentMonthSource(runtime, f, dims, { factAlias, dimAlias });
    }
    if (canUseCurrentDayScope(runtime, f)) {
      return buildCurrentDaySource(runtime, f, dims, { factAlias, dimAlias });
    }
    return buildCurrentMonthSource(runtime, f, dims, { factAlias, dimAlias });
  }

  if (canUseCurrentDayScope(runtime, f)) {
    return buildCurrentDaySource(runtime, f, dims, { factAlias, dimAlias });
  }

  return buildRawVentasSource(f, dims, { factAlias, dimAlias });
}

export function buildHistoricalWhere(compare, f, dims = []) {
  const where = ["Fecha >= ?", "Fecha <= ?"];
  const params = [compare.desde, compare.hasta];
  const business = buildBusinessWhere(f, dims);
  if (business.sql) {
    where.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }
  return { sql: `WHERE ${where.join(" AND ")}`, params };
}

export function buildHistoricalMonthSource(runtime, compare, f, dims = [], { factAlias = "h", dimAlias = `${factAlias}_scope` } = {}) {
  const yearMonthKeys = Array.isArray(compare?.yearMonthKeys)
    ? compare.yearMonthKeys.filter(Boolean)
    : [];
  const placeholders = yearMonthKeys.map(() => "?").join(",");
  const params = yearMonthKeys.length > 1
    ? yearMonthKeys.slice()
    : [yearMonthKeys[0] || yearMonthKey(compare.compareYear, compare.compareMonth)];
  const compact = hasCompactVentas2025MesScope(runtime);
  const fromSql = compact
    ? `FROM ventas_2025_mes_scope ${factAlias} INNER JOIN ventas_2025_scope_dim ${dimAlias} ON ${dimAlias}.scope_id = ${factAlias}.scope_id`
    : `FROM ventas_2025_mes_scope ${factAlias}`;
  const columns = compact
    ? {
        coordinador: `${dimAlias}.Coordinador`,
        agente: `${dimAlias}.Cod_Agente`,
        cliente: `${dimAlias}.Cod_Cliente`,
        grupo: `${dimAlias}.Grupo_Familia`,
        marca: `${dimAlias}.Marca`,
        codProd: `${dimAlias}.Cod_Producto`,
        kilos: `${factAlias}.Kilos`,
        // ventas_2025_mes_scope no materializa Registros; para mantener consistencia
        // con compare-handler usamos una fila por scope/mes como proxy agregado.
        registros: `1`
      }
    : {
        coordinador: `${factAlias}.Coordinador`,
        agente: `${factAlias}.Cod_Agente`,
        cliente: `${factAlias}.Cod_Cliente`,
        grupo: `${factAlias}.Grupo_Familia`,
        marca: `${factAlias}.Marca`,
        codProd: `${factAlias}.Cod_Producto`,
        kilos: `${factAlias}.Kilos`,
        registros: `1`
      };
  const where = [yearMonthKeys.length > 1 ? `${factAlias}.YearMonth IN (${placeholders})` : `${factAlias}.YearMonth = ?`];
  const business = buildBusinessWhere(f, dims, columns);
  if (business.sql) {
    where.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }
  return {
    compact,
    factAlias,
    dimAlias,
    columns,
    fromSql,
    whereSql: `WHERE ${where.join(" AND ")}`,
    params
  };
}

export function canUseHistoricalMonthScope(runtime, compare) {
  return Boolean(runtime?.hasVentas2025MesScope && Array.isArray(compare?.yearMonthKeys) && compare.yearMonthKeys.length);
}
