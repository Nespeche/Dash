/* bcra-widget.js — v30
 * Widget de cotización USD en el header.
 * Fetch a /api/bcra/dolar (que internamente cachea 10min en CF).
 * Refresh automático cada 5 min.
 */

const REFRESH_MS = 5 * 60 * 1000;
const FALLBACK_PILL_HTML = '<span class="bcra-icn">💵</span><span class="bcra-lbl">USD</span> <span class="bcra-val">—</span>';

function fmtArs(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function buildTooltip(payload) {
  const dolares = Array.isArray(payload?.dolares) ? payload.dolares : [];
  if (!dolares.length && !payload?.bcra) return "";
  const rows = dolares
    .filter(d => d && d.casa)
    .slice(0, 8)
    .map(d => `<div class="bcra-tt-row"><span class="lbl">${d.nombre || d.casa}</span><span class="val">$${fmtArs(d.venta)}</span></div>`)
    .join("");
  const fechaSrc = dolares[0]?.fechaActualizacion || payload?.bcra?.fecha || payload?.fetchedAt;
  const fechaTxt = fechaSrc ? new Date(fechaSrc).toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—";
  return `<div class="bcra-tt-body">${rows}<div class="bcra-tt-foot">Fuente: BCRA + dolarapi.com · Actualizado ${fechaTxt}</div></div>`;
}

async function fetchOnce(apiBase, getAuthToken) {
  const headers = { Accept: "application/json" };
  const token = typeof getAuthToken === "function" ? getAuthToken() : "";
  if (token) headers.Authorization = `Basic ${token}`;
  const res = await fetch(`${apiBase}/bcra/dolar`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function pickPrimary(payload) {
  // Prioridad: oficial → mayorista → blue
  const dolares = Array.isArray(payload?.dolares) ? payload.dolares : [];
  const find = key => dolares.find(d => String(d?.casa || "").toLowerCase() === key);
  return find("oficial") || find("mayorista") || find("blue") || dolares[0] || null;
}

export function initBcraWidget({ apiBase, getAuthToken }) {
  const pill = document.getElementById("bcraPill");
  if (!pill) return;

  let timer = null;
  async function tick() {
    try {
      const payload = await fetchOnce(apiBase, getAuthToken);
      if (!payload?.ok) throw new Error(payload?.error || "Cotización no disponible");
      const primary = pickPrimary(payload);
      pill.classList.remove("loading", "error");
      const valor = primary ? `$${fmtArs(primary.venta)}` : "—";
      const sub = primary ? `<span class="bcra-sub">${primary.nombre || primary.casa}</span>` : "";
      pill.innerHTML = `<span class="bcra-icn">💵</span><span class="bcra-lbl">USD</span> <span class="bcra-val">${valor}</span> ${sub}${buildTooltip(payload)}`;
      pill.title = `Cotización USD ${primary?.nombre || ""}: $${fmtArs(primary?.venta)} (vendedor)`;
    } catch (err) {
      console.warn("[bcra-widget]", err);
      pill.classList.add("error");
      pill.classList.remove("loading");
      pill.innerHTML = FALLBACK_PILL_HTML;
      pill.title = `BCRA no disponible: ${err.message || err}`;
    }
  }

  tick();
  timer = setInterval(tick, REFRESH_MS);
  return () => { if (timer) clearInterval(timer); };
}
