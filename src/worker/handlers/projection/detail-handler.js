import { APP_VERSION } from "../../../shared/version.js";
import { PROJECTION_DETAIL_TTL } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { queryAll, queryFirst } from "../../lib/db.js";
import { andExtra, buildWhere, hasProjectionBusinessFilter, parseFilters } from "../../lib/filters.js";
import { parseProjectionCompareContext } from "../../lib/dates.js";
import { buildCurrentDaySource, buildCurrentMonthSource, buildHistoricalMonthSource, buildHistoricalWhere } from "../../lib/scope.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { missingVentasMessage } from "../../lib/payloads.js";
import { PROJECTION_DETAIL_DIMS, resolveProjectionCompareSources, resolveProjectionDetailContext } from "./shared.js";

const PROJECTION_DETAIL_OPTION_COLUMNS = {
  Fecha: { valueExpr: 'CAST(Fecha AS TEXT)', orderSql: 'ORDER BY value DESC' },
  Cliente: { valueExpr: 'CAST(Cliente AS TEXT)', orderSql: 'ORDER BY value COLLATE NOCASE ASC' },
  Grupo_Familia: { valueExpr: 'CAST(Grupo_Familia AS TEXT)', orderSql: 'ORDER BY value COLLATE NOCASE ASC' },
  Cod_Producto: { valueExpr: 'CAST(Cod_Producto AS TEXT)', orderSql: 'ORDER BY value COLLATE NOCASE ASC' },
  Producto_Desc: { valueExpr: 'CAST(Producto_Desc AS TEXT)', orderSql: 'ORDER BY value COLLATE NOCASE ASC' },
  KilosActuales: { valueExpr: "printf('%g', KilosActuales)", orderSql: 'ORDER BY CAST(value AS REAL) DESC' },
  Kilos2025: { valueExpr: "printf('%g', Kilos2025)", orderSql: 'ORDER BY CAST(value AS REAL) DESC' }
};

function buildProjectionColumnFilterClause(extraFilters = {}, { excludeKey = "" } = {}) {
  const whereParts = [];
  const params = [];
  for (const [key, values] of Object.entries(extraFilters || {})) {
    const spec = PROJECTION_DETAIL_OPTION_COLUMNS[key];
    if (!spec || key === excludeKey || !Array.isArray(values) || !values.length) continue;
    if (key === 'KilosActuales' || key === 'Kilos2025') {
      const numericValues = values.map(value => Number(value)).filter(value => Number.isFinite(value));
      if (!numericValues.length) continue;
      whereParts.push(`${key} IN (${numericValues.map(() => '?').join(',')})`);
      params.push(...numericValues);
      continue;
    }
    whereParts.push(`${key} IN (${values.map(() => '?').join(',')})`);
    params.push(...values.map(value => String(value ?? '')));
  }
  return { whereParts, params };
}

