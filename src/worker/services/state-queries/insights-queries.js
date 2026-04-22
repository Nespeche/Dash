import { APP_VERSION } from "../../../shared/version.js";
import { queryAll } from "../../lib/db.js";
import { daysInMonthUtc, getExactYearMonthKey, monthNameEs, parseIsoDateParts, yearMonthKey } from "../../lib/dates.js";
import { andExtra } from "../../lib/filters.js";
import { buildBusinessWhere, buildCurrentScopedSource, hasCompactVentasDiaScope } from "../../lib/scope.js";
import { normalizeRankList } from "./common.js";
import { queryMonthKpisFastPath } from "./fast-path-queries.js";

function shiftMonth(year, month, delta) {
  const absolute = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = (absolute % 12 + 12) % 12 + 1;
  return { year: nextYear, month: nextMonth };
}

function shortMonthLabel(year, month) {
  return `${monthNameEs(month).slice(0, 3)} ${year}`;
}

function buildDailyCompareContext(f) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const anchorIso = String(f?.hasta || f?.desde || todayIso).trim();
  const anchorParts = parseIsoDateParts(anchorIso) || parseIsoDateParts(todayIso) || { year: 2026, month: 1, day: 1 };
  const anchorMonthDays = daysInMonthUtc(anchorParts.year, anchorParts.month);
  const desdeParts = parseIsoDateParts(f?.desde || "");
  const hastaParts = parseIsoDateParts(f?.hasta || "");

  let dayStart = 1;
  let dayEnd = anchorMonthDays;

  if (desdeParts && hastaParts && desdeParts.year === hastaParts.year && desdeParts.month === hastaParts.month && desdeParts.year === anchorParts.year && desdeParts.month === anchorParts.month) {
    dayStart = Math.max(1, Math.min(anchorMonthDays, desdeParts.day));
    dayEnd = Math.max(dayStart, Math.min(anchorMonthDays, hastaParts.day));
  } else if (hastaParts && hastaParts.year === anchorParts.year && hastaParts.month === anchorParts.month) {
    dayEnd = Math.max(1, Math.min(anchorMonthDays, hastaParts.day));
    if (desdeParts && desdeParts.year === anchorParts.year && desdeParts.month === anchorParts.month) {
      dayStart = Math.max(1, Math.min(dayEnd, desdeParts.day));
    }
  }

  const months = [0, -1, -2].map(delta => {
    const parts = shiftMonth(anchorParts.year, anchorParts.month, delta);
    return {
      ...parts,
      key: yearMonthKey(parts.year, parts.month),
      label: shortMonthLabel(parts.year, parts.month),
      daysInMonth: daysInMonthUtc(parts.year, parts.month)
    };
  });

  return {
    anchor: months[0],
    months,
    dayWindow: {
      start: dayStart,
      end: dayEnd
    },
    range: {
      desde: `${months[2].key}-01`,
      hasta: `${months[0].key}-${String(months[0].daysInMonth).padStart(2, "0")}`
    }
  };
}

