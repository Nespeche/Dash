import { APP_VERSION } from "../../../shared/version.js";
import { PROJECTION_COMPARE_TTL } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { queryAll } from "../../lib/db.js";
import { parseFilters } from "../../lib/filters.js";
import { formatProjectionRangeLabel, parseProjectionCompareContext } from "../../lib/dates.js";
import { buildCurrentScopedSource, buildHistoricalMonthSource, buildHistoricalWhere } from "../../lib/scope.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { missingVentasMessage } from "../../lib/payloads.js";
import { PROJECTION_COMPARE_DIMS, resolveProjectionCompareSources } from "./shared.js";

function sortByKilosThenName(left = {}, right = {}, { nameKey = "name" } = {}) {
  const deltaCurrent = Number(right?.kilosActuales || 0) - Number(left?.kilosActuales || 0);
  if (deltaCurrent !== 0) return deltaCurrent;
  const deltaHistorical = Number(right?.kilos2025 || 0) - Number(left?.kilos2025 || 0);
  if (deltaHistorical !== 0) return deltaHistorical;
  return String(left?.[nameKey] || "").localeCompare(String(right?.[nameKey] || ""), "es");
}

export async function handleProjectionHierarchy(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);
  const compare = parseProjectionCompareContext(url, f);
  const compareSources = resolveProjectionCompareSources(runtime, f, compare);

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      const currentLabel = formatProjectionRangeLabel(compare.currentDesde, compare.currentHasta);

      if (!runtime.hasVentas) {
        return jsonNoStore({
          ok: true,
          available: Boolean(runtime.hasVentas2025),
          current: {
            label: currentLabel,
            kilos: 0
          },
          compare: {
            year: compare.compareYear,
            month: compare.compareMonth,
            desde: compare.desde,
            hasta: compare.hasta,
            mode: compareSources.compareResponseMode,
            label: compareSources.compareResponseLabel,
            kilos: 0
          },
          summary: {
            coordinadores: 0,
            agentes: 0,
            kilosActuales: 0,
            kilos2025: 0
          },
          groups: [],
          meta: {
            appVersion: APP_VERSION,
            dataVersion: runtime.meta.dataVersion,
            selectedGroups: f.projGroups || [],
            currentSource: compareSources.currentSourceLabel,
            historicalSource: compareSources.historicalSourceLabel,
            message: missingVentasMessage()
          }
        });
      }

      const currentSource = buildCurrentScopedSource(runtime, f, PROJECTION_COMPARE_DIMS, { factAlias: "c", dimAlias: "cs" });
      const historicalSource = compareSources.useHistoricalMonthScope
        ? buildHistoricalMonthSource(runtime, compare, f, PROJECTION_COMPARE_DIMS, { factAlias: "h", dimAlias: "hs" })
        : buildHistoricalWhere(compare, f, PROJECTION_COMPARE_DIMS);

      const historicalRowsCte = !runtime.hasVentas2025
        ? `historical_rows AS (
            SELECT CAST(NULL AS TEXT) AS Coordinador, CAST(NULL AS TEXT) AS Cod_Agente, CAST(0 AS REAL) AS Kilos2025
            WHERE 1 = 0
          )`
        : compareSources.useHistoricalMonthScope
          ? `historical_rows AS (
              SELECT
                COALESCE(NULLIF(TRIM(${historicalSource.columns.coordinador}), ''), 'Sin coordinador') AS Coordinador,
                COALESCE(NULLIF(TRIM(${historicalSource.columns.agente}), ''), '') AS Cod_Agente,
                COALESCE(SUM(${historicalSource.columns.kilos}), 0) AS Kilos2025
              ${historicalSource.fromSql}
              ${historicalSource.whereSql}
              GROUP BY 1, 2
            )`
          : `historical_rows AS (
              SELECT
                COALESCE(NULLIF(TRIM(Coordinador), ''), 'Sin coordinador') AS Coordinador,
                COALESCE(NULLIF(TRIM(Cod_Agente), ''), '') AS Cod_Agente,
                COALESCE(SUM(Kilos), 0) AS Kilos2025
              FROM ${compareSources.historicalTable}
              ${historicalSource.sql}
              GROUP BY 1, 2
            )`;

      const agentJoinSql = runtime.hasAgentesCatalogo
        ? "LEFT JOIN agentes_catalogo a ON a.Cod_Agente = j.Cod_Agente"
        : "";
      const agentNameSql = runtime.hasAgentesCatalogo
        ? "COALESCE(a.Agente, '') AS Agente"
        : "CAST('' AS TEXT) AS Agente";

      const rows = await queryAll(env, `
        WITH current_rows AS (
          SELECT
            COALESCE(NULLIF(TRIM(${currentSource.columns.coordinador}), ''), 'Sin coordinador') AS Coordinador,
            COALESCE(NULLIF(TRIM(${currentSource.columns.agente}), ''), '') AS Cod_Agente,
            COALESCE(SUM(${currentSource.columns.kilos}), 0) AS KilosActuales
          ${currentSource.fromSql}
          ${currentSource.whereSql}
          GROUP BY 1, 2
        ),
        ${historicalRowsCte},
        union_rows AS (
          SELECT Coordinador, Cod_Agente, KilosActuales, 0 AS Kilos2025
          FROM current_rows
          UNION ALL
          SELECT Coordinador, Cod_Agente, 0 AS KilosActuales, Kilos2025
          FROM historical_rows
        ),
        joined_rows AS (
          SELECT
            Coordinador,
            Cod_Agente,
            COALESCE(SUM(KilosActuales), 0) AS KilosActuales,
            COALESCE(SUM(Kilos2025), 0) AS Kilos2025
          FROM union_rows
          GROUP BY Coordinador, Cod_Agente
        )
        SELECT
          j.Coordinador,
          j.Cod_Agente,
          ${agentNameSql},
          j.KilosActuales,
          j.Kilos2025
        FROM joined_rows j
        ${agentJoinSql}
        WHERE COALESCE(j.KilosActuales, 0) <> 0 OR COALESCE(j.Kilos2025, 0) <> 0
        ORDER BY
          j.Coordinador COLLATE NOCASE ASC,
          j.KilosActuales DESC,
          j.Kilos2025 DESC,
          j.Cod_Agente COLLATE NOCASE ASC
      `, [
        ...currentSource.params,
        ...(runtime.hasVentas2025 ? historicalSource.params : [])
      ]);

      const grouped = new Map();
      rows.forEach((row) => {
        const coordinador = String(row?.Coordinador || "Sin coordinador").trim() || "Sin coordinador";
        const agente = String(row?.Cod_Agente || "").trim();
        const agenteNombre = String(row?.Agente || "").trim();
        const kilosActuales = Number(row?.KilosActuales || 0);
        const kilos2025 = Number(row?.Kilos2025 || 0);

        if (!grouped.has(coordinador)) {
          grouped.set(coordinador, {
            coordinador,
            kilosActuales: 0,
            kilos2025: 0,
            agentes: []
          });
        }

        const bucket = grouped.get(coordinador);
        bucket.kilosActuales += kilosActuales;
        bucket.kilos2025 += kilos2025;
        bucket.agentes.push({
          agente,
          agenteNombre,
          kilosActuales,
          kilos2025
        });
      });

      const groups = [...grouped.values()]
        .map((group) => ({
          ...group,
          agentes: [...group.agentes].sort((left, right) => sortByKilosThenName(left, right, { nameKey: "agente" }))
        }))
        .sort((left, right) => sortByKilosThenName(left, right, { nameKey: "coordinador" }));

      const summary = groups.reduce((acc, group) => {
        acc.coordinadores += 1;
        acc.agentes += group.agentes.length;
        acc.kilosActuales += Number(group.kilosActuales || 0);
        acc.kilos2025 += Number(group.kilos2025 || 0);
        return acc;
      }, {
        coordinadores: 0,
        agentes: 0,
        kilosActuales: 0,
        kilos2025: 0
      });

      return jsonPublic({
        ok: true,
        available: Boolean(runtime.hasVentas2025),
        current: {
          label: currentLabel,
          desde: compare.currentDesde,
          hasta: compare.currentHasta,
          kilos: Number(summary.kilosActuales || 0)
        },
        compare: {
          year: compare.compareYear,
          month: compare.compareMonth,
          desde: compare.desde,
          hasta: compare.hasta,
          mode: compareSources.compareResponseMode,
          label: compareSources.compareResponseLabel,
          kilos: Number(summary.kilos2025 || 0)
        },
        summary,
        groups,
        meta: {
          appVersion: APP_VERSION,
          dataVersion: runtime.meta.dataVersion,
          selectedGroups: f.projGroups || [],
          currentSource: compareSources.currentSourceLabel,
          historicalSource: compareSources.historicalSourceLabel,
          message: runtime.hasVentas2025 ? "" : "La base historica 2025 no esta cargada en D1."
        }
      }, PROJECTION_COMPARE_TTL);
    }
  });
}
