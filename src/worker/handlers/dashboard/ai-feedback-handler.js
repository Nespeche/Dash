// =============================================================
// ai-feedback-handler.js — v31
// -----------------------------------------------------------------
// Endpoint: POST /api/ai/feedback
// Recibe ratings thumbs up/down del frontend y los persiste en D1.
// La tabla `ai_feedback` se crea automáticamente si no existe
// (CREATE TABLE IF NOT EXISTS) para que no haga falta una
// migración manual. Si D1 no está disponible, devuelve 503.
//
// Body JSON esperado:
//   {
//     ts:        ISO string,
//     rating:    "up" | "down",
//     question:  string (max 500 chars),
//     answer:    string (max 2000 chars),
//     appVersion: string,
//     activeTab: string,
//     comment:   string (opcional, max 500 chars)
//   }
// =============================================================
import { APP_VERSION } from "../../../shared/version.js";
import { json, humanizeError } from "../../lib/http.js";
import { captureException } from "../../lib/sentry-lite.js";

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ai_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  rating      TEXT NOT NULL CHECK (rating IN ('up','down')),
  question    TEXT,
  answer      TEXT,
  app_version TEXT,
  active_tab  TEXT,
  comment     TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)
`;

const ENSURE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_ai_feedback_ts ON ai_feedback(ts);
`;

const ENSURE_RATING_IDX_SQL = `
CREATE INDEX IF NOT EXISTS idx_ai_feedback_rating ON ai_feedback(rating);
`;

// Flag en memoria para no correr CREATE TABLE en cada request
let tableEnsured = false;

async function ensureTable(env) {
  if (tableEnsured) return;
  try {
    await env.DB.prepare(ENSURE_TABLE_SQL).run();
    await env.DB.prepare(ENSURE_INDEX_SQL).run();
    await env.DB.prepare(ENSURE_RATING_IDX_SQL).run();
    tableEnsured = true;
  } catch (err) {
    console.warn("[ai-feedback] no se pudo crear tabla:", err?.message || err);
    throw err;
  }
}

function clip(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

export async function handleAIFeedback(request, env, ctx) {
  if (!env?.DB) {
    return json({
      ok: false,
      error: "D1 no disponible en este entorno."
    }, 503, { "cache-control": "no-store" });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Body JSON inválido." }, 400, { "cache-control": "no-store" });
  }

  const rating = String(body?.rating || "").trim().toLowerCase();
  if (rating !== "up" && rating !== "down") {
    return json({ ok: false, error: "Rating inválido. Usá 'up' o 'down'." }, 400, { "cache-control": "no-store" });
  }

  const entry = {
    ts: clip(body?.ts || new Date().toISOString(), 40),
    rating,
    question: clip(body?.question, 500),
    answer: clip(body?.answer, 2000),
    app_version: clip(body?.appVersion, 60),
    active_tab: clip(body?.activeTab, 40),
    comment: clip(body?.comment, 500),
    user_agent: clip(request.headers.get?.("user-agent") || "", 240)
  };

  try {
    await ensureTable(env);
    await env.DB
      .prepare(`INSERT INTO ai_feedback (ts, rating, question, answer, app_version, active_tab, comment, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(entry.ts, entry.rating, entry.question, entry.answer, entry.app_version, entry.active_tab, entry.comment, entry.user_agent)
      .run();

    return json({
      ok: true,
      message: "Feedback registrado. ¡Gracias!",
      appVersion: APP_VERSION
    }, 200, { "cache-control": "no-store" });
  } catch (err) {
    console.error("[ai-feedback]", err);
    captureException(err, env, ctx, { where: "handleAIFeedback", request, appVersion: APP_VERSION });
    return json({
      ok: false,
      error: humanizeError(err)
    }, 500, { "cache-control": "no-store" });
  }
}

/**
 * Endpoint auxiliar GET /api/ai/feedback-stats
 * Para usar en un panel interno /admin/ai-stats.
 * Devuelve totales por rating + últimos N.
 */
export async function handleAIFeedbackStats(url, env, ctx) {
  if (!env?.DB) {
    return json({ ok: false, error: "D1 no disponible." }, 503, { "cache-control": "no-store" });
  }
  try {
    await ensureTable(env);
    const limit = Math.min(500, Math.max(10, Number(url.searchParams.get("limit") || 100)));

    const [totals, recent] = await Promise.all([
      env.DB.prepare(`SELECT rating, COUNT(*) AS total FROM ai_feedback GROUP BY rating`).all(),
      env.DB.prepare(`SELECT id, ts, rating, question, answer, app_version, active_tab, comment
                      FROM ai_feedback
                      ORDER BY id DESC
                      LIMIT ?`).bind(limit).all()
    ]);

    const breakdown = { up: 0, down: 0 };
    for (const row of totals.results || []) {
      if (row?.rating === "up") breakdown.up = Number(row.total || 0);
      if (row?.rating === "down") breakdown.down = Number(row.total || 0);
    }
    const total = breakdown.up + breakdown.down;
    const percentUp = total ? +((breakdown.up / total) * 100).toFixed(1) : null;

    return json({
      ok: true,
      totals: breakdown,
      percentUp,
      recent: recent.results || [],
      appVersion: APP_VERSION
    }, 200, { "cache-control": "no-store" });
  } catch (err) {
    console.error("[ai-feedback-stats]", err);
    captureException(err, env, ctx, { where: "handleAIFeedbackStats", appVersion: APP_VERSION });
    return json({ ok: false, error: humanizeError(err) }, 500, { "cache-control": "no-store" });
  }
}
