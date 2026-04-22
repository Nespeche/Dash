import { APP_VERSION } from "../../../shared/version.js";
import { DETAIL_PAGE_DEFAULT, STATE_TTL, SUMMARY_COLS } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { queryAll, queryFirst } from "../../lib/db.js";
import { andExtra, buildWhere, hasBusinessFilter, hasDateFilter, hasDetailGroupFilter, parseFilters } from "../../lib/filters.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { buildCurrentScopedSource, canUseCurrentPeriodScope, canUseMaterializedScope, isGlobalStateFastPath, isMonthStateFastPath } from "../../lib/scope.js";
import { summarizeDatasetMeta } from "../../lib/runtime.js";
import { buildEmptyStatePayload, missingVentasMessage } from "../../lib/payloads.js";
import {
  normalizeRankList,
  queryCurrentMonthScopeGroupRanking,
  queryCurrentMonthScopeKpis,
  queryDetailPageData,
  queryGlobalGroupRankingFastPath,
  queryGlobalKpisFastPath,
  queryMonthGroupRankingFastPath,
  queryMonthKpisFastPath,
  queryMonthStateOptionsFastPath,
  querySelectedClientOptions,
  querySelectedProductOptions,
  queryStateOptionsBundle,
  queryRegionOptions
} from "../../services/state-queries.js";

