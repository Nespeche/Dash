// =============================================================
// accum-summary-handler.js (v33)
// Endpoint: GET /api/accum-summary
//
// Resumen acumulado ejecutivo, centrado en 4 dimensiones de negocio:
// coordinador | agente | grupo | region
//
// Modos disponibles:
//   running  — respeta período + filtros globales (caché 60 s)
//   total    — toda la base 2026, ignora sólo fechas (caché 300 s)
//   ytd      — YTD desde 01-Ene hasta última fecha disponible vs mismo rango 2025 (caché 180 s)
//   compare  — período del filtro actual vs mismo período de 2025 (caché 180 s)
//
// v33 sobre v32:
//   - Nuevo modo "compare": compara el rango de fecha del filtro activo
//     contra el mismo rango del año anterior (ventas_2025).
//     Si no hay filtro de fecha, usa el mes actual del dataset.
//   - Cache HTTP via respondWithVersionedCache + jsonPublic (antes: no-store).
//   - buildYtdCompare() lee runtime.meta.maxFecha en lugar de hacer
//     un SELECT MAX(Fecha) adicional.
//   - Helper fmtPeriodLabel() devuelve etiquetas legibles para el frontend
//     (ej: "Ene 2026", "Mar–May 2026").
// =============================================================
import { APP_VERSION } from "../../../shared/version.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { queryAll, queryFirst } from "../../lib/db.js";
import { parseFilters } from "../../lib/filters.js";
import {
  buildBusinessWhere,
  buildCurrentScopedSource,
  buildHistoricalMonthSource,
  canUseHistoricalMonthScope,
  hasCompactVentasMesScope
} from "../../lib/scope.js";

// ─── Constantes ──────────────────────────────────────────────
const ALLOWED_VIEWS = new Set(["coordinador", "agente", "grupo", "region"]);
const ALLOWED_MODES = new Set(["running", "total", "ytd", "compare"]);
const MAX_ROWS = 500;
const BUSINESS_DIMS = ["coordinador", "agente", "cliente", "grupo", "marca", "codProd", "detailGroups", "projGroups"];
const RAW_DIMS = [...BUSINESS_DIMS, "region"];

// TTL de caché por modo (segundos)
const CACHE_TTL = {
  running: 60,
  total:   300,
  ytd:     180,
  compare: 180
};

// Nombres abreviados de mes para labels
const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
                    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// ─── Parsers de URL ──────────────────────────────────────────
function pickView(url) {
  const raw = String(url.searchParams.get("view") || "grupo").toLowerCase();
  return ALLOWED_VIEWS.has(raw) ? raw : "grupo";
}

function pickMode(url) {
  const raw = String(url.searchParams.get("mode") || "running").toLowerCase();
  return ALLOWED_MODES.has(raw) ? raw : "running";
}

function pickLimit(url, def = 120) {
  const n = Number(url.searchParams.get("limit") || def);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(MAX_ROWS, Math.max(10, Math.floor(n)));
}

// ─── Helpers ─────────────────────────────────────────────────

/** Devuelve true cuando la vista o los filtros requieren la tabla ventas raw (tiene columna Region). */
function needsRawSource(view, filters) {
  return view === "region" || Boolean(filters?.region);
}

/**
 * Formatea un rango de fechas como etiqueta legible para el frontend.
 * Ejemplos:
 *   "2026-01-01" - "2026-01-31"  ->  "Ene 2026"
 *   "2026-01-01" - "2026-03-31"  ->  "Ene-Mar 2026"
 *   "2026-01-15" - "2026-01-20"  ->  "15-20 Ene 2026"
 */
function fmtPeriodLabel(desde, hasta) {
  if (!desde || !hasta) return "";
  const dy = Number(desde.slice(0, 4)), dm = Number(desde.slice(5, 7)), dd = Number(desde.slice(8, 10));
  const hy = Number(hasta.slice(0, 4)), hm = Number(hasta.slice(5, 7)), hd = Number(hasta.slice(8, 10));
  if (dy === hy) {
    if (dm === hm) {
      const daysInMonth = new Date(dy, dm, 0).getDate();
      if (dd === 1 && hd === daysInMonth) return `${MONTH_ABBR[dm - 1]} ${dy}`;
      return `${dd}-${hd} ${MONTH_ABBR[dm - 1]} ${dy}`;
    }
    return `${MONTH_ABBR[dm - 1]}-${MONTH_ABBR[hm - 1]} ${dy}`;
  }
  return `${desde} / ${hasta}`;
}

// ─── Builders de fuente de datos ─────────────────────────────

