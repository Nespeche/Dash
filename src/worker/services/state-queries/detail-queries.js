import { DETAIL_PAGE_DEFAULT, SUMMARY_COLS } from "../../config.js";
import { queryAll, queryFirst } from "../../lib/db.js";
import { buildWhere } from "../../lib/filters.js";
import { buildCurrentDaySource, canUseCurrentDayScope } from "../../lib/scope.js";
import { summaryTo2D } from "./common.js";

function buildDetailQueryContext(runtime, f) {
  const useDayScope = canUseCurrentDayScope(runtime, f);
  if (useDayScope) {
    const source = buildCurrentDaySource(runtime, f, ["coordinador", "agente", "cliente", "grupo", "detailGroups", "marca", "codProd"], { factAlias: "d", dimAlias: "ds" });
    const fromSql = `${source.fromSql}
      LEFT JOIN clientes_catalogo c ON c.Cod_Cliente = ${source.columns.cliente}
      LEFT JOIN productos_catalogo p ON p.Cod_Producto = ${source.columns.codProd}`;
    return {
      useDayScope,
      fromSql,
      whereSql: source.whereSql,
      params: source.params,
      groupBy: `GROUP BY ${source.columns.fecha}, ${source.columns.cliente}, ${source.columns.grupo}, ${source.columns.codProd}`,
      selectSql: `
        SELECT
          ${source.columns.fecha} AS Fecha,
          MIN(COALESCE(c.Cliente, ${source.columns.cliente})) AS Cliente,
          ${source.columns.grupo} AS Grupo_Familia,
          ${source.columns.codProd} AS Cod_Producto,
          MIN(COALESCE(p.Producto_Desc, ${source.columns.codProd})) AS Producto_Desc,
          COALESCE(SUM(${source.columns.kilos}), 0) AS Kilos
        ${fromSql}
        ${source.whereSql}
        GROUP BY ${source.columns.fecha}, ${source.columns.cliente}, ${source.columns.grupo}, ${source.columns.codProd}
      `,
      sourceMode: "phase-9-detail-day-scope"
    };
  }

  const scope = buildWhere(f, ["coordinador", "agente", "cliente", "grupo", "detailGroups", "marca", "codProd"]);
  const fromSql = `FROM ventas ${scope.sql}`;
  return {
    useDayScope,
    fromSql,
    whereSql: scope.sql,
    params: scope.params,
    groupBy: `GROUP BY Fecha, Cod_Cliente, Grupo_Familia, Cod_Producto`,
    selectSql: `
      SELECT
        Fecha,
        MIN(Cliente) AS Cliente,
        Grupo_Familia,
        Cod_Producto,
        MIN(Producto_Desc) AS Producto_Desc,
        COALESCE(SUM(Kilos), 0) AS Kilos
      ${fromSql}
      GROUP BY Fecha, Cod_Cliente, Grupo_Familia, Cod_Producto
    `,
    sourceMode: "phase-5-runtime-aligned"
  };
}

function buildDetailExtraFilterClause(extraColumnFilters = {}, { excludeKey = "" } = {}) {
  const whereParts = [];
  const params = [];

  for (const [key, rawValues] of Object.entries(extraColumnFilters || {})) {
    if (!DETAIL_OPTION_COLUMNS[key] || key === excludeKey || !Array.isArray(rawValues) || !rawValues.length) continue;
    if (key === "Kilos") {
      const numericValues = rawValues.map(value => Number(value)).filter(value => Number.isFinite(value));
      if (!numericValues.length) continue;
      whereParts.push(`Kilos IN (${numericValues.map(() => "?").join(",")})`);
      params.push(...numericValues);
      continue;
    }
    whereParts.push(`${key} IN (${rawValues.map(() => "?").join(",")})`);
    params.push(...rawValues.map(value => String(value ?? "")));
  }

  return {
    sql: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    params
  };
}