export async function handleState(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      if (!runtime.hasVentas) {
        return jsonNoStore(buildEmptyStatePayload(runtime, f, {
          warning: missingVentasMessage(),
          stateMode: "phase-6-missing-base-table"
        }));
      }

      const includeDetail = url.searchParams.get("includeDetail") === "1" && (hasBusinessFilter(f) || hasDateFilter(f) || hasDetailGroupFilter(f));
      const globalFastPath = isGlobalStateFastPath(runtime, f);
      const monthFastPath = isMonthStateFastPath(runtime, f);
      const materializedScope = canUseMaterializedScope(runtime, f);
      const currentPeriodScope = canUseCurrentPeriodScope(runtime, f);
      const currentScopeSource = currentPeriodScope
        ? buildCurrentScopedSource(runtime, f, ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"], { factAlias: "m", dimAlias: "ms" })
        : null;
      const currentScopeUsesMonthCompact = currentScopeSource?.sourceLabel === "ventas_mes_scope+ventas_scope_dim";
      const scopeFull = buildWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"]);

      // v41 FIX: when quick-group cards (detailGroups) are active, the KPI block
      // must reflect the filtered scope — not the global totals.
      // scopeKpi extends scopeFull with detailGroups so that clicking
      // "JAMONES" or "JAMONES + SALCHICHAS" updates Total Kilos, Clientes, etc.
      const hasDetailGroupActive = hasDetailGroupFilter(f);
      const scopeKpi = hasDetailGroupActive
        ? buildWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca", "codProd", "detailGroups"])
        : scopeFull;

      const [
        optionsBundleRes,
        clientesRes,
        productosRes,
        kpiRes,
        rankGrupoRes,
        detailRes,
        regionesRes
      ] = await Promise.all([
        monthFastPath
          ? queryMonthStateOptionsFastPath(env, runtime, f)
          : queryStateOptionsBundle(env, runtime, f),
        querySelectedClientOptions(env, runtime, f),
        querySelectedProductOptions(env, runtime, f),
        // v41: when detail groups are active, skip fast paths and query with scopeKpi
        hasDetailGroupActive
          ? queryFirst(env, `
                  SELECT
                    COALESCE(SUM(Kilos), 0) AS kilos,
                    COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
                    COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
                    COUNT(*) AS registros
                  FROM ventas
                  ${scopeKpi.sql}
                `, scopeKpi.params)
          : globalFastPath
            ? queryGlobalKpisFastPath(env, runtime)
            : monthFastPath
              ? queryMonthKpisFastPath(env, runtime, f)
              : currentPeriodScope
                ? queryCurrentMonthScopeKpis(env, runtime, f, ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"])
                : queryFirst(env, `
                    SELECT
                      COALESCE(SUM(Kilos), 0) AS kilos,
                      COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
                      COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
                      COUNT(*) AS registros
                    FROM ventas
                    ${scopeFull.sql}
                  `, scopeFull.params),
        // Group ranking strip always uses scopeFull (no detailGroups filter)
        // so ALL family cards remain visible for multi-selection even when one is active
        globalFastPath
          ? queryGlobalGroupRankingFastPath(env, runtime)
          : monthFastPath
            ? queryMonthGroupRankingFastPath(env, runtime, f)
            : currentPeriodScope
              ? queryCurrentMonthScopeGroupRanking(env, runtime, f, ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"])
              : queryAll(env, `
                  SELECT Grupo_Familia AS name, COALESCE(SUM(Kilos), 0) AS kilos
                  FROM ventas
                  ${andExtra(scopeFull.sql, `NULLIF(Grupo_Familia, '') IS NOT NULL`)}
                  GROUP BY Grupo_Familia
                  ORDER BY kilos DESC, name COLLATE NOCASE ASC
                `, scopeFull.params),
        includeDetail
          ? queryDetailPageData(env, runtime, f, DETAIL_PAGE_DEFAULT, 0)
          : Promise.resolve(null),
        queryRegionOptions(env, runtime, f),
      ]);

      const payload = {
        ok: true,
        period: { desde: f.desde, hasta: f.hasta },
        filters: {
          coordinador: f.coordinador,
          agente: f.agente,
          cliente: f.cliente,
          grupo: f.grupo,
          marca: f.marca,
          codProd: f.codProd
        },
        options: {
          coordinadores: (optionsBundleRes?.coordinadores || []).map(r => String(r.value || "")).filter(Boolean),
          agentes: (optionsBundleRes?.agentes || []).map(r => ({ codigo: String(r.codigo || ""), nombre: String(r.nombre || r.codigo || "") })).filter(x => x.codigo),
          clientes: (clientesRes || []).map(r => ({ codigo: String(r.codigo || ""), nombre: String(r.nombre || r.codigo || "") })).filter(x => x.codigo),
          grupos: (optionsBundleRes?.grupos || []).map(r => String(r.value || "")).filter(Boolean),
          marcas: (optionsBundleRes?.marcas || []).map(r => String(r.value || "")).filter(Boolean),
          productos: (productosRes || []).map(r => ({ codigo: String(r.codigo || ""), nombre: String(r.nombre || r.codigo || "") })).filter(x => x.codigo),
          regiones: (regionesRes || []).map(r => String(r.value || "")).filter(Boolean)
        },
        optionsMeta: {
          clientes: {
            lazy: true,
            included: Boolean(f.cliente),
            total: runtime.meta.clientesTotal
          },
          productos: {
            lazy: true,
            included: Array.isArray(f.codProd) && f.codProd.length > 0,
            total: runtime.meta.productosTotal
          }
        },
        kpis: {
          kilos: Number(kpiRes?.kilos || 0),
          clientes: Number(kpiRes?.clientes || 0),
          agentes: Number(kpiRes?.agentes || 0),
          registros: Number(kpiRes?.registros || 0)
        },
        rankings: {
          coordinadores: [],
          agentes: [],
          grupos: normalizeRankList(rankGrupoRes),
          marcas: [],
          clientes: []
        },
        charts: {
          lineMensual: []
        },
        detail: detailRes || {
          headers: SUMMARY_COLS,
          rows: [],
          total: 0,
          offset: 0,
          nextOffset: 0,
          limit: DETAIL_PAGE_DEFAULT,
          hasMore: false
        },
        meta: {
          stateMode: globalFastPath
            ? "phase-5-state-fast-path"
            : monthFastPath
              ? "phase-7-state-month-fast-path"
              : currentPeriodScope
                ? (currentScopeUsesMonthCompact ? "phase-8-state-current-month-scope" : "phase-10-state-current-period-scope")
                : materializedScope
                  ? "phase-5-state-materialized-scope"
                  : "phase-5-runtime-aligned",
          insightsDeferred: true,
          detailDeferred: (hasBusinessFilter(f) || hasDateFilter(f) || hasDetailGroupFilter(f)) && !includeDetail,
          detailEmbedded: includeDetail,
          appVersion: APP_VERSION,
          dataVersion: runtime.meta.dataVersion,
          dataset: summarizeDatasetMeta(runtime.meta),
          catalogs: {
            clientes: runtime.hasClientesCatalogo,
            productos: runtime.hasProductosCatalogo,
            agentes: runtime.hasAgentesCatalogo
          },
          materialized: {
            scopeCatalog: runtime.hasScopeCatalogo,
            stateSnapshot: runtime.hasStateSnapshotGlobal,
            rankingGrupos: runtime.hasRankingGruposGlobal,
            stateOptionsMonth: runtime.hasStateOptionsMonthGlobal,
            stateSnapshotMonth: runtime.hasStateSnapshotMonth,
            rankingGruposMonth: runtime.hasRankingGruposMonth,
            insightsRankingsMonth: runtime.hasInsightsRankingsMonth,
            ventasScopeDim: runtime.hasVentasScopeDim,
            ventasDiaScope: runtime.hasVentasDiaScope,
            ventasMesScope: runtime.hasVentasMesScope
          },
          historical: {
            ventas2025: runtime.hasVentas2025,
            ventas2025MesScope: runtime.hasVentas2025MesScope,
            ventas2025ScopeDim: runtime.hasVentas2025ScopeDim,
            ventas2025SnapshotMonth: runtime.hasVentas2025SnapshotMonth
          }
        }
      };

      return jsonPublic(payload, STATE_TTL);
    }
  });
}
