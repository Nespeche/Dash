import { APP_VERSION } from "../../../shared/version.js";
import { INSIGHTS_TTL } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { queryAll } from "../../lib/db.js";
import { andExtra, buildWhere, parseFilters } from "../../lib/filters.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { canUseCurrentPeriodScope, isMonthInsightsFastPath } from "../../lib/scope.js";
import { missingVentasMessage } from "../../lib/payloads.js";
import {
  normalizeRankList,
  queryCurrentMonthScopeInsightsPayload,
  queryDailyComparativeChartPayload,
  queryMonthInsightsPayload
} from "../../services/state-queries.js";

export async function handleInsights(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      if (!runtime.hasVentas) {
        return jsonNoStore({
          ok: true,
          rankings: {
            coordinadores: [],
            agentes: [],
            grupos: [],
            marcas: [],
            clientes: []
          },
          charts: {
            lineMensual: [],
            dailyComparative: null
          },
          meta: {
            appVersion: APP_VERSION,
            dataVersion: runtime.meta.dataVersion,
            warning: missingVentasMessage()
          }
        });
      }

      const monthInsightsFastPath = isMonthInsightsFastPath(runtime, f);
      const currentPeriodScope = canUseCurrentPeriodScope(runtime, f);

      if (monthInsightsFastPath) {
        const payload = await queryMonthInsightsPayload(env, runtime, f);
        return jsonPublic(payload, INSIGHTS_TTL);
      }

      if (currentPeriodScope) {
        const payload = await queryCurrentMonthScopeInsightsPayload(env, runtime, f);
        return jsonPublic(payload, INSIGHTS_TTL);
      }

      const scopeFull = buildWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"]);
      const [
        rankCoordRes,
        rankAgteRes,
        rankGrupoRes,
        rankMarcaRes,
        rankClientesRes,
        chartRes,
        dailyComparative
      ] = await Promise.all([
        queryAll(env, `
          SELECT Coordinador AS name, COALESCE(SUM(Kilos), 0) AS kilos
          FROM ventas
          ${andExtra(scopeFull.sql, `NULLIF(Coordinador, '') IS NOT NULL`)}
          GROUP BY Coordinador
          ORDER BY kilos DESC, name COLLATE NOCASE ASC
        `, scopeFull.params),
        queryAll(env, `
          SELECT Agente AS name, COALESCE(SUM(Kilos), 0) AS kilos
          FROM ventas
          ${andExtra(scopeFull.sql, `NULLIF(Agente, '') IS NOT NULL`)}
          GROUP BY Agente
          ORDER BY kilos DESC, name COLLATE NOCASE ASC
        `, scopeFull.params),
        queryAll(env, `
          SELECT Grupo_Familia AS name, COALESCE(SUM(Kilos), 0) AS kilos
          FROM ventas
          ${andExtra(scopeFull.sql, `NULLIF(Grupo_Familia, '') IS NOT NULL`)}
          GROUP BY Grupo_Familia
          ORDER BY kilos DESC, name COLLATE NOCASE ASC
        `, scopeFull.params),
        queryAll(env, `
          SELECT Marca AS name, COALESCE(SUM(Kilos), 0) AS kilos
          FROM ventas
          ${andExtra(scopeFull.sql, `NULLIF(Marca, '') IS NOT NULL`)}
          GROUP BY Marca
          ORDER BY kilos DESC, name COLLATE NOCASE ASC
        `, scopeFull.params),
        queryAll(env, `
          SELECT
            Cod_Cliente AS codigo,
            MIN(Cliente) AS nombre,
            MIN(Coordinador) AS coordinador,
            MIN(Agente) AS agente,
            COALESCE(SUM(Kilos), 0) AS kilos
          FROM ventas
          ${andExtra(scopeFull.sql, `NULLIF(Cod_Cliente, '') IS NOT NULL`)}
          GROUP BY Cod_Cliente
          ORDER BY kilos DESC, nombre COLLATE NOCASE ASC
          LIMIT 20
        `, scopeFull.params),
        queryAll(env, `
          SELECT substr(Fecha, 1, 7) AS periodo, COALESCE(SUM(Kilos), 0) AS kilos
          FROM ventas
          ${scopeFull.sql}
          GROUP BY substr(Fecha, 1, 7)
          ORDER BY periodo ASC
        `, scopeFull.params),
        queryDailyComparativeChartPayload(env, runtime, f)
      ]);

      const payload = {
        ok: true,
        rankings: {
          coordinadores: normalizeRankList(rankCoordRes),
          agentes: normalizeRankList(rankAgteRes),
          grupos: normalizeRankList(rankGrupoRes),
          marcas: normalizeRankList(rankMarcaRes),
          clientes: (rankClientesRes || []).map(r => ({
            codigo: String(r.codigo || ""),
            nombre: String(r.nombre || r.codigo || ""),
            coordinador: String(r.coordinador || ""),
            agente: String(r.agente || ""),
            kilos: Number(r.kilos || 0)
          }))
        },
        charts: {
          lineMensual: (chartRes || []).map(r => ({ periodo: String(r.periodo || ""), kilos: Number(r.kilos || 0) })),
          dailyComparative
        },
        meta: {
          appVersion: APP_VERSION,
          dataVersion: runtime.meta.dataVersion,
          insightsMode: "phase-7-runtime"
        }
      };

      return jsonPublic(payload, INSIGHTS_TTL);
    }
  });
}
