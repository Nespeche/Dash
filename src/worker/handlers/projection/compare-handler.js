import { APP_VERSION } from "../../../shared/version.js";
import { PROJECTION_COMPARE_TTL } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { queryFirst } from "../../lib/db.js";
import { andExtra, buildWhere, hasDetailGroupFilter, parseFilters } from "../../lib/filters.js";
import { parseProjectionCompareContext } from "../../lib/dates.js";
import { buildCurrentDaySource, buildHistoricalMonthSource, buildHistoricalWhere, canUseCurrentDayScope } from "../../lib/scope.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { missingVentasMessage } from "../../lib/payloads.js";
import { queryCurrentDayScopeKpis, queryCurrentMonthScopeKpis, queryMonthKpisFastPath } from "../../services/state-queries.js";
import { PROJECTION_COMPARE_DIMS, resolveProjectionCompareSources } from "./shared.js";

export async function handleProjectionCompare(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);
  const compare = parseProjectionCompareContext(url, f);
  const sourceInfo = resolveProjectionCompareSources(runtime, f, compare);
  // v42: when quick-group cards are active, bypass snapshots — they have pre-aggregated globals
  const hasDetailGroupActive = hasDetailGroupFilter(f);

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      if (!runtime.hasVentas) {
        return jsonNoStore({
          ok: true,
          available: Boolean(runtime.hasVentas2025),
          current: {
            kilos: 0,
            clientes: 0,
            agentes: 0,
            registros: 0
          },
          compare: {
            year: compare.compareYear,
            month: compare.compareMonth,
            desde: compare.desde,
            hasta: compare.hasta,
            mode: sourceInfo.compareResponseMode,
            label: sourceInfo.compareResponseLabel,
            kilos: 0,
            clientes: 0,
            agentes: 0,
            registros: 0,
            latestDate: "",
            latestKilos: 0
          },
          meta: {
            appVersion: APP_VERSION,
            dataVersion: runtime.meta.dataVersion,
            selectedGroups: f.projGroups || [],
            currentSource: sourceInfo.currentSourceLabel,
            historicalSource: sourceInfo.historicalSourceLabel,
            message: missingVentasMessage()
          }
        });
      }

      const scopeCurrent = buildWhere(f, PROJECTION_COMPARE_DIMS);
      const scopeHistorical = sourceInfo.useHistoricalMonthScope
        ? buildHistoricalMonthSource(runtime, compare, f, PROJECTION_COMPARE_DIMS, { factAlias: "h", dimAlias: "hs" })
        : buildHistoricalWhere(compare, f, PROJECTION_COMPARE_DIMS);
      const latestCurrentSource = canUseCurrentDayScope(runtime, f)
        ? buildCurrentDaySource(runtime, f, PROJECTION_COMPARE_DIMS, { factAlias: "d", dimAlias: "ds" })
        : null;

      const historicalKpiTask = !runtime.hasVentas2025
        ? Promise.resolve(null)
        // v42: skip snapshot when detail groups active — snapshots have no group filter
        : sourceInfo.useHistoricalSnapshotMonth && !hasDetailGroupActive
          ? queryFirst(env, `
              SELECT kilos, clientes, agentes, registros
              FROM ventas_2025_snapshot_month
              WHERE YearMonth = ?
              LIMIT 1
            `, [compare.compareYearMonthKey])
          : sourceInfo.useHistoricalMonthScope
            ? queryFirst(env, `
                SELECT
                  COALESCE(SUM(h.Kilos), 0) AS kilos,
                  COUNT(DISTINCT NULLIF(${scopeHistorical.columns.cliente}, '')) AS clientes,
                  COUNT(DISTINCT NULLIF(${scopeHistorical.columns.agente}, '')) AS agentes,
                  COUNT(*) AS registros
                ${scopeHistorical.fromSql}
                ${scopeHistorical.whereSql}
              `, scopeHistorical.params)
            : queryFirst(env, `
                SELECT
                  COALESCE(SUM(Kilos), 0) AS kilos,
                  COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
                  COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
                  COUNT(*) AS registros
                FROM ${sourceInfo.historicalTable}
                ${scopeHistorical.sql}
              `, scopeHistorical.params);

      // v42: skip snapshot when detail groups active — snapshots have no group filter
      const currentKpiTask = sourceInfo.useCurrentSnapshotMonth && !hasDetailGroupActive
        ? queryMonthKpisFastPath(env, runtime, f)
        : sourceInfo.useCurrentMonthScope
          ? queryCurrentMonthScopeKpis(env, runtime, f, PROJECTION_COMPARE_DIMS)
          : sourceInfo.useCurrentDayScope
            ? queryCurrentDayScopeKpis(env, runtime, f, PROJECTION_COMPARE_DIMS)
            : queryFirst(env, `
                SELECT
                  COALESCE(SUM(Kilos), 0) AS kilos,
                  COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
                  COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
                  COUNT(*) AS registros
                FROM ventas
                ${scopeCurrent.sql}
              `, scopeCurrent.params);

      const latestDateTask = latestCurrentSource
        ? queryFirst(env, `
            SELECT MAX(${latestCurrentSource.columns.fecha}) AS Fecha
            ${latestCurrentSource.fromSql}
            ${latestCurrentSource.whereSql}
          `, latestCurrentSource.params)
        : queryFirst(env, `
            SELECT MAX(Fecha) AS Fecha
            FROM ventas
            ${scopeCurrent.sql}
          `, scopeCurrent.params);

      const [currentKpiRes, latestDateRes, historicalKpiRes] = await Promise.all([
        currentKpiTask,
        latestDateTask,
        historicalKpiTask
      ]);

      const latestDate = String(latestDateRes?.Fecha || "");
      let latestKilos = 0;
      if (latestDate) {
        if (latestCurrentSource) {
          const latestWhereSql = andExtra(latestCurrentSource.whereSql, `${latestCurrentSource.columns.fecha} = ?`);
          const latestKpiRes = await queryFirst(env, `
            SELECT COALESCE(SUM(${latestCurrentSource.columns.kilos}), 0) AS kilos
            ${latestCurrentSource.fromSql}
            ${latestWhereSql}
          `, [...latestCurrentSource.params, latestDate]);
          latestKilos = Number(latestKpiRes?.kilos || 0);
        } else {
          const latestScopeSql = andExtra(scopeCurrent.sql, "Fecha = ?");
          const latestKpiRes = await queryFirst(env, `
            SELECT COALESCE(SUM(Kilos), 0) AS kilos
            FROM ventas
            ${latestScopeSql}
          `, [...scopeCurrent.params, latestDate]);
          latestKilos = Number(latestKpiRes?.kilos || 0);
        }
      }

      return jsonPublic({
        ok: true,
        available: Boolean(runtime.hasVentas2025),
        current: {
          kilos: Number(currentKpiRes?.kilos || 0),
          clientes: Number(currentKpiRes?.clientes || 0),
          agentes: Number(currentKpiRes?.agentes || 0),
          registros: Number(currentKpiRes?.registros || 0)
        },
        compare: {
          year: compare.compareYear,
          month: compare.compareMonth,
          desde: compare.desde,
          hasta: compare.hasta,
          mode: sourceInfo.compareResponseMode,
          label: sourceInfo.compareResponseLabel,
          kilos: Number(historicalKpiRes?.kilos || 0),
          clientes: Number(historicalKpiRes?.clientes || 0),
          agentes: Number(historicalKpiRes?.agentes || 0),
          registros: Number(historicalKpiRes?.registros || 0),
          latestDate,
          latestKilos
        },
        meta: {
          appVersion: APP_VERSION,
          dataVersion: runtime.meta.dataVersion,
          selectedGroups: f.projGroups || [],
          currentSource: sourceInfo.currentSourceLabel,
          historicalSource: sourceInfo.historicalSourceLabel,
          message: runtime.hasVentas2025 ? "" : "La base historica 2025 no esta cargada en D1."
        }
      }, PROJECTION_COMPARE_TTL);
    }
  });
}