function buildRawCurrentSource(filters, { ignoreDate = false } = {}) {
  const columns = {
    fecha:       "v.Fecha",
    coordinador: "v.Coordinador",
    agente:      "v.Cod_Agente",
    agenteName:  "v.Agente",
    cliente:     "v.Cod_Cliente",
    grupo:       "v.Grupo_Familia",
    marca:       "v.Marca",
    codProd:     "v.Cod_Producto",
    region:      "v.Region",
    kilos:       "v.Kilos"
  };
  const where = [];
  const params = [];
  if (!ignoreDate && filters?.desde) { where.push("v.Fecha >= ?"); params.push(filters.desde); }
  if (!ignoreDate && filters?.hasta) { where.push("v.Fecha <= ?"); params.push(filters.hasta); }
  const business = buildBusinessWhere(filters, RAW_DIMS, columns);
  if (business.sql) {
    where.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }
  return {
    fromSql:     "FROM ventas v",
    whereSql:    where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    columns,
    sourceLabel: ignoreDate ? "ventas:all-current" : "ventas:filtered-current"
  };
}

function buildRawHistoricalSource(compare, filters) {
  const columns = {
    fecha:       "h.Fecha",
    coordinador: "h.Coordinador",
    agente:      "h.Cod_Agente",
    agenteName:  "h.Agente",
    cliente:     "h.Cod_Cliente",
    grupo:       "h.Grupo_Familia",
    marca:       "h.Marca",
    codProd:     "h.Cod_Producto",
    region:      "h.Region",
    kilos:       "h.Kilos"
  };
  const where = ["h.Fecha >= ?", "h.Fecha <= ?"];
  const params = [compare.desde, compare.hasta];
  const business = buildBusinessWhere(filters, RAW_DIMS, columns);
  if (business.sql) {
    where.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }
  return {
    fromSql:     "FROM ventas_2025 h",
    whereSql:    `WHERE ${where.join(" AND ")}`,
    params,
    columns,
    sourceLabel: "ventas_2025:raw-range"
  };
}

function buildCurrentAllMonthsSource(runtime, filters) {
  if (!hasCompactVentasMesScope(runtime) || filters?.region) {
    return buildRawCurrentSource(filters, { ignoreDate: true });
  }
  const columns = {
    coordinador: "sd.Coordinador",
    agente:      "sd.Cod_Agente",
    cliente:     "sd.Cod_Cliente",
    grupo:       "sd.Grupo_Familia",
    marca:       "sd.Marca",
    codProd:     "sd.Cod_Producto",
    kilos:       "m.Kilos"
  };
  const business = buildBusinessWhere(filters, BUSINESS_DIMS, columns);
  return {
    fromSql:     "FROM ventas_mes_scope m INNER JOIN ventas_scope_dim sd ON sd.scope_id = m.scope_id",
    whereSql:    business.sql,
    params:      business.params,
    columns,
    sourceLabel: "ventas_mes_scope+ventas_scope_dim:all-current"
  };
}

function buildCurrentRangeSource(runtime, filters, view) {
  if (needsRawSource(view, filters)) {
    return buildRawCurrentSource(filters, { ignoreDate: false });
  }
  if (!filters?.desde && !filters?.hasta) {
    return buildCurrentAllMonthsSource(runtime, filters);
  }
  return buildCurrentScopedSource(runtime, filters, BUSINESS_DIMS, { factAlias: "s", dimAlias: "ss" });
}

function buildCurrentTotalSource(runtime, filters, view) {
  if (needsRawSource(view, filters)) {
    return buildRawCurrentSource(filters, { ignoreDate: true });
  }
  return buildCurrentAllMonthsSource(runtime, filters);
}

function buildYtdCurrentSource(runtime, filters, view, compare) {
  const ytdFilters = { ...filters, desde: compare.actual.desde, hasta: compare.actual.hasta };
  if (needsRawSource(view, filters)) {
    return buildRawCurrentSource(ytdFilters, { ignoreDate: false });
  }
  return buildCurrentScopedSource(runtime, ytdFilters, BUSINESS_DIMS, { factAlias: "s", dimAlias: "ss" });
}

function buildYtdHistoricalSource(runtime, filters, view, compare) {
  if (needsRawSource(view, filters)) {
    return buildRawHistoricalSource(compare.historico, filters);
  }
  if (canUseHistoricalMonthScope(runtime, compare.historico)) {
    return buildHistoricalMonthSource(runtime, compare.historico, filters, BUSINESS_DIMS, { factAlias: "h", dimAlias: "hs" });
  }
  return buildRawHistoricalSource(compare.historico, filters);
}

// ─── Config de vista (GROUP BY / SELECT expressions) ─────────

