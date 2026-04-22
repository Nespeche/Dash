// =============================================================
// analytics.js — v31
// -----------------------------------------------------------------
// Wrapper minimalista sobre Cloudflare Analytics Engine.
// Requiere binding [[analytics_engine_datasets]] en wrangler.toml:
//
//   [[analytics_engine_datasets]]
//   binding = "ANALYTICS"
//
// Si el binding no está configurado, todas las llamadas son no-ops.
// Analytics Engine tiene 10M writes/mes en el plan free.
// =============================================================

/**
 * Escribe un evento en Analytics Engine.
 *
 * @param {object} env - env del Worker con binding ANALYTICS opcional
 * @param {object} payload - { blobs: string[], doubles: number[], indexes: string[] }
 *
 * Convención sugerida:
 *  - blobs[0]: evento (ej: "ai_chat", "state_query", "sparkline")
 *  - blobs[1..]: metadata contextual
 *  - doubles[0..]: métricas numéricas (latencia, tokens, etc)
 *  - indexes[0]: identificador del "tenant" o "user" si aplica
 */
export function writePoint(env, payload = {}) {
  try {
    const dataset = env?.ANALYTICS;
    if (!dataset || typeof dataset.writeDataPoint !== "function") return;
    dataset.writeDataPoint({
      blobs:   Array.isArray(payload.blobs)   ? payload.blobs.slice(0, 20)   : [],
      doubles: Array.isArray(payload.doubles) ? payload.doubles.slice(0, 20) : [],
      indexes: Array.isArray(payload.indexes) ? payload.indexes.slice(0, 1)  : []
    });
  } catch (err) {
    console.debug("[analytics] writePoint falló:", err?.message || err);
  }
}

/**
 * Helper de alto nivel para trackear invocaciones del asistente IA.
 */
export function trackAIChat(env, {
  intent = "unknown",
  answerMode = "summary",
  modelUsed = "unknown",
  latencyMs = 0,
  tokensOutput = 0,
  fromFastPath = false,
  fromStream = false,
  historyLen = 0
} = {}) {
  writePoint(env, {
    blobs: [
      "ai_chat",
      String(intent),
      String(answerMode),
      String(modelUsed),
      fromFastPath ? "fast" : (fromStream ? "stream" : "jsonbr"),
      String(env?.APP_VERSION || "")
    ],
    doubles: [Number(latencyMs) || 0, Number(tokensOutput) || 0, Number(historyLen) || 0]
  });
}

/**
 * Track de una query genérica al backend.
 */
export function trackEndpoint(env, {
  endpoint = "",
  status = 200,
  latencyMs = 0,
  cached = false
} = {}) {
  writePoint(env, {
    blobs: ["endpoint", String(endpoint), String(status), cached ? "cached" : "live"],
    doubles: [Number(latencyMs) || 0]
  });
}
