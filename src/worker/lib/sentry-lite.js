// =============================================================
// sentry-lite.js — v31
// -----------------------------------------------------------------
// Cliente Sentry MINIMALISTA (sin SDK) para Cloudflare Workers.
// Envía eventos a Sentry usando el envelope HTTP estándar.
// Si env.SENTRY_DSN no está configurado, todas las llamadas son
// no-ops: nada se envía y nada falla. Esto permite dejar el
// código sembrado en producción sin requerir setup obligatorio.
//
// Uso típico:
//   import { captureException } from "./lib/sentry-lite.js";
//   try { ... } catch (err) { captureException(err, env, ctx, { where: "..." }); }
// =============================================================

function parseDsn(dsn) {
  if (!dsn || typeof dsn !== "string") return null;
  try {
    // DSN formato: https://<publicKey>@<host>/<projectId>
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "").split("/").pop();
    if (!publicKey || !projectId) return null;
    return {
      publicKey,
      projectId,
      host: url.host,
      protocol: url.protocol
    };
  } catch (_) {
    return null;
  }
}

function buildEventId() {
  // 32 hex chars, Sentry requiere este formato
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function normalizeError(err) {
  if (!err) return { type: "Error", value: "Unknown error", stacktrace: null };
  if (err instanceof Error) {
    return {
      type: err.name || "Error",
      value: String(err.message || err),
      stacktrace: parseStack(err.stack || "")
    };
  }
  if (typeof err === "string") return { type: "Error", value: err, stacktrace: null };
  try { return { type: "Error", value: JSON.stringify(err), stacktrace: null }; }
  catch (_) { return { type: "Error", value: String(err), stacktrace: null }; }
}

function parseStack(stackString) {
  if (!stackString) return null;
  const lines = stackString.split("\n").slice(1, 31).map(line => line.trim()).filter(Boolean);
  const frames = lines.map(line => {
    // V8 style: "at functionName (file:line:col)"
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/) || line.match(/at\s+(.+?):(\d+):(\d+)/);
    if (match && match.length === 5) {
      return { function: match[1], filename: match[2], lineno: Number(match[3]), colno: Number(match[4]) };
    }
    if (match && match.length === 4) {
      return { function: "<anonymous>", filename: match[1], lineno: Number(match[2]), colno: Number(match[3]) };
    }
    return { function: line };
  });
  return { frames: frames.reverse() };
}

async function sendEnvelope(dsn, event) {
  const parsed = parseDsn(dsn);
  if (!parsed) return false;

  const envelopeUrl = `${parsed.protocol}//${parsed.host}/api/${parsed.projectId}/envelope/`;
  const auth = [
    "sentry_version=7",
    `sentry_client=ventas-dash-worker/31.0`,
    `sentry_key=${parsed.publicKey}`
  ].join(",");

  const header = JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() });
  const itemHeader = JSON.stringify({ type: "event" });
  const itemPayload = JSON.stringify(event);
  const body = `${header}\n${itemHeader}\n${itemPayload}\n`;

  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 4000);
    try {
      await fetch(envelopeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": `Sentry ${auth}`
        },
        body,
        signal: ctl.signal
      });
      return true;
    } finally {
      clearTimeout(tid);
    }
  } catch (err) {
    // No queremos que Sentry rompa la respuesta real del worker
    console.warn("[sentry-lite] envío falló:", err?.message || err);
    return false;
  }
}

/**
 * Captura una excepción y la envía a Sentry (si env.SENTRY_DSN está configurado).
 * Es fire-and-forget (usa ctx.waitUntil cuando está disponible).
 *
 * @param {Error|unknown} err - El error a capturar.
 * @param {object} env - El env del Worker.
 * @param {object|null} ctx - El ctx del Worker (para waitUntil).
 * @param {object} [extras] - Contexto adicional: { where, request, tags, user }.
 */
export function captureException(err, env, ctx = null, extras = {}) {
  const dsn = env?.SENTRY_DSN || "";
  if (!dsn) return; // no-op si no hay DSN

  const normalized = normalizeError(err);
  const event = {
    event_id: buildEventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    server_name: "cloudflare-worker",
    environment: env?.SENTRY_ENV || "production",
    release: extras?.release || extras?.appVersion || "unknown",
    tags: {
      runtime: "workers",
      ...(extras?.tags || {})
    },
    extra: {
      where: extras?.where || "unknown",
      url: extras?.request?.url || null,
      method: extras?.request?.method || null,
      userAgent: extras?.request?.headers?.get?.("user-agent") || null,
      ...(extras?.extra || {})
    },
    user: extras?.user || undefined,
    exception: {
      values: [{
        type: normalized.type,
        value: normalized.value,
        stacktrace: normalized.stacktrace || undefined
      }]
    }
  };

  const promise = sendEnvelope(dsn, event);
  if (ctx?.waitUntil) {
    try { ctx.waitUntil(promise); } catch (_) {}
  }
}

/**
 * Captura un mensaje (no error). Útil para warnings o eventos de negocio.
 */
export function captureMessage(message, env, ctx = null, extras = {}) {
  const dsn = env?.SENTRY_DSN || "";
  if (!dsn) return;

  const event = {
    event_id: buildEventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: extras?.level || "info",
    environment: env?.SENTRY_ENV || "production",
    release: extras?.release || extras?.appVersion || "unknown",
    message: { formatted: String(message || "") },
    tags: { runtime: "workers", ...(extras?.tags || {}) },
    extra: extras?.extra || {}
  };

  const promise = sendEnvelope(dsn, event);
  if (ctx?.waitUntil) {
    try { ctx.waitUntil(promise); } catch (_) {}
  }
}