export async function queryDailyComparativeChartPayload(env, runtime, f) {
  const context = buildDailyCompareContext(f);
  const dims = ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"];

  let fromSql = "";
  let columns = {};
  let where = [];
  let params = [];

  if (hasCompactVentasDiaScope(runtime)) {
    fromSql = "FROM ventas_dia_scope d INNER JOIN ventas_scope_dim ds ON ds.scope_id = d.scope_id";
    columns = {
      fecha: "d.Fecha",
      yearMonth: "d.YearMonth",
      kilos: "d.Kilos",
      coordinador: "ds.Coordinador",
      agente: "ds.Cod_Agente",
      cliente: "ds.Cod_Cliente",
      grupo: "ds.Grupo_Familia",
      marca: "ds.Marca",
      codProd: "ds.Cod_Producto"
    };
  } else {
    fromSql = "FROM ventas v";
    columns = {
      fecha: "v.Fecha",
      yearMonth: "substr(v.Fecha, 1, 7)",
      kilos: "v.Kilos",
      coordinador: "v.Coordinador",
      agente: "v.Cod_Agente",
      cliente: "v.Cod_Cliente",
      grupo: "v.Grupo_Familia",
      marca: "v.Marca",
      codProd: "v.Cod_Producto"
    };
  }

  where.push(`${columns.fecha} >= ?`);
  params.push(context.range.desde);
  where.push(`${columns.fecha} <= ?`);
  params.push(context.range.hasta);

  const business = buildBusinessWhere(f, dims, columns);
  if (business.sql) {
    where.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }

  const rows = await queryAll(env, `
    SELECT
      ${columns.yearMonth} AS periodo,
      CAST(substr(${columns.fecha}, 9, 2) AS INTEGER) AS dia,
      COALESCE(SUM(${columns.kilos}), 0) AS kilos
    ${fromSql}
    WHERE ${where.join(" AND ")}
    GROUP BY periodo, dia
    ORDER BY periodo ASC, dia ASC
  `, params);

  const grouped = new Map();
  for (const row of rows || []) {
    const periodKey = String(row?.periodo || "");
    if (!grouped.has(periodKey)) grouped.set(periodKey, []);
    grouped.get(periodKey).push({
      day: Number(row?.dia || 0),
      kilos: Number(row?.kilos || 0)
    });
  }

  return {
    referenceLabel: context.anchor.label,
    rangeLabel: context.dayWindow.start === 1 && context.dayWindow.end === context.anchor.daysInMonth
      ? "Mes completo"
      : `Días ${context.dayWindow.start}-${context.dayWindow.end}`,
    dayWindow: context.dayWindow,
    series: context.months.map(month => ({
      key: month.key,
      label: month.label,
      values: (grouped.get(month.key) || []).filter(point => point.day >= context.dayWindow.start && point.day <= Math.min(context.dayWindow.end, month.daysInMonth))
    }))
  };
}

export async function queryMonthInsightsRowsFastPath(env, runtime, f) {
  const yearMonth = getExactYearMonthKey(f);
  if (!runtime.hasInsightsRankingsMonth || !yearMonth) return [];
  return queryAll(env, `
    SELECT kind, posicion, codigo, name, coordinador, agente, kilos
    FROM insights_rankings_month
    WHERE YearMonth = ?
    ORDER BY kind COLLATE NOCASE ASC, posicion ASC, name COLLATE NOCASE ASC
  `, [yearMonth]);
}

export async function queryMonthInsightsPayload(env, runtime, f) {
  const yearMonth = getExactYearMonthKey(f);
  const [rows, monthKpis, dailyComparative] = await Promise.all([
    queryMonthInsightsRowsFastPath(env, runtime, f),
    queryMonthKpisFastPath(env, runtime, f),
    queryDailyComparativeChartPayload(env, runtime, f)
  ]);

  const payload = {
    ok: true,
    rankings: {
      coordinadores: [],
      agentes: [],
      grupos: [],
      marcas: [],
      clientes: []
    },
    charts: {
      lineMensual: yearMonth && monthKpis
        ? [{ periodo: yearMonth, kilos: Number(monthKpis.kilos || 0) }]
        : [],
      dailyComparative
    },
    meta: {
      appVersion: APP_VERSION,
      dataVersion: runtime.meta.dataVersion,
      insightsMode: "phase-7-month-fast-path"
    }
  };

  for (const row of (rows || [])) {
    const kind = String(row?.kind || "");
    if (kind === "coordinador") {
      payload.rankings.coordinadores.push({ name: String(row?.name || ""), kilos: Number(row?.kilos || 0) });
    } else if (kind === "agente") {
      payload.rankings.agentes.push({ name: String(row?.name || ""), kilos: Number(row?.kilos || 0) });
    } else if (kind === "grupo") {
      payload.rankings.grupos.push({ name: String(row?.name || ""), kilos: Number(row?.kilos || 0) });
    } else if (kind === "marca") {
      payload.rankings.marcas.push({ name: String(row?.name || ""), kilos: Number(row?.kilos || 0) });
    } else if (kind === "cliente") {
      payload.rankings.clientes.push({
        codigo: String(row?.codigo || ""),
        nombre: String(row?.name || row?.codigo || ""),
        coordinador: String(row?.coordinador || ""),
        agente: String(row?.agente || ""),
        kilos: Number(row?.kilos || 0)
      });
    }
  }

  return payload;
}