function buildViewSqlConfig(view, source, runtime) {
  const trim  = expr => `NULLIF(TRIM(COALESCE(${expr}, '')), '')`;
  const clean = (expr, fallback) => `COALESCE(${trim(expr)}, ${fallback})`;

  switch (view) {
    case "coordinador": {
      const nameExpr = clean(source.columns.coordinador, "'Sin coordinador'");
      return { codeExpr: "NULL", nameExpr, groupExprs: [nameExpr], joinSql: "" };
    }
    case "agente": {
      const codeExpr  = clean(source.columns.agente, "'Sin agente'");
      const joinSql   = runtime?.hasAgentesCatalogo && source.columns.agente
        ? `LEFT JOIN agentes_catalogo ac ON ac.Cod_Agente = ${source.columns.agente}`
        : "";
      const preferredNameExpr = source.columns.agenteName ? trim(source.columns.agenteName) : "NULL";
      const catalogNameExpr   = joinSql ? trim("ac.Agente") : "NULL";
      const nameExpr = `COALESCE(${catalogNameExpr}, ${preferredNameExpr}, ${codeExpr}, 'Sin agente')`;
      return { codeExpr, nameExpr, groupExprs: [codeExpr, nameExpr], joinSql };
    }
    case "region": {
      const nameExpr = clean(source.columns.region || "NULL", "'Sin region'");
      return { codeExpr: "NULL", nameExpr, groupExprs: [nameExpr], joinSql: "" };
    }
    case "grupo":
    default: {
      const nameExpr = clean(source.columns.grupo, "'Sin familia'");
      return { codeExpr: "NULL", nameExpr, groupExprs: [nameExpr], joinSql: "" };
    }
  }
}

// ─── Normalización de filas ───────────────────────────────────

function normalizeSummaryRows(rows = []) {
  return rows.map(row => {
    const codigo = row?.codigo == null ? "" : String(row.codigo || "").trim();
    const nombre = String(row?.nombre || "").trim();
    const kilos  = Number(row?.kilos || 0);
    const total  = Number(row?.total_kilos || 0);
    const pct    = total > 0 ? +((kilos / total) * 100).toFixed(2) : 0;
    return {
      codigo,
      nombre,
      label: codigo && nombre && codigo !== nombre ? `${codigo} · ${nombre}` : (nombre || codigo || "Sin dato"),
      kilos,
      pct
    };
  });
}

// ─── Query agrupado genérico ──────────────────────────────────

async function queryGroupedSource(env, view, runtime, source) {
  const cfg = buildViewSqlConfig(view, source, runtime);
  const sql = `
    WITH grouped AS (
      SELECT
        ${cfg.codeExpr} AS codigo,
        ${cfg.nameExpr} AS nombre,
        SUM(${source.columns.kilos}) AS kilos
      ${source.fromSql}
      ${cfg.joinSql}
      ${source.whereSql}
      GROUP BY ${cfg.groupExprs.join(", ")}
    )
    SELECT
      codigo,
      nombre,
      kilos,
      SUM(kilos) OVER () AS total_kilos
    FROM grouped
    ORDER BY kilos DESC, nombre ASC`;
  const rows = await queryAll(env, sql, source.params || []);
  return normalizeSummaryRows(rows);
}

// ─── Merge de filas comparativas (actual vs histórico) ────────

function mergeCompareRows(currentRows, historicalRows, limit) {
  const histByKey = new Map();
  historicalRows.forEach(row => {
    const key = String(row.codigo || row.nombre || row.label || "");
    if (key) histByKey.set(key, row);
  });

  const seen = new Set();
  const totalActual    = currentRows.reduce((acc, r) => acc + Number(r.kilos || 0), 0);
  const totalHistorico = historicalRows.reduce((acc, r) => acc + Number(r.kilos || 0), 0);

  const merged = currentRows.map(row => {
    const key       = String(row.codigo || row.nombre || row.label || "");
    seen.add(key);
    const hist      = histByKey.get(key);
    const kilos     = Number(row.kilos || 0);
    const kilos_ant = Number(hist?.kilos || 0);
    const diff      = kilos - kilos_ant;
    return {
      codigo:        row.codigo,
      nombre:        row.nombre,
      label:         row.label,
      kilos,
      kilos_ant,
      diff,
      pct:           kilos_ant > 0
                       ? +(((kilos - kilos_ant) / kilos_ant) * 100).toFixed(2)
                       : (kilos > 0 ? null : 0),
      participacion: totalActual > 0 ? +((kilos / totalActual) * 100).toFixed(2) : 0,
      perdido:       false
    };
  });

  historicalRows.forEach(row => {
    const key = String(row.codigo || row.nombre || row.label || "");
    if (!key || seen.has(key)) return;
    const kilos_ant = Number(row.kilos || 0);
    merged.push({
      codigo:        row.codigo,
      nombre:        row.nombre,
      label:         row.label,
      kilos:         0,
      kilos_ant,
      diff:          -kilos_ant,
      pct:           -100,
      participacion: 0,
      perdido:       true
    });
  });

  merged.sort((a, b) =>
    Number(b.kilos || 0) - Number(a.kilos || 0) ||
    String(a.label || "").localeCompare(String(b.label || ""), "es")
  );

  return {
    rows:   merged.slice(0, limit),
    totals: { actual: totalActual, historico: totalHistorico }
  };
}

