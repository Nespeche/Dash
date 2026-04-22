// =============================================================
// vectorize-handler.js (v30)
// Endpoints:
//   GET /api/vectorize/search?q=texto&type=clientes|productos&limit=N
//   POST /api/vectorize/reindex   { type: "clientes" | "productos" }
//
// Requiere bindings VECTORIZE_CLIENTES y VECTORIZE_PRODUCTOS
// (ambos opcionales). Si no están configurados, devuelve 503 con
// instrucciones — no rompe el worker.
//
// Para activarlos:
//   1) wrangler vectorize create ventas-clientes --dimensions=768 --metric=cosine
//   2) wrangler vectorize create ventas-productos --dimensions=768 --metric=cosine
//   3) Sumar bindings en wrangler.toml (ver MEJORAS_v30_README.md)
//   4) Llamar POST /api/vectorize/reindex con auth
// =============================================================
import { APP_VERSION } from "../../../shared/version.js";
import { jsonNoStore } from "../../lib/endpoint-cache.js";
import { queryAll } from "../../lib/db.js";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"; // 768 dims
const REINDEX_BATCH = 90; // límite de Vectorize: 100 vectores por upsert

function bindingFor(type, env) {
  if (type === "clientes") return env?.VECTORIZE_CLIENTES;
  if (type === "productos") return env?.VECTORIZE_PRODUCTOS;
  return null;
}

async function embed(env, text) {
  const out = await env.AI.run(EMBEDDING_MODEL, { text: [String(text || "").slice(0, 512)] });
  const vec = out?.data?.[0];
  if (!Array.isArray(vec)) throw new Error("Embedding inválido");
  return vec;
}

export async function handleVectorizeSearch(url, env, ctx, request) {
  const q = String(url.searchParams.get("q") || "").trim();
  const type = String(url.searchParams.get("type") || "clientes").toLowerCase();
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") || 8)));

  if (!q) return jsonNoStore({ ok: false, error: "Falta el parámetro q" }, 400);
  const idx = bindingFor(type, env);
  if (!idx) {
    return jsonNoStore({
      ok: false,
      error: `El binding Vectorize para "${type}" no está configurado. Ver MEJORAS_v30_README.md sección Vectorize.`,
      configurado: false,
      appVersion: APP_VERSION
    }, 503);
  }
  if (!env?.AI) return jsonNoStore({ ok: false, error: "Workers AI no disponible." }, 503);

  try {
    const vec = await embed(env, q);
    const result = await idx.query(vec, { topK: limit, returnMetadata: true });
    return jsonNoStore({
      ok: true,
      type,
      query: q,
      matches: (result?.matches || []).map(m => ({
        id: m.id,
        score: m.score,
        ...(m.metadata || {})
      })),
      appVersion: APP_VERSION
    });
  } catch (err) {
    console.error("[vectorize-search]", err);
    return jsonNoStore({ ok: false, error: String(err?.message || err) }, 500);
  }
}

export async function handleVectorizeReindex(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const type = String(body?.type || "clientes").toLowerCase();
  const idx = bindingFor(type, env);
  if (!idx) {
    return jsonNoStore({
      ok: false,
      error: `Binding Vectorize "${type}" no configurado.`,
      appVersion: APP_VERSION
    }, 503);
  }
  if (!env?.AI || !env?.DB) return jsonNoStore({ ok: false, error: "Bindings AI/DB faltantes." }, 503);

  let rows;
  try {
    if (type === "clientes") {
      rows = await queryAll(env, "SELECT Cod_Cliente AS id, Cliente AS nombre FROM clientes_catalogo WHERE Cliente IS NOT NULL", []);
    } else if (type === "productos") {
      rows = await queryAll(env, "SELECT Cod_Producto AS id, Producto_Desc AS nombre FROM productos_catalogo WHERE Producto_Desc IS NOT NULL", []);
    } else {
      return jsonNoStore({ ok: false, error: "type debe ser clientes o productos" }, 400);
    }
  } catch (err) {
    return jsonNoStore({ ok: false, error: `Error leyendo catálogo: ${err.message}` }, 500);
  }

  let upserted = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += REINDEX_BATCH) {
    const slice = rows.slice(i, i + REINDEX_BATCH);
    try {
      const out = await env.AI.run(EMBEDDING_MODEL, { text: slice.map(r => String(r.nombre || "").slice(0, 512)) });
      const vectors = (out?.data || []).map((vec, j) => ({
        id: String(slice[j].id),
        values: vec,
        metadata: { id: String(slice[j].id), nombre: String(slice[j].nombre || "") }
      }));
      await idx.upsert(vectors);
      upserted += vectors.length;
    } catch (err) {
      errors += slice.length;
      console.error(`[vectorize-reindex] batch ${i} error:`, err);
    }
  }

  return jsonNoStore({
    ok: true,
    type,
    total: rows.length,
    upserted,
    errors,
    appVersion: APP_VERSION
  });
}
