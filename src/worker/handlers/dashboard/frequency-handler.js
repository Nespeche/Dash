// =============================================================
// frequency-handler.js (v38.1 — fix HTTP 500)
//
// ROOT CAUSE del error intermitente:
//   buildFreqWhere() insertaba "v.Grupo_Familia = ?" directamente.
//   Luego el regex de alias también reemplazaba \b(Grupo_Familia)\b
//   dentro de "v.Grupo_Familia", produciendo "v.v.Grupo_Familia = ?"
//   → SQL inválido → D1 lanza error → HTTP 500.
//
// FIX: se reemplaza el enfoque de regex post-processing por
//   buildWhereAliased() que construye el WHERE con prefijo "v."
//   directamente, de una sola vez, sin posibilidad de doble-prefijo.
//   buildWherePlain() hace lo mismo sin prefijo (para CTEs sin alias).
// =============================================================

import { APP_VERSION } from "../../../shared/version.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { queryAll } from "../../lib/db.js";
import { parseFilters } from "../../lib/filters.js";

// ─── Constantes ───────────────────────────────────────────────

const ALLOWED_MODES = new Set(["cadencia", "patron"]);
const ALLOWED_VIEWS = new Set(["cliente", "agente", "coordinador"]);
const MAX_ROWS      = 200;
const CACHE_TTL     = 90;

const SEG_THRESHOLDS = [
  { key: "frecuente",  min: 2.0  },
  { key: "semanal",    min: 0.8  },
  { key: "quincenal",  min: 0.4  },
  { key: "mensual",    min: 0.15 },
  { key: "ocasional",  min: 0    },
];

const DOW_ORDER = ["lun","mar","mie","jue","vie","sab","dom"];

// ─── Parsers de URL ───────────────────────────────────────────

function pickMode(url)  {
  const r = String(url.searchParams.get("mode")  || "cadencia").toLowerCase();
  return ALLOWED_MODES.has(r) ? r : "cadencia";
}
function pickView(url)  {
  const r = String(url.searchParams.get("view")  || "cliente").toLowerCase();
  return ALLOWED_VIEWS.has(r) ? r : "cliente";
}
function pickLimit(url) {
  const n = parseInt(url.searchParams.get("limit") || "150", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_ROWS, Math.max(10, n)) : 150;
}
function pickGrupoFreq(url) {
  return String(url.searchParams.get("grupo_freq") || "").trim();
}

// ─── Segmentación ─────────────────────────────────────────────

function getSegmento(cSem, diasSin) {
  if (diasSin > 90) return "inactivo";
  for (const s of SEG_THRESHOLDS) {
    if (cSem >= s.min) return s.key;
  }
  return "ocasional";
}

// ─── Builders de WHERE — sin regex, sin doble-prefijo ────────
//
// buildWhereAliased: genera "WHERE v.Columna ..." para queries con alias v
// buildWherePlain:   genera "WHERE Columna ..."  para CTEs sin alias
//
// grupoFreq (el filtro interno de la solapa) se añade aquí,
// en la misma pasada, garantizando un solo prefijo.

const DIMS = ["coordinador","agente","cliente","grupo","marca","region","codProd"];