// ─── Builders de rangos de comparación ───────────────────────

/**
 * Rangos para modo YTD (01-Ene → maxFecha vs mismo rango 2025).
 * Usa runtime.meta.maxFecha para evitar SELECT MAX() adicional;
 * acepta el valor crudo como parámetro (puede venir de fallback DB).
 */
function buildYtdCompare(maxF) {
  if (!maxF) return null;
  const yearActual  = String(maxF).slice(0, 4);
  const hastaActual = String(maxF);
  const desdeActual = `${yearActual}-01-01`;
  const desdeHist   = "2025-01-01";
  const hastaHist   = `2025-${hastaActual.slice(5, 10)}`;
  const histMonthKeys = [];
  for (let month = 1; month <= Number(hastaActual.slice(5, 7)); month++) {
    histMonthKeys.push(`2025-${String(month).padStart(2, "0")}`);
  }
  return {
    actual:   { desde: desdeActual, hasta: hastaActual },
    historico: {
      desde:         desdeHist,
      hasta:         hastaHist,
      compareYear:   2025,
      compareMonth:  Number(hastaHist.slice(5, 7)),
      yearMonthKeys: histMonthKeys
    },
    yearActual: Number(yearActual)
  };
}

/**
 * Rangos para modo compare (período del filtro vs mismo período -1 año).
 * Si no hay filtro de fecha activo, usa el mes en curso del dataset.
 */
function buildCompareRange(filters, runtime) {
  const maxF = runtime?.meta?.maxFecha || null;

  let desdeActual = filters?.desde || null;
  let hastaActual = filters?.hasta || null;

  if (!desdeActual || !hastaActual) {
    if (!maxF) return null;
    const ym    = maxF.slice(0, 7);
    desdeActual = `${ym}-01`;
    hastaActual = maxF;
  }

  const yearActual = Number(desdeActual.slice(0, 4));
  const desdeHist  = `${yearActual - 1}${desdeActual.slice(4)}`;
  const hastaHist  = `${yearActual - 1}${hastaActual.slice(4)}`;

  return {
    actual:    { desde: desdeActual, hasta: hastaActual },
    historico: { desde: desdeHist,   hasta: hastaHist },
    yearActual
  };
}

// ─── Funciones de query por modo ─────────────────────────────

async function queryRunning(env, runtime, filters, view, limit) {
  const source = buildCurrentRangeSource(runtime, filters, view);
  const rows   = await queryGroupedSource(env, view, runtime, source);
  const sliced = rows.slice(0, limit);
  return {
    rows:        sliced,
    totalKilos:  rows.reduce((acc, r) => acc + Number(r.kilos || 0), 0),
    sourceLabel: source.sourceLabel
  };
}

async function queryTotal(env, runtime, filters, view, limit) {
  const source = buildCurrentTotalSource(runtime, filters, view);
  const rows   = await queryGroupedSource(env, view, runtime, source);
  const sliced = rows.slice(0, limit);
  return {
    rows:        sliced,
    totalKilos:  rows.reduce((acc, r) => acc + Number(r.kilos || 0), 0),
    sourceLabel: source.sourceLabel
  };
}

async function queryYtd(env, runtime, filters, view, limit) {
  // Preferir runtime.meta para evitar query adicional a la DB
  let maxF = runtime?.meta?.maxFecha || null;
  if (!maxF) {
    const meta = await queryFirst(env, "SELECT MAX(Fecha) AS maxF FROM ventas", []);
    maxF = meta?.maxF || null;
  }

  const compare = buildYtdCompare(maxF);
  if (!compare) {
    return { rows: [], totals: { actual: 0, historico: 0 }, range: null, periodLabels: null, sourceLabel: "empty" };
  }

  const currentSource    = buildYtdCurrentSource(runtime, filters, view, compare);
  const historicalSource = buildYtdHistoricalSource(runtime, filters, view, compare);

  const [currentRows, historicalRows] = await Promise.all([
    queryGroupedSource(env, view, runtime, currentSource),
    queryGroupedSource(env, view, runtime, historicalSource)
  ]);

  const merged = mergeCompareRows(currentRows, historicalRows, limit);
  return {
    rows:   merged.rows,
    totals: merged.totals,
    range: {
      actual:     compare.actual,
      historico:  compare.historico,
      yearActual: compare.yearActual
    },
    periodLabels: {
      actual:    fmtPeriodLabel(compare.actual.desde, compare.actual.hasta),
      historico: fmtPeriodLabel(compare.historico.desde, compare.historico.hasta)
    },
    sourceLabel: `${currentSource.sourceLabel} vs ${historicalSource.sourceLabel}`
  };
}