export async function queryDetailPageData(env, runtime, f, limit = DETAIL_PAGE_DEFAULT, offset = 0) {
  const ctx = buildDetailQueryContext(runtime, f);
  const extraFilters = buildDetailExtraFilterClause(f?.extraColumnFilters || {});

  const pageSql = `
    WITH detail_ctx AS (
      ${ctx.selectSql}
    )
    SELECT Fecha, Cliente, Grupo_Familia, Cod_Producto, Producto_Desc, Kilos
    FROM detail_ctx
    ${extraFilters.sql}
    ORDER BY Fecha DESC, Kilos DESC, Cliente COLLATE NOCASE ASC, Producto_Desc COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `;

  const totalSql = `
    WITH detail_ctx AS (
      ${ctx.selectSql}
    )
    SELECT COUNT(*) AS total
    FROM detail_ctx
    ${extraFilters.sql}
  `;

  const [pageRes, totalRes] = await Promise.all([
    queryAll(env, pageSql, [...ctx.params, ...extraFilters.params, limit, offset]),
    queryFirst(env, totalSql, [...ctx.params, ...extraFilters.params])
  ]);

  const rows = (pageRes || []).map(r => ({
    Fecha: String(r.Fecha || ""),
    Cliente: String(r.Cliente || ""),
    Grupo_Familia: String(r.Grupo_Familia || ""),
    Cod_Producto: String(r.Cod_Producto || ""),
    Producto_Desc: String(r.Producto_Desc || ""),
    Kilos: Number(r.Kilos || 0)
  }));
  const total = Number(totalRes?.total || 0);

  return {
    headers: SUMMARY_COLS,
    rows: summaryTo2D(rows),
    total,
    offset,
    nextOffset: offset + rows.length,
    limit,
    hasMore: offset + rows.length < total,
    sourceMode: ctx.sourceMode
  };
}

const DETAIL_OPTION_COLUMNS = {
  Fecha: { valueExpr: 'CAST(Fecha AS TEXT)', filterExpr: 'Fecha', orderSql: 'ORDER BY value DESC' },
  Cliente: { valueExpr: 'CAST(Cliente AS TEXT)', filterExpr: 'Cliente', orderSql: 'ORDER BY value COLLATE NOCASE ASC' },
  Grupo_Familia: { valueExpr: 'CAST(Grupo_Familia AS TEXT)', filterExpr: 'Grupo_Familia', orderSql: 'ORDER BY value COLLATE NOCASE ASC' },
  Cod_Producto: { valueExpr: 'CAST(Cod_Producto AS TEXT)', filterExpr: 'Cod_Producto', orderSql: 'ORDER BY value COLLATE NOCASE ASC' },
  Producto_Desc: { valueExpr: 'CAST(Producto_Desc AS TEXT)', filterExpr: 'Producto_Desc', orderSql: 'ORDER BY value COLLATE NOCASE ASC' },
  Kilos: { valueExpr: "printf('%g', Kilos)", filterExpr: 'Kilos', orderSql: 'ORDER BY CAST(value AS REAL) DESC' }
};

export async function queryDetailFilterOptions(env, runtime, f, columnKey) {
  const spec = DETAIL_OPTION_COLUMNS[columnKey];
  if (!spec) return [];

  const ctx = buildDetailQueryContext(runtime, f);
  const extraFilters = buildDetailExtraFilterClause(f?.extraColumnFilters || {}, { excludeKey: columnKey });
  const whereParts = extraFilters.sql ? [extraFilters.sql.replace(/^WHERE\s+/i, '')] : [];
  const params = [...extraFilters.params];

  whereParts.push(`NULLIF(TRIM(${spec.valueExpr}), '') IS NOT NULL`);

  const sql = `
    WITH detail_ctx AS (
      ${ctx.selectSql}
    )
    SELECT DISTINCT ${spec.valueExpr} AS value
    FROM detail_ctx
    ${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
    ${spec.orderSql}
    LIMIT 2000
  `;

  const rows = await queryAll(env, sql, ctx.params.concat(params));
  return (rows || [])
    .map(row => String(row.value || '').trim())
    .filter(Boolean);
}