export async function handleProjectionDetail(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);
  const compare = parseProjectionCompareContext(url, f);
  const detailContext = resolveProjectionDetailContext(url, runtime, f, compare);

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      if (!runtime.hasVentas) {
        return jsonNoStore({
          ok: true,
          headers: detailContext.headers,
          rows: [],
          total: 0,
          offset: detailContext.offset,
          nextOffset: detailContext.offset,
          limit: detailContext.requestedLimit,
          hasMore: false,
          summary: {
            projectedDate: detailContext.projectedDate,
            totalRows: 0,
            kilosActuales: 0,
            kilos2025: 0
          },
          meta: {
            appVersion: APP_VERSION,
            dataVersion: runtime.meta.dataVersion,
            totalKnown: true,
            viewMode: detailContext.detailView,
            selectedGroups: detailContext.detailGroups,
            message: missingVentasMessage()
          }
        });
      }

      if (!hasProjectionBusinessFilter(f)) {
        return jsonPublic({
          ok: true,
          headers: detailContext.headers,
          rows: [],
          total: 0,
          offset: detailContext.offset,
          nextOffset: detailContext.offset,
          limit: detailContext.requestedLimit,
          hasMore: false,
          summary: {
            projectedDate: detailContext.projectedDate,
            totalRows: 0,
            kilosActuales: 0,
            kilos2025: 0
          },
          meta: {
            appVersion: APP_VERSION,
            dataVersion: runtime.meta.dataVersion,
            totalKnown: true,
            viewMode: detailContext.detailView,
            selectedGroups: detailContext.detailGroups,
            message: "Aplicá al menos un filtro de negocio o seleccioná uno o más grupos proyectados para ver el detalle proyectado."
          }
        }, PROJECTION_DETAIL_TTL);
      }

      const scopeCurrent = buildWhere(f, PROJECTION_DETAIL_DIMS);
      const compareSources = resolveProjectionCompareSources(runtime, f, compare);
      const currentScopedSource = compareSources.useCurrentMonthScope
        ? buildCurrentMonthSource(runtime, f, PROJECTION_DETAIL_DIMS, { factAlias: "m", dimAlias: "ms" })
        : compareSources.useCurrentDayScope
          ? buildCurrentDaySource(runtime, f, PROJECTION_DETAIL_DIMS, { factAlias: "d", dimAlias: "ds" })
          : null;
      const useCurrentScopedProjectionDetail = Boolean(currentScopedSource);
      const currentProjectionSourceLabel = compareSources.currentSourceLabel;
      const historicalSourceLabel = compareSources.historicalSourceLabel;
      const scopeHist = compareSources.useHistoricalMonthScope
        ? buildHistoricalMonthSource(runtime, compare, f, PROJECTION_DETAIL_DIMS, { factAlias: "h", dimAlias: "hs" })
        : buildHistoricalWhere(compare, f, PROJECTION_DETAIL_DIMS);

      let pageSql = "";
      let countSql = "";
      let summarySql = "";
      let commonParams = [];
      let countParams = [];
      let summaryParams = [];
      let totalKnown = detailContext.detailView !== "detail";
      const pageLimit = detailContext.detailView === "detail" ? detailContext.requestedLimit + 1 : detailContext.requestedLimit;
      const extraColumnFilters = f?.extraColumnFilters && typeof f.extraColumnFilters === "object" ? f.extraColumnFilters : {};

      if (detailContext.detailView === "detail") {
        const inGroups = detailContext.detailGroups.map(() => "?").join(",");
        const currentDetailSql = andExtra(scopeCurrent.sql, `Grupo_Familia IN (${inGroups})`);
        const historicalGroupColumn = compareSources.useHistoricalMonthScope ? scopeHist.columns.grupo : "Grupo_Familia";
        const histDetailSql = andExtra(compareSources.useHistoricalMonthScope ? scopeHist.whereSql : scopeHist.sql, `${historicalGroupColumn} IN (${inGroups})`);
        const historicalDetailCte = runtime.hasVentas2025
          ? (detailContext.useNormalizedHistoricalMonthScope
              ? `historical_rows AS (
            SELECT
              ${scopeHist.columns.cliente} AS Cod_Cliente,
              MIN(COALESCE(hc.Cliente, cc.Cliente, '')) AS Cliente,
              ${scopeHist.columns.grupo} AS Grupo_Familia,
              ${scopeHist.columns.codProd} AS Cod_Producto,
              MIN(COALESCE(hp.Producto_Desc, pc.Producto_Desc, '')) AS Producto_Desc,
              COALESCE(SUM(h.Kilos), 0) AS Kilos2025
            ${scopeHist.fromSql}
            LEFT JOIN ventas_2025_clientes_catalogo hc ON hc.Cod_Cliente = ${scopeHist.columns.cliente}
            LEFT JOIN clientes_catalogo cc ON cc.Cod_Cliente = ${scopeHist.columns.cliente}
            LEFT JOIN ventas_2025_productos_catalogo hp ON hp.Cod_Producto = ${scopeHist.columns.codProd}
            LEFT JOIN productos_catalogo pc ON pc.Cod_Producto = ${scopeHist.columns.codProd}
            ${histDetailSql}
            GROUP BY ${scopeHist.columns.cliente}, ${scopeHist.columns.grupo}, ${scopeHist.columns.codProd}
          )`
              : compareSources.useHistoricalMonthScope
                ? `historical_rows AS (
            SELECT
              ${scopeHist.columns.cliente} AS Cod_Cliente,
              CAST('' AS TEXT) AS Cliente,
              ${scopeHist.columns.grupo} AS Grupo_Familia,
              ${scopeHist.columns.codProd} AS Cod_Producto,
              CAST('' AS TEXT) AS Producto_Desc,
              COALESCE(SUM(h.Kilos), 0) AS Kilos2025
            ${scopeHist.fromSql}
            ${histDetailSql}
            GROUP BY ${scopeHist.columns.cliente}, ${scopeHist.columns.grupo}, ${scopeHist.columns.codProd}
          )`
                : `historical_rows AS (
            SELECT
              Cod_Cliente,
              MIN(Cliente) AS Cliente,
              Grupo_Familia,
              Cod_Producto,
              MIN(Producto_Desc) AS Producto_Desc,
              COALESCE(SUM(Kilos), 0) AS Kilos2025
            FROM ${compareSources.historicalTable}
            ${histDetailSql}
            GROUP BY Cod_Cliente, Grupo_Familia, Cod_Producto
          )`)
          : `historical_rows AS (
            SELECT
              CAST(NULL AS TEXT) AS Cod_Cliente,
              CAST(NULL AS TEXT) AS Cliente,
              CAST(NULL AS TEXT) AS Grupo_Familia,
              CAST(NULL AS TEXT) AS Cod_Producto,
              CAST(NULL AS TEXT) AS Producto_Desc,
              CAST(0 AS REAL) AS Kilos2025
            WHERE 1 = 0
          )`;

        const currentDetailCte = useCurrentScopedProjectionDetail
          ? `current_rows AS (
            SELECT
              ${currentScopedSource.columns.cliente} AS Cod_Cliente,
              MIN(COALESCE(c.Cliente, ${currentScopedSource.columns.cliente})) AS Cliente,
              ${currentScopedSource.columns.grupo} AS Grupo_Familia,
              ${currentScopedSource.columns.codProd} AS Cod_Producto,
              MIN(COALESCE(p.Producto_Desc, ${currentScopedSource.columns.codProd})) AS Producto_Desc,
              COALESCE(SUM(${currentScopedSource.columns.kilos}), 0) AS KilosActuales
            ${currentScopedSource.fromSql}
            LEFT JOIN clientes_catalogo c ON c.Cod_Cliente = ${currentScopedSource.columns.cliente}
            LEFT JOIN productos_catalogo p ON p.Cod_Producto = ${currentScopedSource.columns.codProd}
            ${andExtra(currentScopedSource.whereSql, `${currentScopedSource.columns.grupo} IN (${inGroups})`)}
            GROUP BY ${currentScopedSource.columns.cliente}, ${currentScopedSource.columns.grupo}, ${currentScopedSource.columns.codProd}
          )`
          : `current_rows AS (
            SELECT
              Cod_Cliente,
              MIN(Cliente) AS Cliente,
              Grupo_Familia,
              Cod_Producto,
              MIN(Producto_Desc) AS Producto_Desc,
              COALESCE(SUM(Kilos), 0) AS KilosActuales
            FROM ventas
            ${currentDetailSql}
            GROUP BY Cod_Cliente, Grupo_Familia, Cod_Producto
          )`;

        const detailFilter = buildProjectionColumnFilterClause(extraColumnFilters);
        const detailWhereSql = detailFilter.whereParts.length ? `WHERE ${detailFilter.whereParts.join(" AND ")}` : "";
        const commonSql = `
          WITH ${currentDetailCte},
          ${historicalDetailCte},
          union_rows AS (
            SELECT Cod_Cliente, Cliente, Grupo_Familia, Cod_Producto, Producto_Desc, KilosActuales, 0 AS Kilos2025
            FROM current_rows
            UNION ALL
            SELECT Cod_Cliente, Cliente, Grupo_Familia, Cod_Producto, Producto_Desc, 0 AS KilosActuales, Kilos2025
            FROM historical_rows
          ),
          joined_rows AS (
            SELECT
              ? AS Fecha,
              MIN(Cliente) AS Cliente,
              COALESCE(Grupo_Familia, '') AS Grupo_Familia,
              COALESCE(Cod_Producto, '') AS Cod_Producto,
              MIN(Producto_Desc) AS Producto_Desc,
              COALESCE(SUM(KilosActuales), 0) AS KilosActuales,
              COALESCE(SUM(Kilos2025), 0) AS Kilos2025
            FROM union_rows
            GROUP BY Cod_Cliente, Grupo_Familia, Cod_Producto
          )
        `;

        pageSql = `${commonSql}
          SELECT
            Fecha, Cliente, Grupo_Familia, Cod_Producto, Producto_Desc, KilosActuales, Kilos2025
          FROM joined_rows
          ${detailWhereSql}
          ORDER BY KilosActuales DESC, Kilos2025 DESC, Cliente COLLATE NOCASE ASC, Producto_Desc COLLATE NOCASE ASC
          LIMIT ? OFFSET ?`;

        const historicalDetailSummaryExpr = !runtime.hasVentas2025
          ? "0"
          : compareSources.useHistoricalMonthScope
            ? `SELECT SUM(h.Kilos)
              ${scopeHist.fromSql}
              ${histDetailSql}`
            : `SELECT SUM(Kilos)
              FROM ${compareSources.historicalTable}
              ${histDetailSql}`;

        const currentDetailSummaryExpr = useCurrentScopedProjectionDetail
          ? `SELECT SUM(${currentScopedSource.columns.kilos})
              ${currentScopedSource.fromSql}
              ${andExtra(currentScopedSource.whereSql, `${currentScopedSource.columns.grupo} IN (${inGroups})`)}`
          : `SELECT SUM(Kilos)
              FROM ventas
              ${currentDetailSql}`;

        summarySql = `
          SELECT
            COALESCE((
              ${currentDetailSummaryExpr}
            ), 0) AS kilosActuales,
            COALESCE((
              ${historicalDetailSummaryExpr}
            ), 0) AS kilos2025
        `;

        commonParams = [
          ...(useCurrentScopedProjectionDetail ? [...currentScopedSource.params, ...detailContext.detailGroups] : [...scopeCurrent.params, ...detailContext.detailGroups]),
          ...(runtime.hasVentas2025 ? [...scopeHist.params, ...detailContext.detailGroups] : []),
          detailContext.projectedDate,
          ...detailFilter.params
        ];
        summaryParams = [
          ...(useCurrentScopedProjectionDetail ? [...currentScopedSource.params, ...detailContext.detailGroups] : [...scopeCurrent.params, ...detailContext.detailGroups]),
          ...(runtime.hasVentas2025 ? [...scopeHist.params, ...detailContext.detailGroups] : [])
        ];
      } else {
        const historicalClientCte = runtime.hasVentas2025
          ? (detailContext.useNormalizedHistoricalMonthScope
              ? `historical_client_rows AS (
            SELECT
              ${scopeHist.columns.cliente} AS Cod_Cliente,
              MIN(COALESCE(hc.Cliente, cc.Cliente, '')) AS Cliente,
              COALESCE(SUM(h.Kilos), 0) AS Kilos2025
            ${scopeHist.fromSql}
            LEFT JOIN ventas_2025_clientes_catalogo hc ON hc.Cod_Cliente = ${scopeHist.columns.cliente}
            LEFT JOIN clientes_catalogo cc ON cc.Cod_Cliente = ${scopeHist.columns.cliente}
            ${scopeHist.whereSql}
            GROUP BY ${scopeHist.columns.cliente}
          )`
              : compareSources.useHistoricalMonthScope
                ? `historical_client_rows AS (
            SELECT
              ${scopeHist.columns.cliente} AS Cod_Cliente,
              CAST('' AS TEXT) AS Cliente,
              COALESCE(SUM(h.Kilos), 0) AS Kilos2025
            ${scopeHist.fromSql}
            ${scopeHist.whereSql}
            GROUP BY ${scopeHist.columns.cliente}
          )`
                : `historical_client_rows AS (
            SELECT
              Cod_Cliente,
              MIN(Cliente) AS Cliente,
              COALESCE(SUM(Kilos), 0) AS Kilos2025
            FROM ${compareSources.historicalTable}
            ${scopeHist.sql}
            GROUP BY Cod_Cliente
          )`)
          : `historical_client_rows AS (
            SELECT
              CAST(NULL AS TEXT) AS Cod_Cliente,
              CAST(NULL AS TEXT) AS Cliente,
              CAST(0 AS REAL) AS Kilos2025
            WHERE 1 = 0
          )`;

        const currentClientCte = useCurrentScopedProjectionDetail
          ? `current_client_rows AS (
            SELECT
              ${currentScopedSource.columns.cliente} AS Cod_Cliente,
              MIN(COALESCE(c.Cliente, ${currentScopedSource.columns.cliente})) AS Cliente,
              COALESCE(SUM(${currentScopedSource.columns.kilos}), 0) AS KilosActuales
            ${currentScopedSource.fromSql}
            LEFT JOIN clientes_catalogo c ON c.Cod_Cliente = ${currentScopedSource.columns.cliente}
            ${currentScopedSource.whereSql}
            GROUP BY ${currentScopedSource.columns.cliente}
          )`
          : `current_client_rows AS (
            SELECT
              Cod_Cliente,
              MIN(Cliente) AS Cliente,
              COALESCE(SUM(Kilos), 0) AS KilosActuales
            FROM ventas
            ${scopeCurrent.sql}
            GROUP BY Cod_Cliente
          )`;

        const summaryFilter = buildProjectionColumnFilterClause(extraColumnFilters);
        const summaryWhereSql = summaryFilter.whereParts.length ? `WHERE ${summaryFilter.whereParts.join(" AND ")}` : "";
        const commonSql = `
          WITH ${currentClientCte},
          ${historicalClientCte},
          union_rows AS (
            SELECT Cod_Cliente, Cliente, KilosActuales, 0 AS Kilos2025 FROM current_client_rows
            UNION ALL
            SELECT Cod_Cliente, Cliente, 0 AS KilosActuales, Kilos2025 FROM historical_client_rows
          ),
          summary_rows AS (
            SELECT
              ? AS Fecha,
              MIN(Cliente) AS Cliente,
              COALESCE(SUM(KilosActuales), 0) AS KilosActuales,
              COALESCE(SUM(Kilos2025), 0) AS Kilos2025
            FROM union_rows
            GROUP BY Cod_Cliente
          )
        `;

        pageSql = `${commonSql}
          SELECT
            Fecha, Cliente, KilosActuales, Kilos2025
          FROM summary_rows
          ${summaryWhereSql}
          ORDER BY KilosActuales DESC, Kilos2025 DESC, Cliente COLLATE NOCASE ASC
          LIMIT ? OFFSET ?`;

        countSql = `${commonSql}
          SELECT COUNT(*) AS totalRows
          FROM summary_rows
          ${summaryWhereSql}`;

        const historicalClientSummaryExpr = !runtime.hasVentas2025
          ? "0"
          : compareSources.useHistoricalMonthScope
            ? `SELECT SUM(h.Kilos)
              ${scopeHist.fromSql}
              ${scopeHist.whereSql}`
            : `SELECT SUM(Kilos)
              FROM ${compareSources.historicalTable}
              ${scopeHist.sql}`;

        const currentClientSummaryExpr = useCurrentScopedProjectionDetail
          ? `SELECT SUM(${currentScopedSource.columns.kilos})
              ${currentScopedSource.fromSql}
              ${currentScopedSource.whereSql}`
          : `SELECT SUM(Kilos)
              FROM ventas
              ${scopeCurrent.sql}`;

        summarySql = `
          SELECT
            COALESCE((
              ${currentClientSummaryExpr}
            ), 0) AS kilosActuales,
            COALESCE((
              ${historicalClientSummaryExpr}
            ), 0) AS kilos2025
        `;

        commonParams = [
          ...(useCurrentScopedProjectionDetail ? currentScopedSource.params : scopeCurrent.params),
          ...(runtime.hasVentas2025 ? scopeHist.params : []),
          detailContext.projectedDate,
          ...summaryFilter.params
        ];
        countParams = commonParams.slice();
        summaryParams = [
          ...(useCurrentScopedProjectionDetail ? currentScopedSource.params : scopeCurrent.params),
          ...(runtime.hasVentas2025 ? scopeHist.params : [])
        ];
      }

      const tasks = [
        queryAll(env, pageSql, [...commonParams, pageLimit, detailContext.offset]),
        queryFirst(env, summarySql, summaryParams)
      ];
      if (countSql) tasks.push(queryFirst(env, countSql, countParams));

      const [pageRes, summaryRes, countRes] = await Promise.all(tasks);
      const rawRows = (pageRes || []).map(r => ({
        Fecha: String(r.Fecha || detailContext.projectedDate),
        Cliente: String(r.Cliente || ""),
        Grupo_Familia: String(r.Grupo_Familia || ""),
        Cod_Producto: String(r.Cod_Producto || ""),
        Producto_Desc: String(r.Producto_Desc || ""),
        KilosActuales: Number(r.KilosActuales || 0),
        Kilos2025: Number(r.Kilos2025 || 0)
      }));
      const hasMore = detailContext.detailView === "detail"
        ? rawRows.length > detailContext.requestedLimit
        : (detailContext.offset + rawRows.length) < Number(countRes?.totalRows || 0);
      const rows = detailContext.detailView === "detail" ? rawRows.slice(0, detailContext.requestedLimit) : rawRows;
      const total = totalKnown ? Number(countRes?.totalRows || 0) : null;

      return jsonPublic({
        ok: true,
        headers: detailContext.headers,
        rows: detailContext.detailView === "detail"
          ? rows.map(r => [r.Fecha, r.Cliente, r.Grupo_Familia, r.Cod_Producto, r.Producto_Desc, r.KilosActuales, r.Kilos2025])
          : rows.map(r => [r.Fecha, r.Cliente, r.KilosActuales, r.Kilos2025]),
        total,
        offset: detailContext.offset,
        nextOffset: detailContext.offset + rows.length,
        limit: detailContext.requestedLimit,
        hasMore,
        summary: {
          projectedDate: detailContext.projectedDate,
          totalRows: totalKnown ? Number(countRes?.totalRows || 0) : null,
          kilosActuales: Number(summaryRes?.kilosActuales || 0),
          kilos2025: Number(summaryRes?.kilos2025 || 0)
        },
        compare: {
          year: compare.compareYear,
          month: compare.compareMonth,
          desde: compare.desde,
          hasta: compare.hasta,
          mode: compareSources.compareResponseMode,
          label: compareSources.compareResponseLabel
        },
        meta: {
          appVersion: APP_VERSION,
          dataVersion: runtime.meta.dataVersion,
          historyAvailable: runtime.hasVentas2025,
          historySource: historicalSourceLabel,
          currentSource: currentProjectionSourceLabel,
          totalKnown,
          fastDetail: detailContext.detailView === "detail",
          viewMode: detailContext.detailView,
          selectedGroups: detailContext.detailGroups,
          message: runtime.hasVentas2025 ? "" : "La base historica 2025 no esta cargada en D1."
        }
      }, PROJECTION_DETAIL_TTL);
    }
  });
}
