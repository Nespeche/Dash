// =============================================================
// email-handler.js — v31
// -----------------------------------------------------------------
// Endpoint: POST /api/email/report
// Envía un reporte on-demand con los KPIs y highlights que llegan
// en el body. Útil como tool del asistente IA o como botón "enviar
// por email" desde el frontend.
//
// Body JSON esperado:
//   {
//     to: "user@example.com" | ["a@x", "b@y"],  (opcional: usa RESEND_TO si no)
//     subject?: "...",
//     title: "Reporte diario ventas",
//     subtitle?: "2026-04-16",
//     kpis: [{ label, value, delta?, deltaPositive? }, ...],
//     highlights?: ["...", ...]
//   }
// =============================================================
import { APP_VERSION } from "../../../shared/version.js";
import { json, humanizeError } from "../../lib/http.js";
import { sendEmail, renderReportHtml } from "../../lib/resend.js";
import { captureException } from "../../lib/sentry-lite.js";

export async function handleEmailReport(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Body JSON inválido." }, 400, { "cache-control": "no-store" });
  }

  const to = body?.to || env?.RESEND_TO || null;
  if (!to) {
    return json({
      ok: false,
      error: "Falta destinatario. Enviá 'to' en el body o configurá RESEND_TO en wrangler.toml."
    }, 400, { "cache-control": "no-store" });
  }

  const title = String(body?.title || "Reporte Ventas Dash").slice(0, 180);
  const subtitle = String(body?.subtitle || new Date().toLocaleDateString("es-AR", { dateStyle: "long" })).slice(0, 200);
  const subject = String(body?.subject || title).slice(0, 240);
  const kpis = Array.isArray(body?.kpis) ? body.kpis.slice(0, 6) : [];
  const highlights = Array.isArray(body?.highlights) ? body.highlights.slice(0, 10) : [];

  if (!kpis.length && !highlights.length) {
    return json({
      ok: false,
      error: "Enviá al menos un KPI o un highlight."
    }, 400, { "cache-control": "no-store" });
  }

  try {
    const html = renderReportHtml({ title, subtitle, kpis, highlights,
      footerNote: `Ventas Dash · ${APP_VERSION}`
    });

    const result = await sendEmail(env, { to, subject, html });
    if (!result.ok) {
      return json({
        ok: false,
        error: result.error || "Envío falló",
        note: !env?.RESEND_API_KEY ? "Configurá RESEND_API_KEY en wrangler.toml [vars]" : null
      }, 502, { "cache-control": "no-store" });
    }

    return json({
      ok: true,
      emailId: result.id,
      message: "Reporte enviado.",
      appVersion: APP_VERSION
    }, 200, { "cache-control": "no-store" });
  } catch (err) {
    console.error("[email-handler]", err);
    captureException(err, env, ctx, { where: "handleEmailReport", appVersion: APP_VERSION });
    return json({ ok: false, error: humanizeError(err) }, 500, { "cache-control": "no-store" });
  }
}
