// =============================================================
// ipc-handler.js — v31
// -----------------------------------------------------------------
// Endpoint: GET /api/ipc
// Proxy a datos.gob.ar (Datos Argentina) con caché en Cache API.
// Devuelve la serie de IPC nacional mensual para que el frontend
// pueda deflactar comparativas 2025 vs 2026 en términos reales.
//
// Serie: 148.3_INIVELNAL_DICI_M_26 (IPC nacional nivel general,
// base diciembre 2016 = 100).
//
// Respuesta:
//   { ok:true, serie:"IPC nacional", base:"dic-2016=100",
//     points:[{fecha:"2025-01-01", valor: 8123.45}, ...],
//     fetchedAt, appVersion }
//
// Cache: 6 horas (el IPC sólo cambia una vez al mes).
// =============================================================
import { APP_VERSION } from "../../../shared/version.js";
import { json, humanizeError } from "../../lib/http.js";
import { captureException } from "../../lib/sentry-lite.js";

const CACHE_TTL_SECONDS = 6 * 3600;
const TIMEOUT_MS = 6000;
const SERIE_ID = "148.3_INIVELNAL_DICI_M_26";

async function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(tid);
  }
}

async function fetchIpcSerie(limit = 40) {
  const url = `https://apis.datos.gob.ar/series/api/series/?ids=${SERIE_ID}&format=json&limit=${limit}&sort=desc`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) throw new Error(`datos.gob.ar ${r.status}`);
    const data = await r.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    // data.data = [[fechaISO, valor], ...]
    const points = rows
      .filter(row => Array.isArray(row) && row.length >= 2)
      .map(row => ({ fecha: String(row[0]), valor: Number(row[1]) }))
      .filter(p => p.fecha && Number.isFinite(p.valor))
      .sort((a, b) => a.fecha.localeCompare(b.fecha)); // asc cronológico
    return points;
  } catch (err) {
    console.warn("[ipc-handler] datos.gob.ar falló:", err?.message || err);
    return null;
  }
}

export async function handleIpc(url, env, ctx, request) {
  // Caché HTTP usando la Cache API de CF Workers
  const cacheKey = new Request(`https://cache.local/api/ipc`, request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const limit = Math.min(60, Math.max(12, Number(url.searchParams.get("limit") || 36)));
    const points = await fetchIpcSerie(limit);

    if (!points || !points.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: "IPC no disponible (datos.gob.ar)",
        appVersion: APP_VERSION
      }), {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*"
        }
      });
    }

    // Calcular índice relativo (el último valor = 100)
    // Útil para el frontend: kilos * (ipcActual / ipcHistorico) = kilos reales
    const last = points[points.length - 1]?.valor || 1;
    const withIndex = points.map(p => ({
      fecha: p.fecha,
      valor: p.valor,
      indiceRelativo: +(p.valor / last * 100).toFixed(2)
    }));

    const body = JSON.stringify({
      ok: true,
      serie: "IPC nacional nivel general",
      serieId: SERIE_ID,
      base: "dic-2016=100",
      fuente: "datos.gob.ar (INDEC)",
      fetchedAt: new Date().toISOString(),
      count: withIndex.length,
      points: withIndex,
      appVersion: APP_VERSION
    });

    const response = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
        "access-control-allow-origin": "*"
      }
    });

    if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    console.error("[ipc-handler]", err);
    captureException(err, env, ctx, { where: "handleIpc", appVersion: APP_VERSION });
    return json({ ok: false, error: humanizeError(err) }, 500, { "cache-control": "no-store" });
  }
}