export async function queryCurrentMonthScopeInsightsPayload(env, runtime, f) {
  const source = buildCurrentScopedSource(runtime, f, ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"], { factAlias: "m", dimAlias: "ms" });
  const insightsMode = source.sourceLabel === "ventas_mes_scope+ventas_scope_dim"
    ? "phase-8-current-month-scope"
    : source.sourceLabel === "ventas_dia_scope+ventas_scope_dim"
      ? "phase-10-current-day-scope"
      : "phase-10-current-period-scope";
  const agentJoin = `${source.fromSql} LEFT JOIN agentes_catalogo a ON a.Cod_Agente = ${source.columns.agente}`;
  const clientJoin = `${source.fromSql} LEFT JOIN clientes_catalogo c ON c.Cod_Cliente = ${source.columns.cliente}`;

  const [rankCoordRes, rankAgteRes, rankGrupoRes, rankMarcaRes, rankClientesRes, chartRes, dailyComparative] = await Promise.all([
    queryAll(env, `
      SELECT ${source.columns.coordinador} AS name, COALESCE(SUM(${source.columns.kilos}), 0) AS kilos
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.coordinador}, '') IS NOT NULL`)}
      GROUP BY ${source.columns.coordinador}
      ORDER BY kilos DESC, name COLLATE NOCASE ASC
    `, source.params),
    queryAll(env, `
      SELECT COALESCE(MIN(a.Agente), ${source.columns.agente}) AS name, COALESCE(SUM(${source.columns.kilos}), 0) AS kilos
      ${agentJoin}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.agente}, '') IS NOT NULL`)}
      GROUP BY ${source.columns.agente}
      ORDER BY kilos DESC, name COLLATE NOCASE ASC
    `, source.params),
    queryAll(env, `
      SELECT ${source.columns.grupo} AS name, COALESCE(SUM(${source.columns.kilos}), 0) AS kilos
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.grupo}, '') IS NOT NULL`)}
      GROUP BY ${source.columns.grupo}
      ORDER BY kilos DESC, name COLLATE NOCASE ASC
    `, source.params),
    queryAll(env, `
      SELECT ${source.columns.marca} AS name, COALESCE(SUM(${source.columns.kilos}), 0) AS kilos
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.marca}, '') IS NOT NULL`)}
      GROUP BY ${source.columns.marca}
      ORDER BY kilos DESC, name COLLATE NOCASE ASC
    `, source.params),
    queryAll(env, `
      SELECT
        ${source.columns.cliente} AS codigo,
        COALESCE(MIN(c.Cliente), ${source.columns.cliente}) AS nombre,
        MIN(${source.columns.coordinador}) AS coordinador,
        COALESCE(MIN(a.Agente), MIN(${source.columns.agente})) AS agente,
        COALESCE(SUM(${source.columns.kilos}), 0) AS kilos
      ${clientJoin}
      LEFT JOIN agentes_catalogo a ON a.Cod_Agente = ${source.columns.agente}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.cliente}, '') IS NOT NULL`)}
      GROUP BY ${source.columns.cliente}
      ORDER BY kilos DESC, nombre COLLATE NOCASE ASC
      LIMIT 20
    `, source.params),
    queryAll(env, `
      SELECT ${source.columns.yearMonth} AS periodo, COALESCE(SUM(${source.columns.kilos}), 0) AS kilos
      ${source.fromSql}
      ${source.whereSql}
      GROUP BY ${source.columns.yearMonth}
      ORDER BY periodo ASC
    `, source.params),
    queryDailyComparativeChartPayload(env, runtime, f)
  ]);

  return {
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
      insightsMode
    }
  };
}
