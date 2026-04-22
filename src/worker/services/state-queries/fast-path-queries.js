import { queryAll, queryFirst } from "../../lib/db.js";
import { getExactYearMonthKey } from "../../lib/dates.js";
import { andExtra } from "../../lib/filters.js";
import { buildCurrentDaySource, buildCurrentScopedSource } from "../../lib/scope.js";
import { queryStateOptionsBundle } from "./options-queries.js";

export async function queryCurrentMonthScopeKpis(env, runtime, f, dims = ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"]) {
  const source = buildCurrentScopedSource(runtime, f, dims, { factAlias: "m", dimAlias: "ms" });
  return queryFirst(env, `
    SELECT
      COALESCE(SUM(${source.columns.kilos}), 0) AS kilos,
      COUNT(DISTINCT NULLIF(${source.columns.cliente}, '')) AS clientes,
      COUNT(DISTINCT NULLIF(${source.columns.agente}, '')) AS agentes,
      COALESCE(SUM(${source.columns.registros}), 0) AS registros
    ${source.fromSql}
    ${source.whereSql}
  `, source.params);
}

export async function queryCurrentDayScopeKpis(env, runtime, f, dims = ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"]) {
  const source = buildCurrentDaySource(runtime, f, dims, { factAlias: "d", dimAlias: "ds" });
  return queryFirst(env, `
    SELECT
      COALESCE(SUM(${source.columns.kilos}), 0) AS kilos,
      COUNT(DISTINCT NULLIF(${source.columns.cliente}, '')) AS clientes,
      COUNT(DISTINCT NULLIF(${source.columns.agente}, '')) AS agentes,
      COALESCE(SUM(${source.columns.registros}), 0) AS registros
    ${source.fromSql}
    ${source.whereSql}
  `, source.params);
}

export async function queryCurrentMonthScopeGroupRanking(env, runtime, f, dims = ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"]) {
  const source = buildCurrentScopedSource(runtime, f, dims, { factAlias: "m", dimAlias: "ms" });
  return queryAll(env, `
    SELECT ${source.columns.grupo} AS name, COALESCE(SUM(${source.columns.kilos}), 0) AS kilos
    ${source.fromSql}
    ${andExtra(source.whereSql, `NULLIF(${source.columns.grupo}, '') IS NOT NULL`)}
    GROUP BY ${source.columns.grupo}
    ORDER BY kilos DESC, name COLLATE NOCASE ASC
  `, source.params);
}

export async function queryGlobalKpisFastPath(env, runtime) {
  if (!runtime.hasStateSnapshotGlobal) return null;
  return queryFirst(env, `
    SELECT kilos, clientes, agentes, registros
    FROM state_snapshot_global
    LIMIT 1
  `);
}

export async function queryMonthKpisFastPath(env, runtime, f) {
  const yearMonth = getExactYearMonthKey(f);
  if (!runtime.hasStateSnapshotMonth || !yearMonth) return null;
  return queryFirst(env, `
    SELECT kilos, clientes, agentes, registros
    FROM state_snapshot_month
    WHERE YearMonth = ?
    LIMIT 1
  `, [yearMonth]);
}

export async function queryGlobalGroupRankingFastPath(env, runtime) {
  if (!runtime.hasRankingGruposGlobal) return [];
  return queryAll(env, `
    SELECT name, kilos
    FROM ranking_grupos_global
    ORDER BY posicion ASC, name COLLATE NOCASE ASC
  `);
}

export async function queryMonthGroupRankingFastPath(env, runtime, f) {
  const yearMonth = getExactYearMonthKey(f);
  if (!runtime.hasRankingGruposMonth || !yearMonth) return [];
  return queryAll(env, `
    SELECT name, kilos
    FROM ranking_grupos_month
    WHERE YearMonth = ?
    ORDER BY posicion ASC, name COLLATE NOCASE ASC
  `, [yearMonth]);
}
