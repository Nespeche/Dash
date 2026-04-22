// =============================================================
// bcra-handler.js (v30)
// Endpoint: GET /api/bcra/dolar
// Proxy a las cotizaciones del BCRA + dolarapi.com con caché en
// Cloudflare KV/Cache para evitar pegarle a las APIs externas en
// cada request del frontend.
// =============================================================
import { APP_VERSION } from "../../../shared/version.js";

const CACHE_TTL_SECONDS = 600; // 10 min
const TIMEOUT_MS = 5000;

async function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(tid);
  }
}

async function fetchDolarApi() {
  // dolarapi.com — 6 cotizaciones (oficial, blue, mep, ccl, mayorista, tarjeta)
  try {
    const r = await fetchWithTimeout("https://dolarapi.com/v1/dolares");
    if (!r.ok) throw new Error(`dolarapi ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error("dolarapi formato inesperado");
    return data.map(d => ({
      casa: d.casa,
      nombre: d.nombre,
      compra: Number(d.compra) || null,
      venta: Number(d.venta) || null,
      fechaActualizacion: d.fechaActualizacion || null
    }));
  } catch (err) {
    console.warn("[bcra-handler] dolarapi falló:", err?.message || err);
    return null;
  }
}

async function fetchBcraOficial() {
  // BCRA Estadísticas Cambiarias - tipo de cambio mayorista (variable 5)
  // https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones
  try {
    const r = await fetchWithTimeout("https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones");
    if (!r.ok) throw new Error(`bcra ${r.status}`);
    const data = await r.json();
    const usd = (data?.results?.detalle || []).find(x => String(x?.codigoMoneda || "").toUpperCase() === "USD");
    if (!usd) return null;
    return {
      fecha: data?.results?.fecha || null,
      compra: Number(usd.tipoCotizacion) || null,
      venta: Number(usd.tipoCotizacion) || null
    };
  } catch (err) {
    console.warn("[bcra-handler] BCRA falló:", err?.message || err);
    return null;
  }
}

export async function handleBcraDolar(url, env, ctx, request) {
  // Caché HTTP usando la Cache API de CF Workers
  const cacheKey = new Request(`https://cache.local/api/bcra/dolar`, request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [dolares, oficialBcra] = await Promise.all([
    fetchDolarApi(),
    fetchBcraOficial()
  ]);

  if (!dolares && !oficialBcra) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Cotizaciones no disponibles",
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

  const body = JSON.stringify({
    ok: true,
    fetchedAt: new Date().toISOString(),
    bcra: oficialBcra,
    dolares: dolares || [],
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

  // Persistir en cache (sólo si tenemos ctx para waitUntil)
  if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
