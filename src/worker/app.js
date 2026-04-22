import { APP_VERSION } from "../shared/version.js";
import { corsHdrs, humanizeError, json } from "./lib/http.js";
import { checkRateLimit, getClientIp } from "./lib/rate-limit.js";
import { AUTH_REALM, authenticateRequest } from "./lib/auth.js";
import { handleAIChat, handleCatalog, handleDetail, handleDetailOptions, handleHealth, handleInsights, handleState, handleAccumSummary, handleBcraDolar, handleVectorizeSearch, handleVectorizeReindex, handleAIFeedback, handleAIFeedbackStats, handleSparkline, handleIpc, handleEmailReport, handleFrequency } from "./handlers/dashboard/index.js";
import { handleProjectionCompare, handleProjectionDetail, handleProjectionHierarchy, handleProjectionProductHierarchy } from "./handlers/projection/index.js";
import { captureException } from "./lib/sentry-lite.js";

function unauthorizedResponse() {
  return json({
    error: true,
    mensaje: "Autenticacion requerida."
  }, 401, {
    "cache-control": "no-store",
    "www-authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`
  });
}

// CORS headers que incluyen POST (necesario para /api/ai/chat)
function corsHdrsExtended() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400"
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHdrsExtended() });
    }

    try {
      if (url.pathname.startsWith("/api/")) {
        const auth = await authenticateRequest(request, env, { unauthorizedResponse });
        if (!auth.ok) return auth.response;
      }

      // Rate limiting solo para rutas GET intensivas
      const rateLimitedRoute = {
        "/api/detail":        { limit: 90, windowMs: 60_000 },
        "/api/insights":      { limit: 60, windowMs: 60_000 },
        "/api/ai/chat":       { limit: 20, windowMs: 60_000 },
        "/api/ai/feedback":   { limit: 30, windowMs: 60_000 }, // v31
        "/api/sparkline":     { limit: 60, windowMs: 60_000 }, // v31
        "/api/email/report":  { limit: 10, windowMs: 60_000 }, // v31
        "/api/ipc":           { limit: 20, windowMs: 60_000 }  // v31
      }[url.pathname];

      if (rateLimitedRoute) {
        const rate = checkRateLimit(getClientIp(request), {
          scope: url.pathname,
          limit: rateLimitedRoute.limit,
          windowMs: rateLimitedRoute.windowMs
        });
        if (!rate.allowed) {
          return json({
            error: true,
            mensaje: "Demasiadas solicitudes. Intentá nuevamente en unos segundos."
          }, 429, {
            "cache-control": "no-store",
            "retry-after": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000)))
          });
        }
      }

      if (url.pathname === "/api/health") return await handleHealth(env);
      if (url.pathname === "/api/state") return await handleState(url, env, ctx, request);
      if (url.pathname === "/api/insights") return await handleInsights(url, env, ctx, request);
      if (url.pathname === "/api/detail") return await handleDetail(url, env, ctx, request);
      if (url.pathname === "/api/detail-options") return await handleDetailOptions(url, env, ctx, request);
      if (url.pathname === "/api/projection-compare") return await handleProjectionCompare(url, env, ctx, request);
      if (url.pathname === "/api/projection-detail") return await handleProjectionDetail(url, env, ctx, request);
      if (url.pathname === "/api/projection-hierarchy") return await handleProjectionHierarchy(url, env, ctx, request);
      if (url.pathname === "/api/projection-product-hierarchy") return await handleProjectionProductHierarchy(url, env, ctx, request);
      if (url.pathname === "/api/catalog") return await handleCatalog(url, env, ctx, request);
      // v30: nuevos endpoints
      if (url.pathname === "/api/accum-summary") return await handleAccumSummary(url, env, ctx, request);
      // v37: frecuencia de compra
      if (url.pathname === "/api/frequency") return await handleFrequency(url, env, ctx, request);
      if (url.pathname === "/api/bcra/dolar") return await handleBcraDolar(url, env, ctx, request);
      if (url.pathname === "/api/vectorize/search") return await handleVectorizeSearch(url, env, ctx, request);
      if (url.pathname === "/api/vectorize/reindex" && request.method === "POST") return await handleVectorizeReindex(request, env, ctx);

      // v31: feedback IA, stats, sparkline
      if (url.pathname === "/api/ai/feedback" && request.method === "POST") return await handleAIFeedback(request, env, ctx);
      if (url.pathname === "/api/ai/feedback-stats") return await handleAIFeedbackStats(url, env, ctx);
      if (url.pathname === "/api/sparkline") return await handleSparkline(url, env, ctx, request);
      // v31 extensión: IPC + email
      if (url.pathname === "/api/ipc") return await handleIpc(url, env, ctx, request);
      if (url.pathname === "/api/email/report" && request.method === "POST") return await handleEmailReport(request, env, ctx);

      // ── Asistente IA ── POST /api/ai/chat
      if (url.pathname === "/api/ai/chat" && request.method === "POST") {
        return await handleAIChat(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: true, mensaje: "Ruta no encontrada" }, 404);
      }

      return json({
        ok: true,
        mensaje: "Ventas D1 Worker activo. El frontend esta en el sitio Pages.",
        appVersion: APP_VERSION
      });
    } catch (err) {
      console.error("[worker.fetch]", err);
      // v31: capturar a Sentry (no-op si SENTRY_DSN no está configurado)
      captureException(err, env, ctx, {
        where: "worker.fetch",
        request,
        appVersion: APP_VERSION,
        extra: { pathname: url.pathname, method: request.method }
      });
      return json({
        error: true,
        mensaje: humanizeError(err)
      }, 500, { "cache-control": "no-store" });
    }
  },

  // v31: Cron trigger (opcional). Se dispara según wrangler.toml [triggers].crons.
  // Por defecto no hace nada — es un stub para conectar con la ingesta incremental
  // o con scripts de generación de reportes diarios.
  async scheduled(event, env, ctx) {
    try {
      console.log("[scheduled] Cron disparado:", event.cron, "at", new Date(event.scheduledTime).toISOString());
      // TODO: invocar la ingesta incremental o enviar reportes.
      // Ejemplo de skeleton:
      // if (event.cron === "0 3 * * *") { await runDailyIngestion(env, ctx); }
    } catch (err) {
      console.error("[scheduled]", err);
      captureException(err, env, ctx, { where: "worker.scheduled", appVersion: APP_VERSION });
    }
  }
};
