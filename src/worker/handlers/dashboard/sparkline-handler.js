// =============================================================
// sparkline-handler.js — v31
// -----------------------------------------------------------------
// Endpoint: GET /api/sparkline
// Devuelve puntos temporales (fecha, kilos, clientes, registros)
// listos para alimentar los sparklines inline de los KPIs.
//
// Parámetros:
//   - desde, hasta: rango explícito (obligatorio, salvo auto=1)
//   - auto=1: usa los últimos 30 días del dataset (ignora desde/hasta)
//   - resto: filtros estándar de dimensión (coordinador, agente, grupo, etc.)
//
// Respuesta:
//   { ok:true, points:[{fecha, kilos, clientes, registros}], count }
//
// Dedicado (no sobrecarga /api/accum-summary) y optimizado para lo mínimo
// necesario en el frontend.
// =============================================================
import { APP_VERSION } from "../../../shared/version.js";
import { json, humanizeError } from "../../lib/http.js";
import { queryAll } from "../../lib/db.js";
import { buildWhere, parseFilters } from "../../lib/filters.js";
import { jsonNoStore, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { captureException } from "../../lib/sentry-lite.js";

const MAX_POINTS = 90;
const DEFAULT_POINTS = 30;
const DIMS = ["coordinador", "agente", "cliente", "grupo", "marca", "codProd", "detailGroups"];

function pickLimit(url) {
  const raw = Number(url.searchParams.get("limit") || DEFAULT_POINTS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_POINTS;
  return Math.min(MAX_POINTS, Math.max(7, Math.floor(raw)));
}

function pickAuto(url) {
  return url.searchParams.get("auto") === "1";
}

export async function handleSparkline(url, env, ctx, request = null) {
  try {
    const runtime = await resolveRuntimeContext(env);
    const filters = parseFilters(url);
    const auto = pickAuto(url);
    const limit = pickLimit(url);

    // Modo auto: tomamos los últimos N días disponibles del dataset
    if (auto) {
      filters.desde = null;
      filters.hasta = null;
    }

    return await respondWithVersionedCache({
      request,
      url,
      dataVersion: runtime?.meta?.dataVersion,
      ctx,
      build: async () => {
        if (!runtime?.hasVentas) {
          return jsonNoStore({
            ok: true,
            points: [],
            count: 0,
            note: "Tabla ventas no disponible.",
            appVersion: APP_VERSION
          });
        }

        const where = buildWhere(filters, DIMS);
        const baseSql = `
          SELECT Fecha AS fecha,
                 SUM(Kilos) AS kilos,
                 COUNT(DISTINCT Cod_Cliente) AS clientes,
                 COUNT(*) AS registros
          FROM ventas
          ${where.sql}
          GROUP BY Fecha
          ORDER BY Fecha DESC
          LIMIT ?
        `;
        const params = [...where.params, limit];

        const rows = await queryAll(env, baseSql, params);
        // Sort ascending cronológico para el gráfico
        const points = (rows || [])
          .filter(r => r && r.fecha)
          .map(r => ({
            fecha: String(r.fecha),
            kilos: Number(r.kilos || 0),
            clientes: Number(r.clientes || 0),
            registros: Number(r.registros || 0)
          }))
          .sort((a, b) => a.fecha.localeCompare(b.fecha));

        return jsonNoStore({
          ok: true,
          points,
          count: points.length,
          filters: {
            desde: filters.desde,
            hasta: filters.hasta,
            coordinador: filters.coordinador || null,
            grupo: filters.grupo || null,
            auto
          },
          appVersion: APP_VERSION
        });
      }
    });
  } catch (err) {
    console.error("[sparkline-handler]", err);
    captureException(err, env, ctx, { where: "handleSparkline", request, appVersion: APP_VERSION });
    return json({ ok: false, error: humanizeError(err) }, 500, { "cache-control": "no-store" });
  }
}