async function queryCompare(env, runtime, filters, view, limit) {
  const compareRange = buildCompareRange(filters, runtime);
  if (!compareRange) {
    return { rows: [], totals: { actual: 0, historico: 0 }, range: null, periodLabels: null, sourceLabel: "empty" };
  }

  // Fuente actual con las fechas del rango computado + demás filtros de dimensión
  const currentFilters   = { ...filters, desde: compareRange.actual.desde, hasta: compareRange.actual.hasta };
  const currentSource    = buildCurrentRangeSource(runtime, currentFilters, view);

  // Fuente histórica: siempre raw contra ventas_2025 (necesita columna Region)
  const historicalSource = buildRawHistoricalSource(compareRange.historico, filters);

  const [currentRows, historicalRows] = await Promise.all([
    queryGroupedSource(env, view, runtime, currentSource),
    queryGroupedSource(env, view, runtime, historicalSource)
  ]);

  const merged = mergeCompareRows(currentRows, historicalRows, limit);
  return {
    rows:   merged.rows,
    totals: merged.totals,
    range:  compareRange,
    periodLabels: {
      actual:    fmtPeriodLabel(compareRange.actual.desde, compareRange.actual.hasta),
      historico: fmtPeriodLabel(compareRange.historico.desde, compareRange.historico.hasta)
    },
    sourceLabel: `${currentSource.sourceLabel} vs ${historicalSource.sourceLabel}`
  };
}

// ─── Handler principal ────────────────────────────────────────

export async function handleAccumSummary(url, env, ctx, request) {
  try {
    const runtime     = await resolveRuntimeContext(env);
    const filters     = parseFilters(url);
    const view        = pickView(url);
    const mode        = pickMode(url);
    const limit       = pickLimit(url);
    const dataVersion = runtime?.meta?.dataVersion || "legacy";
    const ttl         = CACHE_TTL[mode] ?? 60;

    return await respondWithVersionedCache({
      request,
      url,
      dataVersion,
      ctx,
      build: async () => {
        let payload;

        if (mode === "running") {
          const result = await queryRunning(env, runtime, filters, view, limit);
          payload = {
            ok:          true,
            mode,
            view,
            rows:        result.rows,
            count:       result.rows.length,
            totalKilos:  result.totalKilos,
            sourceLabel: result.sourceLabel,
            appVersion:  APP_VERSION
          };

        } else if (mode === "total") {
          const result = await queryTotal(env, runtime, filters, view, limit);
          payload = {
            ok:          true,
            mode,
            view,
            rows:        result.rows,
            count:       result.rows.length,
            totalKilos:  result.totalKilos,
            sourceLabel: result.sourceLabel,
            appVersion:  APP_VERSION
          };

        } else if (mode === "compare") {
          const result = await queryCompare(env, runtime, filters, view, limit);
          payload = {
            ok:           true,
            mode,
            view,
            rows:         result.rows,
            count:        result.rows.length,
            range:        result.range,
            periodLabels: result.periodLabels,
            totals:       result.totals,
            totalKilos:   result.totals?.actual || 0,
            sourceLabel:  result.sourceLabel,
            appVersion:   APP_VERSION
          };

        } else {
          // mode === "ytd"
          const result = await queryYtd(env, runtime, filters, view, limit);
          payload = {
            ok:           true,
            mode,
            view,
            rows:         result.rows,
            count:        result.rows.length,
            range:        result.range,
            periodLabels: result.periodLabels,
            totals:       result.totals,
            totalKilos:   result.totals?.actual || 0,
            sourceLabel:  result.sourceLabel,
            appVersion:   APP_VERSION
          };
        }

        return jsonPublic(payload, ttl);
      }
    });

  } catch (error) {
    console.error("[accum-summary]", error);
    return jsonNoStore(
      { ok: false, error: String(error?.message || error), appVersion: APP_VERSION },
      500
    );
  }
}