function buildWhereAliased(filters, grupoFreq) {
  const where  = [];
  const params = [];
  const f      = filters || {};

  // Fechas
  if (f.desde) { where.push("v.Fecha >= ?"); params.push(f.desde); }
  if (f.hasta) { where.push("v.Fecha <= ?"); params.push(f.hasta); }

  // Dimensiones de negocio con prefijo v.
  if (f.coordinador)  { where.push("v.Coordinador = ?");   params.push(f.coordinador); }
  if (f.agente)       { where.push("v.Cod_Agente = ?");    params.push(f.agente); }
  if (f.cliente)      { where.push("v.Cod_Cliente = ?");   params.push(f.cliente); }
  if (f.grupo)        { where.push("v.Grupo_Familia = ?"); params.push(f.grupo); }
  if (f.marca)        { where.push("v.Marca = ?");         params.push(f.marca); }
  if (f.region)       { where.push("v.Region = ?");        params.push(f.region); }
  if (Array.isArray(f.codProd) && f.codProd.length) {
    where.push(`v.Cod_Producto IN (${f.codProd.map(() => "?").join(",")})`);
    params.push(...f.codProd);
  }

  // Filtro interno de familia (grupoFreq) — independiente del filtro global
  if (grupoFreq) { where.push("v.Grupo_Familia = ?"); params.push(grupoFreq); }

  return {
    sql:    where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function buildWherePlain(filters, grupoFreq) {
  // Para el CTE period_range (FROM ventas sin alias)
  const where  = [];
  const params = [];
  const f      = filters || {};

  if (f.desde)        { where.push("Fecha >= ?");        params.push(f.desde); }
  if (f.hasta)        { where.push("Fecha <= ?");        params.push(f.hasta); }
  if (f.coordinador)  { where.push("Coordinador = ?");   params.push(f.coordinador); }
  if (f.agente)       { where.push("Cod_Agente = ?");    params.push(f.agente); }
  if (f.cliente)      { where.push("Cod_Cliente = ?");   params.push(f.cliente); }
  if (f.grupo)        { where.push("Grupo_Familia = ?"); params.push(f.grupo); }
  if (f.marca)        { where.push("Marca = ?");         params.push(f.marca); }
  if (f.region)       { where.push("Region = ?");        params.push(f.region); }
  if (Array.isArray(f.codProd) && f.codProd.length) {
    where.push(`Cod_Producto IN (${f.codProd.map(() => "?").join(",")})`);
    params.push(...f.codProd);
  }
  if (grupoFreq)      { where.push("Grupo_Familia = ?"); params.push(grupoFreq); }

  return {
    sql:    where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

// ─── Vista (cadencia) ─────────────────────────────────────────

function buildViewCols(view) {
  switch (view) {
    case "agente":      return { codeCol:"v.Cod_Agente",  nameCol:"MIN(v.Agente)",  groupBy:"v.Cod_Agente" };
    case "coordinador": return { codeCol:"v.Coordinador", nameCol:"v.Coordinador",  groupBy:"v.Coordinador" };
    default:            return { codeCol:"v.Cod_Cliente", nameCol:"MIN(v.Cliente)", groupBy:"v.Cod_Cliente" };
  }
}

// ─── MODO CADENCIA ────────────────────────────────────────────

async function queryCadencia(env, filters, grupoFreq, view, limit) {
  const { codeCol, nameCol, groupBy } = buildViewCols(view);

  // WHERE con alias (para la cadencia CTE)
  const wAli  = buildWhereAliased(filters, grupoFreq);
  // WHERE sin alias (para period_range CTE)
  const wPlain = buildWherePlain(filters, grupoFreq);

  // Excluir NULLs en la dimensión agrupada
  const notNull = `NULLIF(TRIM(COALESCE(${groupBy}, '')), '') IS NOT NULL`;
  const mainWhere  = wAli.sql
    ? `${wAli.sql} AND ${notNull}`
    : `WHERE ${notNull}`;

  const sql = `
    WITH period_range AS (
      SELECT MAX(1, CAST(ROUND(
        julianday(MAX(Fecha)) - julianday(MIN(Fecha)) + 1
      ) AS INTEGER)) AS dias_rango
      FROM ventas
      ${wPlain.sql}
    ),
    cadencia AS (
      SELECT
        ${codeCol}                      AS codigo,
        ${nameCol}                      AS nombre,
        COUNT(DISTINCT v.Fecha)         AS dias_con_compra,
        MIN(v.Fecha)                    AS primera,
        MAX(v.Fecha)                    AS ultima,
        CAST(ROUND(
          julianday(DATE('now')) - julianday(MAX(v.Fecha))
        ) AS INTEGER)                   AS dias_sin_compra,
        CAST(SUM(v.Kilos) AS INTEGER)   AS kilos_total,
        COUNT(*)                        AS transacciones
      FROM ventas v
      ${mainWhere}
      GROUP BY ${groupBy}
    )
    SELECT
      c.codigo,
      c.nombre,
      c.dias_con_compra,
      r.dias_rango,
      ROUND(CAST(c.dias_con_compra AS REAL) / (r.dias_rango / 7.0),   2) AS compras_semana,
      ROUND(CAST(c.dias_con_compra AS REAL) / (r.dias_rango / 30.44), 2) AS compras_mes,
      c.primera,
      c.ultima,
      c.dias_sin_compra,
      c.kilos_total,
      c.transacciones
    FROM cadencia c CROSS JOIN period_range r
    WHERE c.dias_con_compra > 0
    ORDER BY compras_semana DESC, c.dias_con_compra DESC
    LIMIT ?
  `;

  // Parámetros en el mismo orden que aparecen en el SQL:
  // 1. period_range CTE  → wPlain.params
  // 2. cadencia CTE      → wAli.params
  // 3. LIMIT             → limit
  const params = [...wPlain.params, ...wAli.params, limit];
  const rows   = await queryAll(env, sql, params);

  return (rows || []).map(r => {
    const codigo  = String(r.codigo || "").trim();
    const nombre  = String(r.nombre || r.codigo || "").trim();
    const cSem    = Number(r.compras_semana || 0);
    const cMes    = Number(r.compras_mes    || 0);
    const diasSin = Number(r.dias_sin_compra || 0);
    return {
      codigo,
      nombre,
      label: (codigo && nombre && codigo !== nombre)
        ? `${codigo} · ${nombre}`
        : (nombre || codigo || "Sin dato"),
      dias_con_compra: Number(r.dias_con_compra || 0),
      dias_rango:      Number(r.dias_rango      || 0),
      compras_semana:  cSem,
      compras_mes:     cMes,
      primera:         String(r.primera || ""),
      ultima:          String(r.ultima  || ""),
      dias_sin_compra: diasSin,
      kilos_total:     Number(r.kilos_total   || 0),
      transacciones:   Number(r.transacciones || 0),
      segmento:        getSegmento(cSem, diasSin),
    };
  });
}

// ─── MODO PATRÓN ──────────────────────────────────────────────

async function queryPatron(env, filters, grupoFreq, limit) {
  const wAli   = buildWhereAliased(filters, grupoFreq);
  const notNull = "NULLIF(TRIM(COALESCE(v.Cod_Cliente, '')), '') IS NOT NULL";
  const mainWhere = wAli.sql
    ? `${wAli.sql} AND ${notNull}`
    : `WHERE ${notNull}`;

  const sql = `
    WITH patron AS (
      SELECT
        v.Cod_Cliente                                                             AS codigo,
        MIN(v.Cliente)                                                            AS nombre,
        COUNT(DISTINCT CASE WHEN strftime('%w',v.Fecha)='1' THEN v.Fecha END)    AS lun,
        COUNT(DISTINCT CASE WHEN strftime('%w',v.Fecha)='2' THEN v.Fecha END)    AS mar,
        COUNT(DISTINCT CASE WHEN strftime('%w',v.Fecha)='3' THEN v.Fecha END)    AS mie,
        COUNT(DISTINCT CASE WHEN strftime('%w',v.Fecha)='4' THEN v.Fecha END)    AS jue,
        COUNT(DISTINCT CASE WHEN strftime('%w',v.Fecha)='5' THEN v.Fecha END)    AS vie,
        COUNT(DISTINCT CASE WHEN strftime('%w',v.Fecha)='6' THEN v.Fecha END)    AS sab,
        COUNT(DISTINCT CASE WHEN strftime('%w',v.Fecha)='0' THEN v.Fecha END)    AS dom,
        MIN(v.Fecha)                                                              AS primera,
        MAX(v.Fecha)                                                              AS ultima
      FROM ventas v
      ${mainWhere}
      GROUP BY v.Cod_Cliente
    )
    SELECT
      codigo, nombre,
      lun, mar, mie, jue, vie, sab, dom,
      (lun + mar + mie + jue + vie + sab + dom) AS total_dias,
      primera, ultima,
      CASE MAX(lun, mar, mie, jue, vie, sab, dom)
        WHEN lun THEN 'Lunes'
        WHEN mar THEN 'Martes'
        WHEN mie THEN 'Miércoles'
        WHEN jue THEN 'Jueves'
        WHEN vie THEN 'Viernes'
        WHEN sab THEN 'Sábado'
        WHEN dom THEN 'Domingo'
        ELSE '—'
      END AS dia_preferido
    FROM patron
    WHERE (lun + mar + mie + jue + vie + sab + dom) > 0
    ORDER BY total_dias DESC, (lun + mar + mie + jue + vie) DESC
    LIMIT ?
  `;

  const rows = await queryAll(env, sql, [...wAli.params, limit]);

  return (rows || []).map(r => {
    const codigo = String(r.codigo || "").trim();
    const nombre = String(r.nombre  || r.codigo || "").trim();
    return {
      codigo,
      nombre,
      label: (codigo && nombre && codigo !== nombre)
        ? `${codigo} · ${nombre}`
        : (nombre || codigo || "Sin dato"),
      lun:  Number(r.lun || 0), mar: Number(r.mar || 0),
      mie:  Number(r.mie || 0), jue: Number(r.jue || 0),
      vie:  Number(r.vie || 0), sab: Number(r.sab || 0),
      dom:  Number(r.dom || 0),
      total_dias:    Number(r.total_dias    || 0),
      primera:       String(r.primera       || ""),
      ultima:        String(r.ultima        || ""),
      dia_preferido: String(r.dia_preferido || "—"),
    };
  });
}

// ─── Handler principal ────────────────────────────────────────

export async function handleFrequency(url, env, ctx, request) {
  try {
    const runtime     = await resolveRuntimeContext(env);
    const filters     = parseFilters(url);
    const mode        = pickMode(url);
    const view        = pickView(url);
    const grupoFreq   = pickGrupoFreq(url);
    const limit       = pickLimit(url);
    const dataVersion = runtime?.meta?.dataVersion || "legacy";

    return await respondWithVersionedCache({
      request, url, dataVersion, ctx,
      build: async () => {
        if (!runtime.hasVentas) {
          return jsonNoStore({
            ok: true, mode, view, rows: [], count: 0,
            note: "Tabla ventas no disponible.", appVersion: APP_VERSION
          });
        }

        if (mode === "patron") {
          const rows = await queryPatron(env, filters, grupoFreq, limit);
          const dowTotals = { lun:0,mar:0,mie:0,jue:0,vie:0,sab:0,dom:0 };
          rows.forEach(r => DOW_ORDER.forEach(d => { dowTotals[d] += r[d] || 0; }));
          const dowMax = DOW_ORDER.reduce((a,b) => dowTotals[a] >= dowTotals[b] ? a : b, "lun");
          return jsonPublic({
            ok: true, mode, view: "cliente",
            grupoFreq: grupoFreq || null,
            rows, count: rows.length,
            dowTotals, dowMax,
            dowLabels: ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"],
            dowOrder:  DOW_ORDER,
            appVersion: APP_VERSION
          }, CACHE_TTL);
        }

        // mode === "cadencia"
        const rows = await queryCadencia(env, filters, grupoFreq, view, limit);
        const segCounts = { frecuente:0,semanal:0,quincenal:0,mensual:0,ocasional:0,inactivo:0 };
        rows.forEach(r => { if (segCounts[r.segmento] !== undefined) segCounts[r.segmento]++; });

        const totalDiasCom = rows.reduce((a,r) => a + r.dias_con_compra, 0);
        const avgSem = rows.length ? +(rows.reduce((a,r)=>a+r.compras_semana,0)/rows.length).toFixed(2) : 0;
        const avgMes = rows.length ? +(rows.reduce((a,r)=>a+r.compras_mes,   0)/rows.length).toFixed(2) : 0;

        return jsonPublic({
          ok: true, mode, view,
          grupoFreq: grupoFreq || null,
          rows, count: rows.length,
          totals: {
            diasConCompra:   totalDiasCom,
            promedioSemana:  avgSem,
            promedioMes:     avgMes,
            segmentos:       segCounts
          },
          appVersion: APP_VERSION
        }, CACHE_TTL);
      }
    });
  } catch (error) {
    console.error("[frequency]", error);
    return jsonNoStore({
      ok: false,
      error: String(error?.message || error),
      appVersion: APP_VERSION
    }, 500);
  }
}
