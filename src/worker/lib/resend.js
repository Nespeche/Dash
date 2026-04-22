// =============================================================
// resend.js — v31
// -----------------------------------------------------------------
// Cliente minimalista para la API de Resend.com.
// Plan gratuito: 100 emails/día, 3.000/mes.
//
// Requiere en wrangler.toml:
//   [vars]
//   RESEND_API_KEY = "re_xxxxxxxxxxxx"
//   RESEND_FROM    = "ventas@tudominio.com"
//   RESEND_TO      = "coord@empresa.com"   (opcional, default para reportes)
//
// Si RESEND_API_KEY no está configurada, todas las llamadas devuelven
// { ok:false, error:"no configurado" } sin hacer request. Zero-cost fail.
// =============================================================

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Envía un email via Resend.
 *
 * @param {object} env
 * @param {object} opts - { to, subject, html, text, from? }
 * @returns {Promise<{ok:boolean, id?:string, error?:string}>}
 */
export async function sendEmail(env, { to, subject, html, text, from } = {}) {
  const apiKey = env?.RESEND_API_KEY || "";
  const sender = from || env?.RESEND_FROM || "";

  if (!apiKey) return { ok: false, error: "RESEND_API_KEY no configurado" };
  if (!sender)  return { ok: false, error: "RESEND_FROM no configurado" };
  if (!to || !subject || (!html && !text)) {
    return { ok: false, error: "faltan campos: to/subject/html|text" };
  }

  const recipients = Array.isArray(to) ? to : [to];

  try {
    const res = await fetchWithTimeout(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: sender,
        to: recipients,
        subject: String(subject || "").slice(0, 240),
        html: html || undefined,
        text: text || undefined
      })
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: payload?.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: payload?.id || null };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Template HTML básico para reportes diarios/semanales.
 */
export function renderReportHtml({ title, subtitle, kpis = [], highlights = [], footerNote = "" }) {
  const kpiHtml = kpis.map(k => `
    <td style="padding:18px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;text-align:center;min-width:120px">
      <div style="font:600 11px/1.3 Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.6px">${escapeHtml(k.label)}</div>
      <div style="font:800 22px/1.1 Arial,sans-serif;color:#0f172a;margin-top:6px">${escapeHtml(k.value)}</div>
      ${k.delta ? `<div style="font:600 11px/1.3 Arial,sans-serif;color:${k.deltaPositive ? "#059669" : "#dc2626"};margin-top:4px">${escapeHtml(k.delta)}</div>` : ""}
    </td>
  `).join("");

  const highlightsHtml = highlights.length
    ? `<h3 style="font:700 14px/1.3 Arial,sans-serif;color:#0f172a;margin:24px 0 8px">Lo más destacado</h3>
       <ul style="padding-left:20px;color:#334155;font:400 13px/1.5 Arial,sans-serif">
         ${highlights.map(h => `<li style="margin-bottom:4px">${escapeHtml(h)}</li>`).join("")}
       </ul>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px 28px 24px;border:1px solid #e2e8f0">
    <div style="font:800 20px/1.2 Arial,sans-serif;color:#d97706">VENTAS <span style="color:#0f172a">DASH</span></div>
    <h1 style="font:700 22px/1.25 Arial,sans-serif;color:#0f172a;margin:14px 0 4px">${escapeHtml(title)}</h1>
    <div style="font:500 13px/1.4 Arial,sans-serif;color:#64748b;margin-bottom:18px">${escapeHtml(subtitle || "")}</div>
    <table role="presentation" cellpadding="0" cellspacing="8" style="width:100%;border-collapse:separate"><tr>${kpiHtml}</tr></table>
    ${highlightsHtml}
    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e8f0;font:400 11px/1.5 Arial,sans-serif;color:#94a3b8">
      ${escapeHtml(footerNote || "Reporte generado automáticamente por Ventas Dash.")}
    </div>
  </div>
</body></html>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
