import { APP_VERSION } from "../../../shared/version.js";
import { humanizeError, json } from "../../lib/http.js";
import { queryAll, queryFirst } from "../../lib/db.js";
import {
  buildWhere,
  hasBusinessFilter,
  hasDateFilter,
  hasDetailGroupFilter,
  hasProjectionGroupFilter,
  normalizeStringList
} from "../../lib/filters.js";
import {
  monthNameEs,
  parseProjectionCompareContext,
  parseIsoDateParts
} from "../../lib/dates.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { buildCurrentDaySource, buildHistoricalMonthSource, canUseCurrentDayScope, canUseHistoricalMonthScope } from "../../lib/scope.js";
import { trackAIChat } from "../../lib/analytics.js";

// v30 - modelo principal y cadena de fallback. Si Workers AI no responde
// con uno se intenta con el siguiente. Podés sobreescribir el primario con env.AI_MODEL.
const DEFAULT_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_AI_MODELS = ["@cf/meta/llama-3.1-70b-instruct", "@cf/meta/llama-3.1-8b-instruct"];
const MAX_TOKENS = 1800; // v39: aumentado para soportar informes ejecutivos completos
const MAX_HISTORY_MESSAGES = 6;
const DEFAULT_RANK_LIMIT = 5;
const AI_DIMS = ["coordinador", "agente", "cliente", "grupo", "projGroups", "detailGroups", "marca", "codProd"];

const MONTHS_ES = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  set: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12
};

const BUSINESS_REGION_ALIASES = {
  amba: ["CS/AV"],
  interior: ["MIENKO", "BLANCO"],
  fresco: ["JEF"],
  especiales: ["ESPECIALES"]
};

const EXTRA_COLUMN_MAP = {
  fecha: "fecha",
  cliente: "clientName",
  nombre_cliente: "clientName",
  cod_cliente: "cliente",
  grupo: "grupo",
  grupo_familia: "grupo",
  marca: "marca",
  coordinador: "coordinador",
  agente: "agentName",
  cod_agente: "agente",
  producto: "productName",
  producto_desc: "productName",
  cod_producto: "codProd",
  region: "region",
  kilos: "kilos"
};

const LOOKUP_CACHE = {
  value: null,
  expiresAt: 0,
  pending: null
};
const LOOKUP_TTL_MS = 5 * 60 * 1000;

async function safeQueryAll(env, sql, params = [], fallback = []) {
  try {
    return await queryAll(env, sql, params);
  } catch (error) {
    console.warn("[ai-handler] queryAll fallback", error?.message || error);
    return fallback;
  }
}

async function safeQueryFirst(env, sql, params = [], fallback = null) {
  try {
    return await queryFirst(env, sql, params);
  } catch (error) {
    console.warn("[ai-handler] queryFirst fallback", error?.message || error);
    return fallback;
  }
}

function fmtKg(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: v % 1 ? 1 : 0 });
}

function fmtPct(value) {
  return Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function fmtSigned(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n).toLocaleString("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: Math.abs(n) % 1 ? 1 : 0 });
  if (!n) return "0";
  return `${n > 0 ? "+" : "-"}${abs}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values = []) {
  return [...new Set((values || []).map(v => String(v || "").trim()).filter(Boolean))];
}

function normalizeExtraColumnFilters(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, values] of Object.entries(raw)) {
    const normalizedKey = normalizeText(key).replace(/\s+/g, "_");
    const list = uniqueStrings(Array.isArray(values) ? values : [values]).slice(0, 80);
    if (normalizedKey && list.length) out[normalizedKey] = list;
  }
  return out;
}

function parseContextFilters(ctx) {
  const period = ctx?.period && typeof ctx.period === "object" ? ctx.period : {};
  const filters = ctx?.filters && typeof ctx.filters === "object" ? ctx.filters : {};

  const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(period.desde || "").trim()) ? String(period.desde).trim() : null;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(period.hasta || "").trim()) ? String(period.hasta).trim() : null;

  // v30: capturamos también los labels (nombres legibles), el sub-modo del
  // explorador y la configuración de proyección. Esto le da al LLM contexto
  // mucho más rico — puede responder "estás mirando coordinador MIENKO con
  // grupo SECCION X" en vez de "estás mirando código MNK con grupo abc".
  return {
    desde,
    hasta,
    coordinador: String(filters.coordinador || "").trim(),
    coordinadorLabel: String(filters.coordinadorLabel || "").trim(),
    agente: String(filters.agente || "").trim(),
    agenteLabel: String(filters.agenteLabel || "").trim(),
    cliente: String(filters.cliente || "").trim(),
    clienteLabel: String(filters.clienteLabel || "").trim(),
    grupo: String(filters.grupo || "").trim(),
    grupoLabel: String(filters.grupoLabel || "").trim(),
    marca: String(filters.marca || "").trim(),
    marcaLabel: String(filters.marcaLabel || "").trim(),
    region: String(filters.region || "").trim(),
    regionLabel: String(filters.regionLabel || "").trim(),
    codProd: normalizeStringList(filters.codProd || [], 20),
    codProdLabels: normalizeStringList(filters.codProdLabels || [], 20),
    projGroups: normalizeStringList(filters.projGroups || [], 20),
    detailGroups: normalizeStringList(filters.detailGroups || [], 20),
    extraColumnFilters: normalizeExtraColumnFilters(filters.extraColumnFilters),
    activeTab: String(ctx?.activeTab || "detalle").trim() || "detalle",
    tablePreview: Array.isArray(ctx?.tablePreview) ? ctx.tablePreview.slice(0, 5) : [],
    detailExplorer: ctx?.detailExplorer && typeof ctx.detailExplorer === "object" ? {
      view: String(ctx.detailExplorer.view || "").trim(),
      sort: String(ctx.detailExplorer.sort || "").trim(),
      pageSize: Number(ctx.detailExplorer.pageSize || 0) || null
    } : null,
    projectionCompare: ctx?.projectionCompare && typeof ctx.projectionCompare === "object" ? {
      diasHabiles: Number(ctx.projectionCompare.diasHabiles || 0) || null,
      diasTranscurridos: Number(ctx.projectionCompare.diasTranscurridos || 0) || null,
      mesReferencia: String(ctx.projectionCompare.mesReferencia || "").trim()
    } : null
  };
}

function hasAnyAiFilter(f) {
  return Boolean(
    hasBusinessFilter(f) ||
    hasDateFilter(f) ||
    hasProjectionGroupFilter(f) ||
    hasDetailGroupFilter(f) ||
    f?.region ||
    (Array.isArray(f?.coordinadorList) && f.coordinadorList.length) ||
    Object.keys(f?.extraColumnFilters || {}).length
  );
}

function sanitizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  return rawHistory
    .slice(-MAX_HISTORY_MESSAGES)
    .filter(item => item && typeof item === "object")
    .map(item => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").trim().slice(0, 1200)
    }))
    .filter(item => item.content);
}

function clampIsoRange(desde, hasta) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(desde || "")) ? String(desde) : "";
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(hasta || "")) ? String(hasta) : "";
  if (start && end && start > end) return { desde: end, hasta: start };
  return { desde: start || null, hasta: end || null };
}

function monthRangeUtc(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    desde: start.toISOString().slice(0, 10),
    hasta: end.toISOString().slice(0, 10)
  };
}

function buildAvailabilityWindow(range, year) {
  const minParts = parseIsoDateParts(range?.min || "");
  const maxParts = parseIsoDateParts(range?.max || "");
  if (!minParts || !maxParts) return null;

  const from = range.min;
  const to = range.max;
  if (minParts.year === year && maxParts.year === year) return { desde: from, hasta: to };
  if (minParts.year > year || maxParts.year < year) return null;
  return {
    desde: minParts.year === year ? from : `${year}-01-01`,
    hasta: maxParts.year === year ? to : `${year}-12-31`
  };
}

function buildMessageSummary(message) {
  return String(message || "").trim().replace(/\s+/g, " ").slice(0, 240);
}


const ENTITY_STOPWORDS = new Set([
  "ventas", "venta", "kilo", "kilos", "kg", "total", "totales", "mes", "meses", "del", "de", "la", "el", "los", "las",
  "para", "por", "con", "sin", "entre", "comparar", "compara", "comparame", "comparativa", "vs", "versus", "contra",
  "cliente", "clientes", "producto", "productos", "codigo", "cod", "trae", "traeme", "traer", "quiero",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "sept", "set", "oct", "nov", "dic",
  "ano", "ytd", "actual", "historico", "periodo", "disponible", "consulta", "dame", "decime", "decir"
]);

function buildEntitySearchSpans(message) {
  const normalized = normalizeText(message)
    .replace(/[^a-z0-9/\- ]+/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const rawTokens = normalized.split(" ").filter(Boolean);
  const tokens = rawTokens.filter(token => {
    if (!token) return false;
    if (ENTITY_STOPWORDS.has(token)) return false;
    if (/^\d{1,2}$/.test(token)) return false;
    return true;
  });

  const spans = [];
  const pushSpan = value => {
    const cleaned = String(value || "").trim();
    if (!cleaned) return;
    if (cleaned.length < 3 && !/^\d{3,}$/.test(cleaned)) return;
    spans.push(cleaned);
  };

  for (const token of tokens) pushSpan(token);

  for (let size = Math.min(5, tokens.length); size >= 2; size -= 1) {
    for (let i = 0; i <= tokens.length - size; i += 1) {
      pushSpan(tokens.slice(i, i + size).join(" "));
    }
  }

  for (const match of normalized.match(/\b\d{3,}\b/g) || []) pushSpan(match);
  for (const match of normalized.match(/\b[a-z0-9]+(?:[\/-][a-z0-9]+)+\b/g) || []) pushSpan(match);

  return [...new Set(spans)].sort((a, b) => b.length - a.length || a.localeCompare(b, "es"));
}

function dedupeCatalogItems(rows = [], key = "codigo") {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const code = String(row?.[key] || "").trim();
    const name = String(row?.nombre || "").trim();
    const search = String(row?.search || "").trim();
    const dedupeKey = `${code}::${name}::${search}`;
    if (!code && !name) continue;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ codigo: code, nombre: name, search });
  }
  return out;
}

function scoreCatalogCandidate(message, span, row) {
  const messageNorm = normalizeText(message);
  const spanNorm = normalizeText(span);
  const codeNorm = normalizeText(row?.codigo || "");
  const nameNorm = normalizeText(row?.nombre || "");
  const searchNorm = normalizeText(row?.search || row?.nombre || "");
  if (!spanNorm) return 0;

  let score = 0;
  if (codeNorm && spanNorm === codeNorm) score = Math.max(score, 1000 + codeNorm.length);
  else if (codeNorm && /^\d{3,}$/.test(spanNorm) && codeNorm.startsWith(spanNorm)) score = Math.max(score, 920 + spanNorm.length);
  else if (codeNorm && containsToken(messageNorm, codeNorm)) score = Math.max(score, 900 + codeNorm.length);

  if (searchNorm && searchNorm === spanNorm) score = Math.max(score, 860 + spanNorm.length);
  if (nameNorm && nameNorm === spanNorm) score = Math.max(score, 850 + spanNorm.length);
  if (searchNorm && searchNorm.includes(spanNorm)) score = Math.max(score, 720 + spanNorm.length);
  if (nameNorm && nameNorm.includes(spanNorm)) score = Math.max(score, 680 + spanNorm.length);

  const spanWords = spanNorm.split(" ").filter(Boolean).length;
  if (score && spanWords > 1) score += Math.min(40, spanWords * 8);
  return score;
}

function findBestCatalogMatch(message, rows = []) {
  const spans = buildEntitySearchSpans(message);
  if (!spans.length || !rows.length) return null;

  let best = null;
  for (const span of spans) {
    for (const row of rows) {
      const score = scoreCatalogCandidate(message, span, row);
      if (!score) continue;
      if (!best || score > best.score || (score === best.score && span.length > best.span.length)) {
        best = { row, span, score };
      }
    }
  }

  if (!best) return null;
  const isNumericCode = /^\d{3,}$/.test(best.span) && best.score >= 900;
  const isMultiwordPartial = best.span.includes(" ") && best.score >= 720;
  const isLongSingleWordPartial = !best.span.includes(" ") && best.span.length >= 5 && best.score >= 720;
  const strongEnough = best.score >= 760 || isNumericCode || isMultiwordPartial || isLongSingleWordPartial;
  return strongEnough ? best : null;
}

function containsToken(text, token) {
  const normalizedText = normalizeText(text);
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) return false;
  if (/^[a-z0-9\/.-]{1,6}$/i.test(normalizedToken)) {
    const escaped = normalizedToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalizedText);
  }
  return normalizedText.includes(normalizedToken);
}

function detectRankingKinds(normalizedMessage) {
  const kinds = new Set();
  if (/\b(top|ranking|rank|mejores?|principales?|lideres?)\b/.test(normalizedMessage)) {
    if (/\bclientes?\b/.test(normalizedMessage)) kinds.add("clientes");
    if (/\bgrupos?\b|\bfamilia\b|\brubro\b|\blinea\b/.test(normalizedMessage)) kinds.add("grupos");
    if (/\bmarcas?\b/.test(normalizedMessage)) kinds.add("marcas");
    if (/\bagentes?\b|\bvendedores?\b/.test(normalizedMessage)) kinds.add("agentes");
    if (/\bcoordinadores?\b/.test(normalizedMessage)) kinds.add("coordinadores");
    if (/\bproductos?\b/.test(normalizedMessage)) kinds.add("productos");
    if (/\bregiones?\b|\bcanales?\b/.test(normalizedMessage)) kinds.add("regiones");
  }
  if (!kinds.size && /\bpor region\b|\bpor regiones\b/.test(normalizedMessage)) kinds.add("regiones");
  if (!kinds.size && /\bpor coordinador\b|\bcoordinadores?\b/.test(normalizedMessage)) kinds.add("coordinadores");
  if (!kinds.size && /\bpor agente\b|\bagentes?\b|\bvendedores?\b/.test(normalizedMessage)) kinds.add("agentes");
  if (!kinds.size && /\bpor grupo\b|\bpor familia\b|\brubro\b|\blinea\b/.test(normalizedMessage)) kinds.add("grupos");
  if (!kinds.size && /\bpor producto\b|\bproductos?\b/.test(normalizedMessage)) kinds.add("productos");
  return [...kinds];
}

function detectIntent(normalizedMessage) {
  return {
    wantsAvailability: /\brango\b|\bdisponib\w*\b|\bultima fecha\b|\bultimo dia\b|\bhasta que fecha\b/.test(normalizedMessage),
    wantsCompare: /\bcompar\w*\b|\bvs\b|\bversus\b|\bcontra\b|\bytd\b|\ba[ñn]o anterior\b/.test(normalizedMessage),
    wantsYtd: /\bytd\b|\bacumulad\w*\b/.test(normalizedMessage),
    wantsNewClients: /\bclientes? nuevos?\b/.test(normalizedMessage),
    wantsLostClients: /\bclientes? perdid\w*\b/.test(normalizedMessage),
    wantsTopMovers: /\b(crecier\w*|cre[cz]i\w*|subier\w*|m[aá]s creci\w*|m[aá]s subier\w*|cay[oeó]\w*|ba?j\w*|m[aá]s caj?\w*|m[aá]s perd\w*)\b/.test(normalizedMessage),
    wantsProjection: /\bproye(cci[oó]n|ctad\w*)\b|\bestimaci[oó]n\b|\bcierre del mes\b|\bcierre proyectad\w*\b/.test(normalizedMessage),
    wantsTrend: /\btendenci\w*\b|\bevoluci[oó]n\b|\bserie\b|\bmensual\b|\bdiari\w*\b/.test(normalizedMessage),
    wantsExplain: /\bpor qu[eé]\b|\bque pas[oó]\b|\bque cambio\b|\bexplica\w*\b|\bmotiv\w*\b|\bcaus\w*\b/.test(normalizedMessage),
    wantsHelp: /\bque pod[eé]s hacer\b|\bque pregunt\w*\b|\bayuda\b|\bcomo te uso\b|\bcomo funcion\w*\b|\bque sab[eé]s\b|\bque hac[eé]s\b|\bcapacidades\b|\bopciones\b/.test(normalizedMessage),
    // v39: nuevos intents
    wantsReport: /\binforme\b|\breporte\b|\bresumen ejecutivo\b|\breporte mensual\b|\bdame un resumen completo\b|\binforme completo\b|\binforme de ventas\b/.test(normalizedMessage),
    wantsFrequency: /\bfrecuenci\w*\b|\bcadencia\b|\bcuanto compra\b|\bclientes? frecuentes?\b|\bregularidad\b|\bcompra por semana\b|\bveces? por mes\b|\binactiv\w*\b|\bdormid\w*\b|\bclientes? en riesgo\b|\bpatron.*compra\b|\bcompra.*patron\b/.test(normalizedMessage),
    wantsTicket: /\bticket\b|\bpedido promedio\b|\bpor compra\b|\bkg por pedido\b|\bcuanto pide\b|\btama[ñn]o.*pedido\b|\bpedido.*promedio\b/.test(normalizedMessage),
    wantsAlert: /\balertas?\b|\ben riesgo\b|\batencion\b|\bproblema\b|\bpreocupa\b|\bcaida\b|\bclientes? que no compran\b|\bbaja\b|\bpeligro\b|\balerta comercial\b/.test(normalizedMessage),
    rankingKinds: detectRankingKinds(normalizedMessage)
  };
}

function detectQueryMode(normalizedMessage, intent) {
  if (intent.wantsHelp) return "help";
  if (intent.wantsAvailability) return "availability";
  if (intent.wantsNewClients || intent.wantsLostClients) return "client-delta";
  if (intent.wantsTopMovers) return "top-movers";
  if (intent.wantsProjection) return "projection";
  if (intent.wantsCompare || intent.wantsYtd) return "compare";
  // v39: nuevos modos (tienen prioridad sobre ranking genérico)
  if (intent.wantsReport) return "report";
  if (intent.wantsAlert) return "alert";
  if (intent.wantsFrequency) return "frequency";
  if (intent.wantsTicket) return "ticket";
  if (Array.isArray(intent.rankingKinds) && intent.rankingKinds.length) return "ranking";
  if (/\b(top|ranking|rank|mejores?)\b/.test(normalizedMessage)) return "ranking";
  return "summary";
}

function parseExplicitMonthYears(normalizedMessage) {
  const monthsPattern = Object.keys(MONTHS_ES).sort((a, b) => b.length - a.length).join("|");
  const pairs = [];
  const seen = new Set();

  const pushPair = (monthName, yearText) => {
    const month = MONTHS_ES[normalizeText(monthName)];
    const year = Number(yearText);
    if (!month || !year) return;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ year, month, label: `${monthNameEs(month)} ${year}` });
  };

  const patterns = [
    new RegExp(`\\b(${monthsPattern})\\s+(?:de\\s+)?(20\\d{2})\\b`, "gi"),
    new RegExp(`\\b(20\\d{2})\\s+(?:de\\s+)?(${monthsPattern})\\b`, "gi"),
    /\\b(0?[1-9]|1[0-2])[\\/-](20\\d{2})\\b/g,
    /\\b(20\\d{2})[\\/-](0?[1-9]|1[0-2])\\b/g
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(normalizedMessage))) {
      if (re === patterns[0]) pushPair(match[1], match[2]);
      else if (re === patterns[1]) pushPair(match[2], match[1]);
      else if (re === patterns[2]) pushPair(monthNameEs(Number(match[1])), match[2]);
      else pushPair(monthNameEs(Number(match[2])), match[1]);
    }
  }

  const bareMonths = [];
  const bareMonthRegex = new RegExp(`\\b(${monthsPattern})\\b`, "gi");
  let match;
  while ((match = bareMonthRegex.exec(normalizedMessage))) {
    const month = MONTHS_ES[normalizeText(match[1])];
    if (!month) continue;
    const keyed = pairs.some(item => item.month === month);
    if (!keyed) bareMonths.push(month);
  }

  return { pairs, bareMonths: uniqueStrings(bareMonths.map(String)).map(Number) };
}

function parseExplicitYears(normalizedMessage) {
  return uniqueStrings((normalizedMessage.match(/\b20\d{2}\b/g) || [])).map(Number).filter(Boolean);
}

function buildCompareContextFromCurrentRange(currentRange, compareYear) {
  const url = new URL("https://ventasdash.local/ai-compare");
  url.searchParams.set("compareYear", String(compareYear));
  return parseProjectionCompareContext(url, {
    desde: currentRange.desde,
    hasta: currentRange.hasta
  });
}

function buildPeriodPlan(message, contextFilters, availability) {
  const normalizedMessage = normalizeText(message);
  const intent = detectIntent(normalizedMessage);
  const answerMode = detectQueryMode(normalizedMessage, intent);
  const explicitMonthYears = parseExplicitMonthYears(normalizedMessage);
  const explicitYears = parseExplicitYears(normalizedMessage);
  const contextPeriod = clampIsoRange(contextFilters.desde, contextFilters.hasta);
  const available2026 = buildAvailabilityWindow(availability.current, 2026);
  const available2025 = buildAvailabilityWindow(availability.historical, 2025);

  if (explicitMonthYears.bareMonths.length) {
    const monthName = monthNameEs(explicitMonthYears.bareMonths[0]);
    return {
      mode: "clarify",
      answerMode,
      intent,
      reason: "missing-year",
      answer: `Necesito que me aclares el año para ${monthName}. Puedo responder, por ejemplo, "${monthName.toLowerCase()} 2025" o "${monthName.toLowerCase()} 2026".`
    };
  }

  if (intent.wantsAvailability && !explicitMonthYears.pairs.length && !explicitYears.length && !contextPeriod.desde && !contextPeriod.hasta) {
    return {
      mode: "availability",
      answerMode,
      intent,
      periodLabel: "Disponibilidad general"
    };
  }

  const sortedPairs = explicitMonthYears.pairs.slice().sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const pair2026 = sortedPairs.find(item => item.year === 2026);
  const pair2025 = sortedPairs.find(item => item.year === 2025);

  if ((intent.wantsCompare || (pair2026 && pair2025)) && pair2026 && pair2025) {
    const currentRange = monthRangeUtc(pair2026.year, pair2026.month);
    const compare = buildCompareContextFromCurrentRange(currentRange, pair2025.year);
    return {
      mode: "compare",
      answerMode,
      intent,
      currentRange,
      compare,
      periodLabel: `${monthNameEs(pair2026.month)} ${pair2026.year} vs ${monthNameEs(pair2025.month)} ${pair2025.year}`
    };
  }

  if (pair2026) {
    const currentRange = monthRangeUtc(2026, pair2026.month);
    return {
      mode: "single-current",
      answerMode,
      intent,
      currentRange,
      periodLabel: `${monthNameEs(pair2026.month)} 2026`
    };
  }

  if (pair2025) {
    const histRange = monthRangeUtc(2025, pair2025.month);
    const compare = {
      compareYear: 2025,
      compareMonth: pair2025.month,
      compareYearMonthKey: `${pair2025.year}-${String(pair2025.month).padStart(2, "0")}`,
      historicalClosedMonth: true,
      historicalClosedMonthDesde: histRange.desde,
      historicalClosedMonthHasta: histRange.hasta,
      desde: histRange.desde,
      hasta: histRange.hasta,
      mode: "month",
      yearMonthKeys: [`${pair2025.year}-${String(pair2025.month).padStart(2, "0")}`],
      label: `${monthNameEs(pair2025.month)} 2025`
    };
    return {
      mode: "single-historical",
      answerMode,
      intent,
      compare,
      periodLabel: `${monthNameEs(pair2025.month)} 2025`
    };
  }

  if (intent.wantsYtd) {
    const currentRange = available2026 || contextPeriod;
    if (currentRange?.desde && currentRange?.hasta) {
      const currentYtd = {
        desde: `${String(currentRange.desde).slice(0, 4)}-01-01`,
        hasta: currentRange.hasta
      };
      const compare = buildCompareContextFromCurrentRange(currentYtd, 2025);
      return {
        mode: "compare",
        answerMode,
        intent,
        currentRange: currentYtd,
        compare,
        periodLabel: `YTD ${String(currentRange.hasta).slice(0, 4)} vs 2025`
      };
    }
  }

  if (intent.wantsCompare) {
    const sourceRange = (contextPeriod.desde && contextPeriod.hasta) ? contextPeriod : available2026;
    if (sourceRange?.desde && sourceRange?.hasta) {
      const compare = buildCompareContextFromCurrentRange(sourceRange, 2025);
      return {
        mode: "compare",
        answerMode,
        intent,
        currentRange: sourceRange,
        compare,
        periodLabel: `${sourceRange.desde} → ${sourceRange.hasta} vs ${compare.desde} → ${compare.hasta}`
      };
    }
  }

  if (explicitYears.includes(2026) && !explicitYears.includes(2025)) {
    return {
      mode: "single-current",
      answerMode,
      intent,
      currentRange: available2026,
      periodLabel: available2026 ? `${available2026.desde} → ${available2026.hasta}` : "2026"
    };
  }

  if (explicitYears.includes(2025) && !explicitYears.includes(2026)) {
    return {
      mode: "single-historical",
      answerMode,
      intent,
      compare: {
        compareYear: 2025,
        compareMonth: null,
        compareYearMonthKey: "",
        historicalClosedMonth: false,
        historicalClosedMonthDesde: available2025?.desde || "",
        historicalClosedMonthHasta: available2025?.hasta || "",
        desde: available2025?.desde || "",
        hasta: available2025?.hasta || "",
        mode: "range",
        yearMonthKeys: null,
        label: available2025 ? `${available2025.desde} → ${available2025.hasta}` : "2025"
      },
      periodLabel: available2025 ? `${available2025.desde} → ${available2025.hasta}` : "2025"
    };
  }

  if (contextPeriod.desde && contextPeriod.hasta) {
    return {
      mode: "single-current",
      answerMode,
      intent,
      currentRange: contextPeriod,
      periodLabel: `${contextPeriod.desde} → ${contextPeriod.hasta}`
    };
  }

  return {
    mode: "single-current",
    answerMode,
    intent,
    currentRange: available2026,
    periodLabel: available2026 ? `${available2026.desde} → ${available2026.hasta}` : "2026"
  };
}

async function resolveAvailability(env, runtime) {
  const currentPromise = runtime.hasVentas
    ? safeQueryFirst(env, `SELECT MIN(Fecha) AS min, MAX(Fecha) AS max FROM ventas`, [], { min: null, max: null })
    : Promise.resolve({ min: null, max: null });
  const historicalPromise = runtime.hasVentas2025
    ? safeQueryFirst(env, `SELECT MIN(Fecha) AS min, MAX(Fecha) AS max FROM ventas_2025`, [], { min: null, max: null })
    : Promise.resolve({ min: null, max: null });

  const [current, historical] = await Promise.all([currentPromise, historicalPromise]);
  return {
    current: {
      min: String(current?.min || ""),
      max: String(current?.max || "")
    },
    historical: {
      min: String(historical?.min || ""),
      max: String(historical?.max || "")
    }
  };
}

async function loadLookupCatalog(env, runtime) {
  const now = Date.now();
  if (LOOKUP_CACHE.value && LOOKUP_CACHE.expiresAt > now) return LOOKUP_CACHE.value;
  if (LOOKUP_CACHE.pending) return LOOKUP_CACHE.pending;

  LOOKUP_CACHE.pending = (async () => {
    const coordQueries = [];
    const regionQueries = [];
    const clientQueries = [];
    const productQueries = [];

    if (runtime.hasVentas) {
      coordQueries.push(`SELECT DISTINCT TRIM(Coordinador) AS value FROM ventas WHERE TRIM(COALESCE(Coordinador, '')) <> ''`);
      regionQueries.push(`SELECT DISTINCT TRIM(Region) AS value FROM ventas WHERE TRIM(COALESCE(Region, '')) <> ''`);
    }
    if (runtime.hasVentas2025) {
      coordQueries.push(`SELECT DISTINCT TRIM(Coordinador) AS value FROM ventas_2025 WHERE TRIM(COALESCE(Coordinador, '')) <> ''`);
      regionQueries.push(`SELECT DISTINCT TRIM(Region) AS value FROM ventas_2025 WHERE TRIM(COALESCE(Region, '')) <> ''`);
    }
    if (runtime.hasClientesCatalogo) {
      clientQueries.push(`
        SELECT TRIM(Cod_Cliente) AS codigo, TRIM(Cliente) AS nombre, TRIM(Cliente_Search) AS search
        FROM clientes_catalogo
        WHERE TRIM(COALESCE(Cod_Cliente, '')) <> ''
      `);
    }
    if (runtime.hasVentas2025ClientesCatalogo) {
      clientQueries.push(`
        SELECT TRIM(Cod_Cliente) AS codigo, TRIM(Cliente) AS nombre, TRIM(Cliente_Search) AS search
        FROM ventas_2025_clientes_catalogo
        WHERE TRIM(COALESCE(Cod_Cliente, '')) <> ''
      `);
    }
    if (runtime.hasProductosCatalogo) {
      productQueries.push(`
        SELECT TRIM(Cod_Producto) AS codigo, TRIM(Producto_Desc) AS nombre, TRIM(Producto_Search) AS search
        FROM productos_catalogo
        WHERE TRIM(COALESCE(Cod_Producto, '')) <> ''
      `);
    }
    if (runtime.hasVentas2025ProductosCatalogo) {
      productQueries.push(`
        SELECT TRIM(Cod_Producto) AS codigo, TRIM(Producto_Desc) AS nombre, TRIM(Producto_Search) AS search
        FROM ventas_2025_productos_catalogo
        WHERE TRIM(COALESCE(Cod_Producto, '')) <> ''
      `);
    }

    const coordSql = coordQueries.length ? `${coordQueries.join(' UNION ')} ORDER BY value COLLATE NOCASE ASC` : '';
    const regionSql = regionQueries.length ? `${regionQueries.join(' UNION ')} ORDER BY value COLLATE NOCASE ASC` : '';
    const clientSql = clientQueries.length ? `${clientQueries.join(' UNION ')} ORDER BY nombre COLLATE NOCASE ASC` : '';
    const productSql = productQueries.length ? `${productQueries.join(' UNION ')} ORDER BY nombre COLLATE NOCASE ASC` : '';

    const [coordRows, regionRows, groupRows, brandRows, agentRows, clientRows, productRows] = await Promise.all([
      coordSql ? safeQueryAll(env, coordSql, [], []) : Promise.resolve([]),
      regionSql ? safeQueryAll(env, regionSql, [], []) : Promise.resolve([]),
      runtime.hasScopeCatalogo
        ? safeQueryAll(env, `
            SELECT DISTINCT TRIM(Grupo_Familia) AS value
            FROM scope_catalogo
            WHERE TRIM(COALESCE(Grupo_Familia, '')) <> ''
            ORDER BY value COLLATE NOCASE ASC
          `, [], [])
        : Promise.resolve([]),
      runtime.hasScopeCatalogo
        ? safeQueryAll(env, `
            SELECT DISTINCT TRIM(Marca) AS value
            FROM scope_catalogo
            WHERE TRIM(COALESCE(Marca, '')) <> ''
            ORDER BY value COLLATE NOCASE ASC
          `, [], [])
        : Promise.resolve([]),
      runtime.hasAgentesCatalogo
        ? safeQueryAll(env, `
            SELECT TRIM(Cod_Agente) AS codigo, TRIM(Agente) AS nombre
            FROM agentes_catalogo
            WHERE TRIM(COALESCE(Cod_Agente, '')) <> ''
            ORDER BY nombre COLLATE NOCASE ASC
          `, [], [])
        : Promise.resolve([]),
      clientSql ? safeQueryAll(env, clientSql, [], []) : Promise.resolve([]),
      productSql ? safeQueryAll(env, productSql, [], []) : Promise.resolve([])
    ]);

    const value = {
      coordinadores: coordRows.map(row => String(row.value || '').trim()).filter(Boolean),
      regiones: regionRows.map(row => String(row.value || '').trim()).filter(Boolean),
      grupos: groupRows.map(row => String(row.value || '').trim()).filter(Boolean),
      marcas: brandRows.map(row => String(row.value || '').trim()).filter(Boolean),
      agentes: dedupeCatalogItems(agentRows.map(row => ({ codigo: String(row.codigo || '').trim(), nombre: String(row.nombre || '').trim(), search: String(row.nombre || '').trim() }))),
      clientes: dedupeCatalogItems(clientRows),
      productos: dedupeCatalogItems(productRows)
    };

    LOOKUP_CACHE.value = value;
    LOOKUP_CACHE.expiresAt = Date.now() + LOOKUP_TTL_MS;
    LOOKUP_CACHE.pending = null;
    return value;
  })();

  try {
    return await LOOKUP_CACHE.pending;
  } catch (error) {
    LOOKUP_CACHE.pending = null;
    console.warn('[ai-handler] lookup catalog fallback', error?.message || error);
    return { coordinadores: [], regiones: [], grupos: [], marcas: [], agentes: [], clientes: [], productos: [] };
  }
}

function resolveEntityOverrides(message, lookups) {
  const normalizedMessage = normalizeText(message);
  const overrides = {
    coordinador: "",
    agente: "",
    cliente: "",
    clienteNombre: "",
    grupo: "",
    marca: "",
    region: "",
    coordinadorList: [],
    regionAlias: "",
    codProd: [],
    productoNombre: ""
  };

  for (const [alias, coordinators] of Object.entries(BUSINESS_REGION_ALIASES)) {
    if (containsToken(normalizedMessage, alias)) {
      overrides.regionAlias = alias.toUpperCase();
      overrides.coordinador = "";
      overrides.coordinadorList = coordinators.slice();
      return overrides;
    }
  }

  const coordinator = (lookups.coordinadores || []).find(value => containsToken(normalizedMessage, value));
  if (coordinator) overrides.coordinador = coordinator;

  const region = (lookups.regiones || []).find(value => containsToken(normalizedMessage, value));
  if (region) overrides.region = region;

  const group = (lookups.grupos || []).find(value => containsToken(normalizedMessage, value));
  if (group) overrides.grupo = group;

  const brand = (lookups.marcas || []).find(value => containsToken(normalizedMessage, value));
  if (brand) overrides.marca = brand;

  const agent = (lookups.agentes || []).find(row => containsToken(normalizedMessage, row.codigo) || containsToken(normalizedMessage, row.nombre));
  if (agent) overrides.agente = agent.codigo;

  const clientMatch = findBestCatalogMatch(message, lookups.clientes || []);
  if (clientMatch?.row?.codigo) {
    overrides.cliente = clientMatch.row.codigo;
    overrides.clienteNombre = clientMatch.row.nombre || clientMatch.row.codigo;
  }

  const productMatch = findBestCatalogMatch(message, lookups.productos || []);
  if (productMatch?.row?.codigo) {
    overrides.codProd = [productMatch.row.codigo];
    overrides.productoNombre = productMatch.row.nombre || productMatch.row.codigo;
  }

  return overrides;
}

function mergeFiltersWithOverrides(base, overrides, plan) {
  const merged = {
    ...base,
    codProd: [...(base.codProd || [])],
    projGroups: [...(base.projGroups || [])],
    detailGroups: [...(base.detailGroups || [])],
    extraColumnFilters: { ...(base.extraColumnFilters || {}) },
    coordinadorList: []
  };

  if (plan?.currentRange?.desde || plan?.currentRange?.hasta) {
    merged.desde = plan.currentRange?.desde || null;
    merged.hasta = plan.currentRange?.hasta || null;
  }

  if (overrides.coordinador) {
    merged.coordinador = overrides.coordinador;
    merged.region = "";
    merged.coordinadorList = [];
  }
  if (overrides.agente) merged.agente = overrides.agente;
  if (overrides.cliente) merged.cliente = overrides.cliente;
  if (Array.isArray(overrides.codProd) && overrides.codProd.length) merged.codProd = overrides.codProd.slice();
  if (overrides.grupo) merged.grupo = overrides.grupo;
  if (overrides.marca) merged.marca = overrides.marca;
  if (overrides.region) {
    merged.region = overrides.region;
    merged.coordinador = "";
  }
  if (overrides.regionAlias && Array.isArray(overrides.coordinadorList) && overrides.coordinadorList.length) {
    merged.region = overrides.regionAlias;
    merged.coordinador = "";
    merged.coordinadorList = overrides.coordinadorList.slice();
  }

  return merged;
}

function appendWhere(whereSql, extraClause) {
  if (!extraClause) return whereSql || "";
  return whereSql ? `${whereSql} AND ${extraClause}` : `WHERE ${extraClause}`;
}

function applySourceExtras(source, filters) {
  let whereSql = source.whereSql || "";
  const params = [...(source.params || [])];

  if (Array.isArray(filters.coordinadorList) && filters.coordinadorList.length && source.columns.coordinador) {
    whereSql = appendWhere(whereSql, `${source.columns.coordinador} IN (${filters.coordinadorList.map(() => "?").join(",")})`);
    params.push(...filters.coordinadorList);
  }

  if (filters.region && source.columns.region) {
    whereSql = appendWhere(whereSql, `${source.columns.region} = ?`);
    params.push(filters.region);
  }

  for (const [key, values] of Object.entries(filters.extraColumnFilters || {})) {
    const mapped = EXTRA_COLUMN_MAP[key];
    const column = mapped ? source.columns[mapped] : "";
    const list = uniqueStrings(values).slice(0, 40);
    if (!column || !list.length) continue;
    whereSql = appendWhere(whereSql, `${column} IN (${list.map(() => "?").join(",")})`);
    params.push(...list);
  }

  return {
    ...source,
    whereSql,
    params
  };
}

function buildCurrentRawSource(filters) {
  const scope = buildWhere(filters, AI_DIMS);
  return applySourceExtras({
    fromSql: `FROM ventas v`,
    whereSql: scope.sql,
    params: scope.params,
    columns: {
      fecha: `v.Fecha`,
      kilos: `v.Kilos`,
      registros: `1`,
      cliente: `v.Cod_Cliente`,
      clientName: `v.Cliente`,
      agente: `v.Cod_Agente`,
      agentName: `v.Agente`,
      coordinador: `v.Coordinador`,
      grupo: `v.Grupo_Familia`,
      marca: `v.Marca`,
      region: `v.Region`,
      codProd: `v.Cod_Producto`,
      productName: `v.Producto_Desc`
    },
    sourceLabel: "ventas"
  }, filters);
}

function createNormalizedSource(selectSql, params, sourceLabel, filters) {
  return applySourceExtras({
    fromSql: `FROM (
${selectSql}
    ) ai_base`,
    whereSql: "",
    params,
    columns: {
      fecha: `ai_base.Fecha`,
      kilos: `ai_base.Kilos`,
      registros: `ai_base.Registros`,
      cliente: `ai_base.Cod_Cliente`,
      clientName: `ai_base.Cliente`,
      agente: `ai_base.Cod_Agente`,
      agentName: `ai_base.Agente`,
      coordinador: `ai_base.Coordinador`,
      grupo: `ai_base.Grupo_Familia`,
      marca: `ai_base.Marca`,
      region: `ai_base.Region`,
      codProd: `ai_base.Cod_Producto`,
      productName: `ai_base.Producto_Desc`
    },
    sourceLabel
  }, filters);
}

function buildCurrentAlignedSource(runtime, filters) {
  if (!canUseCurrentDayScope(runtime, filters)) return buildCurrentRawSource(filters);

  const source = buildCurrentDaySource(runtime, filters, AI_DIMS, { factAlias: "d", dimAlias: "ds" });
  const selectSql = `
      SELECT
        ${source.columns.fecha} AS Fecha,
        ${source.columns.cliente} AS Cod_Cliente,
        MIN(COALESCE(c.Cliente, ${source.columns.cliente})) AS Cliente,
        ${source.columns.grupo} AS Grupo_Familia,
        ${source.columns.marca} AS Marca,
        ${source.columns.agente} AS Cod_Agente,
        MIN(COALESCE(a.Agente, ${source.columns.agente})) AS Agente,
        ${source.columns.coordinador} AS Coordinador,
        CAST(NULL AS TEXT) AS Region,
        ${source.columns.codProd} AS Cod_Producto,
        MIN(COALESCE(p.Producto_Desc, ${source.columns.codProd})) AS Producto_Desc,
        COALESCE(SUM(${source.columns.kilos}), 0) AS Kilos,
        COALESCE(SUM(${source.columns.registros}), 0) AS Registros
      ${source.fromSql}
      LEFT JOIN clientes_catalogo c ON c.Cod_Cliente = ${source.columns.cliente}
      LEFT JOIN productos_catalogo p ON p.Cod_Producto = ${source.columns.codProd}
      LEFT JOIN agentes_catalogo a ON a.Cod_Agente = ${source.columns.agente}
      ${source.whereSql}
      GROUP BY ${source.columns.fecha}, ${source.columns.cliente}, ${source.columns.grupo}, ${source.columns.marca}, ${source.columns.agente}, ${source.columns.coordinador}, ${source.columns.codProd}`;
  return createNormalizedSource(selectSql, source.params, `${source.sourceLabel}:aligned-detail`, filters);
}

function buildHistoricalRawSource(compare, filters) {
  const histFilters = { ...filters, desde: compare.desde, hasta: compare.hasta };
  const scope = buildWhere(histFilters, AI_DIMS);
  return applySourceExtras({
    fromSql: `FROM ventas_2025 h`,
    whereSql: scope.sql,
    params: scope.params,
    columns: {
      fecha: `h.Fecha`,
      kilos: `h.Kilos`,
      registros: `1`,
      cliente: `h.Cod_Cliente`,
      clientName: `h.Cliente`,
      agente: `h.Cod_Agente`,
      agentName: `h.Agente`,
      coordinador: `h.Coordinador`,
      grupo: `h.Grupo_Familia`,
      marca: `h.Marca`,
      region: `h.Region`,
      codProd: `h.Cod_Producto`,
      productName: `h.Producto_Desc`
    },
    sourceLabel: "ventas_2025"
  }, histFilters);
}

function buildHistoricalAlignedSource(runtime, compare, filters) {
  if (!canUseHistoricalMonthScope(runtime, compare)) return buildHistoricalRawSource(compare, filters);

  const histFilters = { ...filters, desde: compare.desde, hasta: compare.hasta };
  const source = buildHistoricalMonthSource(runtime, compare, filters, AI_DIMS, { factAlias: "h", dimAlias: "hs" });
  const anchorDate = compare?.historicalClosedMonthHasta || compare?.hasta || compare?.desde || "";
  const selectSql = `
      SELECT
        ? AS Fecha,
        ${source.columns.cliente} AS Cod_Cliente,
        MIN(COALESCE(hc.Cliente, cc.Cliente, ${source.columns.cliente})) AS Cliente,
        ${source.columns.grupo} AS Grupo_Familia,
        ${source.columns.marca} AS Marca,
        ${source.columns.agente} AS Cod_Agente,
        MIN(COALESCE(a.Agente, ${source.columns.agente})) AS Agente,
        ${source.columns.coordinador} AS Coordinador,
        CAST(NULL AS TEXT) AS Region,
        ${source.columns.codProd} AS Cod_Producto,
        MIN(COALESCE(hp.Producto_Desc, pc.Producto_Desc, ${source.columns.codProd})) AS Producto_Desc,
        COALESCE(SUM(${source.columns.kilos}), 0) AS Kilos,
        COALESCE(SUM(${source.columns.registros}), 0) AS Registros
      ${source.fromSql}
      LEFT JOIN ventas_2025_clientes_catalogo hc ON hc.Cod_Cliente = ${source.columns.cliente}
      LEFT JOIN clientes_catalogo cc ON cc.Cod_Cliente = ${source.columns.cliente}
      LEFT JOIN ventas_2025_productos_catalogo hp ON hp.Cod_Producto = ${source.columns.codProd}
      LEFT JOIN productos_catalogo pc ON pc.Cod_Producto = ${source.columns.codProd}
      LEFT JOIN agentes_catalogo a ON a.Cod_Agente = ${source.columns.agente}
      ${source.whereSql}
      GROUP BY ${source.columns.cliente}, ${source.columns.grupo}, ${source.columns.marca}, ${source.columns.agente}, ${source.columns.coordinador}, ${source.columns.codProd}`;
  return createNormalizedSource(selectSql, [anchorDate, ...source.params], `ventas_2025_mes_scope+ventas_2025_scope_dim:aligned-projection`, histFilters);
}

function shouldForceRawSource(filters, plan) {
  return Boolean(
    filters.region ||
    (Array.isArray(filters.coordinadorList) && filters.coordinadorList.length) ||
    (Array.isArray(filters.extraColumnFilters?.region) && filters.extraColumnFilters.region.length) ||
    plan?.intent?.rankingKinds?.includes("regiones")
  );
}

function resolveAiSources(runtime, filters, plan) {
  const forceRaw = shouldForceRawSource(filters, plan);
  const currentSource = forceRaw ? buildCurrentRawSource(filters) : buildCurrentAlignedSource(runtime, filters);

  let historicalSource = null;
  let compareSourceMeta = null;
  if (plan?.mode === "compare" || plan?.mode === "single-historical") {
    const compare = plan.compare;
    historicalSource = (forceRaw || !canUseHistoricalMonthScope(runtime, compare))
      ? buildHistoricalRawSource(compare, filters)
      : buildHistoricalAlignedSource(runtime, compare, filters);
    compareSourceMeta = {
      current: currentSource?.sourceLabel || null,
      historical: historicalSource?.sourceLabel || null,
      compareYear: compare?.compareYear || null,
      compareMode: compare?.mode || null,
      compareRange: compare ? { desde: compare.desde, hasta: compare.hasta } : null
    };
  }

  return {
    currentSource,
    historicalSource,
    compareSourceMeta
  };
}

async function querySourceSummary(env, source) {
  return queryFirst(env, `
    SELECT
      COALESCE(SUM(${source.columns.kilos}), 0) AS kilos,
      COUNT(DISTINCT NULLIF(${source.columns.cliente}, '')) AS clientes,
      COUNT(DISTINCT NULLIF(${source.columns.agente}, '')) AS agentes,
      COALESCE(SUM(${source.columns.registros}), 0) AS registros,
      MIN(CASE WHEN ${source.columns.fecha} IS NOT NULL THEN ${source.columns.fecha} END) AS fecha_inicio,
      MAX(CASE WHEN ${source.columns.fecha} IS NOT NULL THEN ${source.columns.fecha} END) AS fecha_fin
    ${source.fromSql}
    ${source.whereSql}
  `, source.params);
}

function rankingSpecForKind(kind, source) {
  switch (kind) {
    case "clientes":
      return {
        codeExpr: source.columns.cliente,
        nameExpr: source.columns.clientName,
        groupExpr: `${source.columns.cliente}, ${source.columns.clientName}`,
        orderLabel: "cliente"
      };
    case "grupos":
      return {
        codeExpr: source.columns.grupo,
        nameExpr: source.columns.grupo,
        groupExpr: source.columns.grupo,
        orderLabel: "grupo"
      };
    case "marcas":
      return {
        codeExpr: source.columns.marca,
        nameExpr: source.columns.marca,
        groupExpr: source.columns.marca,
        orderLabel: "marca"
      };
    case "agentes":
      return {
        codeExpr: source.columns.agente,
        nameExpr: source.columns.agentName,
        groupExpr: `${source.columns.agente}, ${source.columns.agentName}`,
        orderLabel: "agente"
      };
    case "coordinadores":
      return {
        codeExpr: source.columns.coordinador,
        nameExpr: source.columns.coordinador,
        groupExpr: source.columns.coordinador,
        orderLabel: "coordinador"
      };
    case "productos":
      return {
        codeExpr: source.columns.codProd,
        nameExpr: source.columns.productName,
        groupExpr: `${source.columns.codProd}, ${source.columns.productName}`,
        orderLabel: "producto"
      };
    case "regiones":
      if (!source.columns.region || source.columns.region === "NULL") return null;
      return {
        codeExpr: source.columns.region,
        nameExpr: source.columns.region,
        groupExpr: source.columns.region,
        orderLabel: "region"
      };
    default:
      return null;
  }
}

async function queryRanking(env, source, kind, limit = DEFAULT_RANK_LIMIT) {
  const spec = rankingSpecForKind(kind, source);
  if (!spec) return [];
  return queryAll(env, `
    SELECT
      ${spec.codeExpr} AS codigo,
      ${spec.nameExpr} AS nombre,
      COALESCE(SUM(${source.columns.kilos}), 0) AS kilos
    ${source.fromSql}
    ${appendWhere(source.whereSql, `NULLIF(${spec.codeExpr}, '') IS NOT NULL`)}
    GROUP BY ${spec.groupExpr}
    ORDER BY kilos DESC, nombre COLLATE NOCASE ASC
    LIMIT ${Math.max(1, Math.min(10, Number(limit || DEFAULT_RANK_LIMIT)))}
  `, source.params);
}

async function queryClientDiff(env, currentSource, historicalSource) {
  const currentCte = `SELECT DISTINCT ${currentSource.columns.cliente} AS cliente ${currentSource.fromSql} ${appendWhere(currentSource.whereSql, `NULLIF(${currentSource.columns.cliente}, '') IS NOT NULL`)}`;
  const historicalCte = `SELECT DISTINCT ${historicalSource.columns.cliente} AS cliente ${historicalSource.fromSql} ${appendWhere(historicalSource.whereSql, `NULLIF(${historicalSource.columns.cliente}, '') IS NOT NULL`)}`;
  const params = [...currentSource.params, ...historicalSource.params];
  const rows = await queryAll(env, `
    WITH current_clients AS (${currentCte}),
         historical_clients AS (${historicalCte})
    SELECT 'new' AS kind, COUNT(*) AS total FROM (
      SELECT cliente FROM current_clients
      EXCEPT
      SELECT cliente FROM historical_clients
    )
    UNION ALL
    SELECT 'lost' AS kind, COUNT(*) AS total FROM (
      SELECT cliente FROM historical_clients
      EXCEPT
      SELECT cliente FROM current_clients
    )
  `, params);
  const result = { newClients: 0, lostClients: 0 };
  for (const row of rows) {
    if (row.kind === "new") result.newClients = Number(row.total || 0);
    if (row.kind === "lost") result.lostClients = Number(row.total || 0);
  }
  return result;
}

function computeVariation(currentSummary, historicalSummary) {
  const currentKilos = Number(currentSummary?.kilos || 0);
  const historicalKilos = Number(historicalSummary?.kilos || 0);
  const diff = currentKilos - historicalKilos;
  const pct = historicalKilos ? (diff / historicalKilos) * 100 : null;
  return { diff, pct };
}

function isRangeOutside(period, availabilityRange) {
  if (!period?.desde || !period?.hasta || !availabilityRange?.min || !availabilityRange?.max) return false;
  return period.hasta < availabilityRange.min || period.desde > availabilityRange.max;
}

function buildNoDataAnswer(periodLabel, year, availabilityRange) {
  const label = periodLabel || String(year || "el período solicitado");
  const available = availabilityRange?.min && availabilityRange?.max
    ? `${availabilityRange.min} → ${availabilityRange.max}`
    : "sin datos cargados";
  return `No encuentro datos para ${label}. El rango disponible para ${year || "esa fuente"} es ${available}.`;
}

function formatRankingLines(kind, rows) {
  if (!rows?.length) return "";
  const titleMap = {
    clientes: "Top clientes",
    grupos: "Top grupos",
    marcas: "Top marcas",
    agentes: "Top agentes",
    coordinadores: "Top coordinadores",
    productos: "Top productos",
    regiones: "Top regiones"
  };
  return `${titleMap[kind] || kind}:\n${rows.map((row, index) => `  ${index + 1}. ${row.nombre || row.codigo || "?"} — ${fmtKg(row.kilos)} kg`).join("\n")}`;
}

// ── v39: nuevas funciones de respuesta determinista ───────────────────────

// Construye un informe ejecutivo completo sin invocar el modelo de IA
function buildReportAnswer(prepared) {
  const cur = prepared.currentSummary;
  const hist = prepared.historicalSummary;
  const v = prepared.variation;
  const filtros = prepared.promptPayload?.filtrosEfectivos || {};
  const rankings = prepared.rankings || {};
  const clientDiff = prepared.clientDiff;
  const lines = [];

  // Encabezado
  const periodoLabel = prepared.plan?.periodLabel || "Período analizado";
  const filtroActivo = [
    filtros.coordinadorLabel && `Coord. ${filtros.coordinadorLabel}`,
    filtros.agenteLabel && `Agente ${filtros.agenteLabel}`,
    filtros.grupoLabel && `Familia ${filtros.grupoLabel}`,
    filtros.marcaLabel && `Marca ${filtros.marcaLabel}`,
    filtros.regionLabel && `Región ${filtros.regionLabel}`,
  ].filter(Boolean).join(" · ");

  lines.push(`## Informe ejecutivo de ventas — ${periodoLabel}`);
  if (filtroActivo) lines.push(`_Filtros: ${filtroActivo}_`);
  lines.push("");

  // KPIs principales
  if (cur) {
    lines.push("### KPIs del período");
    lines.push(`| Métrica | Valor |`);
    lines.push(`|---------|-------|`);
    lines.push(`| Kilos vendidos | **${fmtKg(cur.kilos)} kg** |`);
    lines.push(`| Clientes activos | ${Number(cur.clientes || 0)} |`);
    lines.push(`| Agentes activos | ${Number(cur.agentes || 0)} |`);
    lines.push(`| Registros | ${Number(cur.registros || 0)} |`);
    if (hist) {
      lines.push(`| Kilos 2025 comparable | ${fmtKg(hist.kilos)} kg |`);
    }
    if (v) {
      const pctStr = v.pct == null ? "" : ` (${v.pct >= 0 ? "+" : ""}${fmtPct(v.pct)}%)`;
      const sign = v.diff >= 0 ? "+" : "";
      lines.push(`| Variación vs 2025 | **${sign}${fmtKg(v.diff)} kg${pctStr}** |`);
    }
    lines.push("");
  }

  // Rankings
  const rankOrder = ["clientes","grupos","agentes","coordinadores","marcas"];
  const rankTitles = { clientes:"Top clientes", grupos:"Top familias", agentes:"Top agentes", coordinadores:"Top coordinadores", marcas:"Top marcas" };
  for (const kind of rankOrder) {
    const rows = rankings[kind] || [];
    if (!rows.length) continue;
    lines.push(`### ${rankTitles[kind] || kind}`);
    lines.push(`| # | Nombre | Kilos |`);
    lines.push(`|---|--------|-------|`);
    rows.slice(0, 5).forEach((r, i) => {
      lines.push(`| ${i+1} | ${r.nombre || r.codigo || "—"} | ${fmtKg(r.kilos)} kg |`);
    });
    lines.push("");
  }

  // Clientes delta
  if (clientDiff) {
    lines.push("### Movimiento de clientes");
    lines.push(`- Clientes **nuevos** en el período: **${clientDiff.newClients}**`);
    lines.push(`- Clientes **perdidos** respecto al período comparable: **${clientDiff.lostClients}**`);
    lines.push("");
  }

  // Conclusión
  if (v && v.pct != null) {
    const tendencia = v.pct >= 5 ? "una tendencia positiva sólida" : v.pct >= 0 ? "estabilidad" : "una caída que requiere atención";
    lines.push(`_Resumen: el período muestra ${tendencia} respecto al año anterior (${v.pct >= 0 ? "+" : ""}${fmtPct(v.pct)}% en kilos)._`);
  }

  return {
    text: lines.join("\n"),
    exportData: buildExportData(rankings, cur, hist, v),
  };
}

// Construye datos de exportación estructurados para PDF/Excel
function buildExportData(rankings, cur, hist, v) {
  const tables = [];

  if (cur) {
    tables.push({
      title: "KPIs del período",
      headers: ["Métrica", "Actual", "2025", "Variación Kg", "Variación %"],
      rows: [
        ["Kilos", fmtKg(cur.kilos) + " kg", hist ? fmtKg(hist.kilos) + " kg" : "—",
          v ? (v.diff >= 0 ? "+" : "") + fmtKg(v.diff) + " kg" : "—",
          v?.pct != null ? (v.pct >= 0 ? "+" : "") + fmtPct(v.pct) + "%" : "—"],
        ["Clientes", String(cur.clientes || 0), hist ? String(hist.clientes || 0) : "—", "—", "—"],
        ["Agentes",  String(cur.agentes || 0),  hist ? String(hist.agentes || 0) : "—", "—", "—"],
        ["Registros", String(cur.registros || 0), hist ? String(hist.registros || 0) : "—", "—", "—"],
      ]
    });
  }

  const rankTitles = { clientes:"Top clientes", grupos:"Top familias", agentes:"Top agentes", coordinadores:"Top coordinadores", marcas:"Top marcas" };
  for (const [kind, rows] of Object.entries(rankings || {})) {
    if (!rows?.length) continue;
    tables.push({
      title: rankTitles[kind] || kind,
      headers: ["#", "Nombre", "Kilos"],
      rows: rows.slice(0, 10).map((r, i) => [String(i+1), r.nombre || r.codigo || "—", fmtKg(r.kilos) + " kg"])
    });
  }

  return tables.length ? tables : null;
}

// Construye respuesta de alertas comerciales
function buildAlertAnswer(prepared) {
  const cur = prepared.currentSummary;
  const v = prepared.variation;
  const clientDiff = prepared.clientDiff;
  const rankings = prepared.rankings || {};
  const lines = [];

  lines.push("## Alertas comerciales");
  lines.push("");

  let alertCount = 0;

  if (v && v.pct != null && v.pct < -5) {
    alertCount++;
    lines.push(`⚠️ **Caída de volumen:** ${fmtPct(Math.abs(v.pct))}% por debajo del año anterior (${fmtKg(Math.abs(v.diff))} kg menos).`);
  }

  if (clientDiff?.lostClients > 0) {
    alertCount++;
    lines.push(`⚠️ **Clientes perdidos:** ${clientDiff.lostClients} clientes que compraban en el período comparable no aparecen en el actual.`);
  }

  if (clientDiff?.newClients > 0) {
    lines.push(`✅ **Clientes nuevos:** ${clientDiff.newClients} clientes nuevos en el período.`);
  }

  const topClientes = rankings["clientes"] || [];
  if (topClientes.length >= 2) {
    const totalKilos = Number(cur?.kilos || 0);
    const top1 = topClientes[0];
    const top1pct = totalKilos > 0 ? ((Number(top1.kilos || 0) / totalKilos) * 100) : 0;
    if (top1pct > 30) {
      alertCount++;
      lines.push(`⚠️ **Concentración alta:** ${top1.nombre || top1.codigo} representa el ${fmtPct(top1pct)}% de las ventas del período. Alta dependencia de un solo cliente.`);
    }
  }

  if (alertCount === 0) {
    lines.push("✅ No se detectan alertas críticas en el período analizado. Los indicadores principales están dentro de rangos normales.");
  }

  lines.push("");
  lines.push("_Para ver frecuencia de compra e inactividad de clientes, preguntame por \"clientes en riesgo\" o \"frecuencia de compra\"._");

  return lines.join("\n");
}

function buildSystemPrompt(payload) {
  // v39: prompt enriquecido con Frecuencia, nuevos modos y capacidades de exportación
  return `Sos el asistente analítico del tablero "Ventas Dash". Trabajás SIEMPRE con datos reales que se te entregan abajo en JSON.

REGLAS DURAS (no se negocian):
1. Respondé SIEMPRE en español rioplatense, claro y profesional.
2. Nunca inventes números ni nombres. Si un dato no está en el JSON, decí "no tengo ese dato disponible" o sugerí ajustar el filtro.
3. Si la consulta del usuario es ambigua y el JSON ya contiene una "answer" preconstruida o instrucción de aclaración, repetila sin agregar nada.
4. Cuando haya comparativa 2025 vs 2026 (modo "compare"), reportá SIEMPRE: kilos actuales, kilos comparable, variación absoluta y porcentual, y mencioná el período exacto.
5. Cuando haya rankings, listá los top 3-5 con sus kilos usando formato de tabla Markdown: | # | Nombre | Kilos |
6. Si el usuario pidió "por qué" o explicación, intentá identificar la dimensión que más cambió usando los rankings y la variación.
7. Mencioná los filtros activos del tablero al inicio si son relevantes. Si no hay filtros, no aclares nada.
8. Cuando el usuario pregunte por proyección y haya datos en "proyeccion", usalos.
9. Máximo 400 palabras. Usá tablas Markdown para rankings y comparativas — son más legibles que las viñetas.
10. Formato preferido: una frase de respuesta directa al inicio, después detalles con tabla si hay más de 3 items. Cifras de kilos siempre con miles separados por punto y la unidad "kg".

CAPACIDADES DE FRECUENCIA (v39):
El tablero tiene una solapa "Frecuencia de Compra" con los siguientes segmentos:
- Frecuente: ≥2 compras/semana
- Semanal: ≈1 compra/semana (≥0.8/sem)
- Quincenal: cada 2 semanas (≥0.4/sem)
- Mensual: 1-2 compras/mes (≥0.15/sem)
- Ocasional: menos de 1/mes
- Inactivo: más de 90 días sin comprar
Las métricas de frecuencia se calculan como: días distintos con compra ÷ semanas del rango analizado.

CAPACIDADES DE EXPORTACIÓN:
Cuando el usuario pida un informe, ranking o tabla, podés decirle que puede descargarlo en PDF o Excel usando los botones que aparecen debajo de tu respuesta.

VISTA ACTIVA DEL USUARIO: ${payload.vistaActiva || "detalle"}
PERÍODO PEDIDO: ${payload.periodoSolicitado || "no especificado"}
MODO DE CONSULTA: ${payload.modo} (${payload.tipoConsulta})

=== DATOS ESTRUCTURADOS ===
${JSON.stringify(payload, null, 2)}
=== FIN DATOS ===`;
}

function buildManualAnswer(result) {
  const current = result.currentSummary;
  const compare = result.historicalSummary;
  const variation = result.variation;
  const lines = [];

  if (result.plan.mode === "availability") {
    lines.push(`Rango 2026 disponible: ${result.availability.current.min || "?"} → ${result.availability.current.max || "?"}.`);
    lines.push(`Rango 2025 disponible: ${result.availability.historical.min || "?"} → ${result.availability.historical.max || "?"}.`);
    return lines.join(" ");
  }

  if (current) {
    lines.push(`${result.plan.periodLabel || "Período"}: ${fmtKg(current.kilos)} kg, ${Number(current.clientes || 0)} clientes, ${Number(current.agentes || 0)} agentes.`);
  }
  if (compare) {
    lines.push(`2025 comparable: ${fmtKg(compare.kilos)} kg.`);
  }
  if (variation) {
    lines.push(`Variación: ${fmtSigned(variation.diff)} kg${variation.pct == null ? "" : ` (${variation.pct >= 0 ? "+" : ""}${fmtPct(variation.pct)}%)`}.`);
  }

  const rankingKinds = Object.keys(result.rankings || {});
  if (rankingKinds.length) {
    const firstKind = rankingKinds[0];
    const firstRows = result.rankings[firstKind] || [];
    if (firstRows.length) {
      lines.push(`Top ${firstKind}: ${firstRows.slice(0, 3).map(row => `${row.nombre || row.codigo || "?"} (${fmtKg(row.kilos)} kg)`).join(", ")}.`);
    }
  }

  if (result.clientDiff) {
    lines.push(`Clientes nuevos: ${result.clientDiff.newClients}. Clientes perdidos: ${result.clientDiff.lostClients}.`);
  }

  return lines.join(" ");
}

async function buildAnswerContext(env, runtime, message, contextFilters, history) {
  const availability = await resolveAvailability(env, runtime);
  const plan = buildPeriodPlan(message, contextFilters, availability);

  if (plan.mode === "clarify") {
    return {
      plan,
      answer: plan.answer,
      availability,
      contextUsed: {
        sourceStrategy: "clarify",
      answerMode: plan.answerMode || "summary",
        historyUsed: history.length,
        filtros: contextFilters,
        appVersion: APP_VERSION
      }
    };
  }

  const lookups = await loadLookupCatalog(env, runtime);
  const overrides = resolveEntityOverrides(message, lookups);
  const effectiveFilters = mergeFiltersWithOverrides(contextFilters, overrides, plan);

  if (plan.mode === "single-current" && isRangeOutside(plan.currentRange, availability.current)) {
    return {
      plan,
      answer: buildNoDataAnswer(plan.periodLabel, 2026, availability.current),
      availability,
      effectiveFilters,
      contextUsed: {
        sourceStrategy: "no-data-current",
      answerMode: plan.answerMode || "summary",
        historyUsed: history.length,
        filtros: effectiveFilters,
        appVersion: APP_VERSION
      }
    };
  }

  if ((plan.mode === "compare" || plan.mode === "single-historical") && isRangeOutside(plan.compare ? { desde: plan.compare.desde, hasta: plan.compare.hasta } : null, availability.historical)) {
    return {
      plan,
      answer: buildNoDataAnswer(plan.periodLabel, 2025, availability.historical),
      availability,
      effectiveFilters,
      contextUsed: {
        sourceStrategy: "no-data-historical",
      answerMode: plan.answerMode || "summary",
        historyUsed: history.length,
        filtros: effectiveFilters,
        appVersion: APP_VERSION
      }
    };
  }

  const sourceBundle = resolveAiSources(runtime, effectiveFilters, plan);

  let currentSummary = null;
  let historicalSummary = null;
  if (plan.mode === "single-current" || plan.mode === "compare") {
    currentSummary = await querySourceSummary(env, sourceBundle.currentSource);
  }
  if (plan.mode === "single-historical" || plan.mode === "compare") {
    historicalSummary = await querySourceSummary(env, sourceBundle.historicalSource);
  }

  const rankingKinds = plan.intent.rankingKinds.length
    ? plan.intent.rankingKinds
    : (plan.mode === "compare" ? ["clientes", "grupos"] : []);

  const rankings = {};
  for (const kind of rankingKinds) {
    if (plan.mode === "single-historical") {
      rankings[kind] = await queryRanking(env, sourceBundle.historicalSource, kind, DEFAULT_RANK_LIMIT);
    } else if (plan.mode === "single-current" || plan.mode === "compare") {
      rankings[kind] = await queryRanking(env, sourceBundle.currentSource, kind, DEFAULT_RANK_LIMIT);
    }
  }

  const clientDiff = (plan.mode === "compare" && (plan.intent.wantsNewClients || plan.intent.wantsLostClients || /clientes?/.test(normalizeText(message))))
    ? await queryClientDiff(env, sourceBundle.currentSource, sourceBundle.historicalSource)
    : null;

  const variation = plan.mode === "compare" ? computeVariation(currentSummary, historicalSummary) : null;

  const promptPayload = {
    pregunta: buildMessageSummary(message),
    periodoSolicitado: plan.periodLabel,
    modo: plan.mode,
    tipoConsulta: plan.answerMode || "summary",
    rangoDisponible: {
      ventas2026: availability.current,
      ventas2025: availability.historical
    },
    filtrosEfectivos: {
      desde: effectiveFilters.desde,
      hasta: effectiveFilters.hasta,
      coordinador: effectiveFilters.coordinador || null,
      coordinadorLabel: contextFilters.coordinadorLabel || null,
      agente: effectiveFilters.agente || null,
      agenteLabel: contextFilters.agenteLabel || null,
      cliente: effectiveFilters.cliente || null,
      clienteLabel: contextFilters.clienteLabel || null,
      grupo: effectiveFilters.grupo || null,
      grupoLabel: contextFilters.grupoLabel || null,
      marca: effectiveFilters.marca || null,
      marcaLabel: contextFilters.marcaLabel || null,
      region: effectiveFilters.region || null,
      regionLabel: contextFilters.regionLabel || null,
      regionAlias: overrides.regionAlias || null,
      clienteNombre: overrides.clienteNombre || null,
      productoNombre: overrides.productoNombre || null,
      coordinadoresExpandidos: effectiveFilters.coordinadorList || [],
      productos: effectiveFilters.codProd || [],
      productosLabels: contextFilters.codProdLabels || [],
      projGroups: effectiveFilters.projGroups || [],
      detailGroups: effectiveFilters.detailGroups || [],
      extraColumnFilters: effectiveFilters.extraColumnFilters || {}
    },
    explorador: contextFilters.detailExplorer || null,
    proyeccion: contextFilters.projectionCompare || null,
    fuentes: {
      current: sourceBundle.currentSource?.sourceLabel || null,
      historical: sourceBundle.historicalSource?.sourceLabel || null,
      compareMeta: sourceBundle.compareSourceMeta || null
    },
    resumenActual: currentSummary ? {
      kilos: Number(currentSummary.kilos || 0),
      clientes: Number(currentSummary.clientes || 0),
      agentes: Number(currentSummary.agentes || 0),
      registros: Number(currentSummary.registros || 0),
      fechaInicio: currentSummary.fecha_inicio || effectiveFilters.desde || null,
      fechaFin: currentSummary.fecha_fin || effectiveFilters.hasta || null
    } : null,
    resumenHistorico: historicalSummary ? {
      kilos: Number(historicalSummary.kilos || 0),
      clientes: Number(historicalSummary.clientes || 0),
      agentes: Number(historicalSummary.agentes || 0),
      registros: Number(historicalSummary.registros || 0),
      fechaInicio: historicalSummary.fecha_inicio || plan.compare?.desde || null,
      fechaFin: historicalSummary.fecha_fin || plan.compare?.hasta || null
    } : null,
    variacion: variation ? {
      kilos: Number(variation.diff || 0),
      porcentaje: variation.pct == null ? null : Number(variation.pct)
    } : null,
    clientesDelta: clientDiff,
    rankings,
    vistaActiva: contextFilters.activeTab,
    previewTabla: contextFilters.tablePreview || []
  };

  return {
    plan,
    answer: "",
    availability,
    effectiveFilters,
    promptPayload,
    currentSummary,
    historicalSummary,
    variation,
    rankings,
    clientDiff,
    sourceBundle,
    contextUsed: {
      sourceStrategy: plan.mode,
      answerMode: plan.answerMode || "summary",
      historyUsed: history.length,
      filtros: effectiveFilters,
      fuentes: {
        current: sourceBundle.currentSource?.sourceLabel || null,
        historical: sourceBundle.historicalSource?.sourceLabel || null
      },
      appVersion: APP_VERSION
    }
  };
}

// =============================================================
// v31 — Helpers para streaming SSE y fast-path determinista
// =============================================================

function sseEncode(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseEncodeText(textChunk) {
  return `data: ${JSON.stringify({ response: String(textChunk || "") })}\n\n`;
}

async function runModelChainJSON(env, messages) {
  const primaryModel = String(env?.AI_MODEL || DEFAULT_AI_MODEL);
  const modelChain = [primaryModel, ...FALLBACK_AI_MODELS.filter(m => m !== primaryModel)];
  let answer = "";
  let usedModel = "manual-fallback";
  let lastError = null;

  for (const model of modelChain) {
    try {
      const aiResponse = await env.AI.run(model, {
        messages,
        max_tokens: MAX_TOKENS,
        temperature: 0.2
      });
      const candidate = String(
        aiResponse?.response ||
        aiResponse?.result?.response ||
        aiResponse?.choices?.[0]?.message?.content ||
        ""
      ).trim();
      if (candidate) {
        answer = candidate;
        usedModel = model;
        break;
      }
    } catch (error) {
      lastError = error;
      console.warn(`[ai-handler] modelo ${model} falló:`, error?.message || error);
      continue;
    }
  }
  return { answer, usedModel, lastError };
}

/**
 * v31 — Streaming SSE.
 * Intenta con cada modelo en streaming. Si un modelo no soporta stream o falla,
 * cae al siguiente. Si toda la cadena falla, emite la respuesta manual como
 * un solo evento `data:` y luego `[DONE]`.
 *
 * Formato SSE compatible con el parser del frontend (index.html):
 *   - Línea de metadata al inicio: data: {"type":"meta", model, historyUsed, ...}
 *   - Chunks de respuesta: data: {"response":"texto parcial"}
 *   - Error (si aplica): data: {"type":"error","message":"..."}
 *   - Cierre: data: [DONE]
 */
async function runModelChainStream(env, messages, prepared, history) {
  const primaryModel = String(env?.AI_MODEL || DEFAULT_AI_MODEL);
  const modelChain = [primaryModel, ...FALLBACK_AI_MODELS.filter(m => m !== primaryModel)];

  const encoder = new TextEncoder();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const metaPayload = {
    type: "meta",
    historyUsed: history.length,
    appVersion: APP_VERSION,
    periodLabel: prepared?.plan?.periodLabel || null,
    answerMode: prepared?.plan?.answerMode || "summary",
    sourceStrategy: prepared?.plan?.mode || "summary",
    entities: {}
  };

  // Kickoff asíncrono — no await la pipeline acá, devolvemos el stream inmediatamente
  (async () => {
    try {
      await writer.write(encoder.encode(sseEncode(metaPayload)));

      let streamed = false;
      let usedModel = "manual-fallback";

      for (const model of modelChain) {
        try {
          const aiResponse = await env.AI.run(model, {
            messages,
            max_tokens: MAX_TOKENS,
            temperature: 0.2,
            stream: true
          });

          // Workers AI devuelve ReadableStream en formato SSE nativo.
          // Los chunks vienen como `data: {"response":"..."}` o similar.
          if (aiResponse && typeof aiResponse.getReader === "function") {
            const reader = aiResponse.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            let gotAny = false;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const lines = buf.split("\n");
              buf = lines.pop();
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) continue;
                const raw = trimmed.slice(5).trim();
                if (!raw || raw === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(raw);
                  const chunk = String(parsed?.response || parsed?.result?.response || "");
                  if (chunk) {
                    gotAny = true;
                    await writer.write(encoder.encode(sseEncodeText(chunk)));
                  }
                } catch (_) {
                  // si no es JSON válido, lo enviamos como texto plano
                  await writer.write(encoder.encode(sseEncodeText(raw)));
                  gotAny = true;
                }
              }
            }
            if (gotAny) {
              streamed = true;
              usedModel = model;
              // Re-emitimos meta con el modelo confirmado
              await writer.write(encoder.encode(sseEncode({ type: "meta-update", model })));
              break;
            }
          }
        } catch (error) {
          console.warn(`[ai-handler stream] modelo ${model} falló:`, error?.message || error);
          continue;
        }
      }

      // Si ningún modelo streameó, caemos al respuesta manual
      if (!streamed) {
        const manualAnswer = buildManualAnswer(prepared);
        await writer.write(encoder.encode(sseEncode({ type: "meta-update", model: usedModel })));
        // Enviar la respuesta entera como un solo chunk
        await writer.write(encoder.encode(sseEncodeText(manualAnswer)));
      }

      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (err) {
      try {
        await writer.write(encoder.encode(sseEncode({ type: "error", message: humanizeError(err) })));
      } catch (_) {}
    } finally {
      try { await writer.close(); } catch (_) {}
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*"
    }
  });
}

/**
 * v31 — Fast-path determinista.
 * Devuelve una respuesta construida sin invocar al LLM para casos donde
 * el payload estructurado ya tiene toda la información necesaria.
 * Es opt-in: el cliente lo activa con `body.fast === true`.
 */
function shouldUseFastPath(prepared, userMessageLen) {
  if (!prepared) return false;
  const mode = prepared.plan?.mode;
  const answerMode = prepared.plan?.answerMode || "summary";

  // Casos donde el manual builder es suficientemente bueno:
  //  - Disponibilidad: sólo lista las fechas.
  //  - Summary simple sin rankings solicitados y con datos presentes.
  if (mode === "availability") return true;
  if (mode === "single-current" && answerMode === "summary" && !prepared.plan.intent?.rankingKinds?.length && prepared.currentSummary) {
    return userMessageLen < 140;
  }
  return false;
}

export async function handleAIChat(request, env) {
  const t0 = Date.now();
  try {
    if (!env?.AI) {
      return json({
        ok: false,
        error: "Workers AI no esta disponible en este entorno. Verifica el binding AI en Wrangler."
      }, 503, { "cache-control": "no-store" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Body JSON invalido." }, 400, { "cache-control": "no-store" });
    }

    const userMessage = String(body?.message || "").trim();
    const history = sanitizeHistory(body?.history);
    if (!userMessage) {
      return json({ ok: false, error: "El campo 'message' es requerido." }, 400, { "cache-control": "no-store" });
    }

    // v31 — flags opt-in
    const requestUrl = new URL(request.url);
    const wantsStream = body?.stream === true || requestUrl.searchParams.get("stream") === "1";
    const wantsFast   = body?.fast === true   || requestUrl.searchParams.get("fast") === "1";

    const runtime = await resolveRuntimeContext(env);
    const rawContext = body?.context && typeof body.context === "object" ? body.context : {};
    const contextFilters = parseContextFilters(rawContext);
    const prepared = await buildAnswerContext(env, runtime, userMessage, contextFilters, history);

    // Rama 1: respuesta preconstruida (clarify, no-data, etc.). Ya determinista.
    if (prepared.answer) {
      trackAIChat(env, {
        intent: "rule-based",
        answerMode: prepared.plan?.answerMode || "summary",
        modelUsed: "rule-based",
        latencyMs: Date.now() - t0,
        historyLen: history.length
      });
      return json({
        ok: true,
        answer: prepared.answer,
        model: "rule-based",
        contextUsed: prepared.contextUsed,
        appVersion: APP_VERSION
      }, 200, { "cache-control": "no-store" });
    }

    // Rama 1.5 — v39: modos deterministas nuevos (sin llamada al modelo de IA)
    const queryMode = prepared.plan?.answerMode || prepared.plan?.mode || "summary";

    if (queryMode === "report") {
      const reportResult = buildReportAnswer(prepared);
      trackAIChat(env, { intent: "report", answerMode: "report", modelUsed: "deterministic", latencyMs: Date.now() - t0, historyLen: history.length });
      return json({
        ok: true,
        answer: reportResult.text,
        exportData: reportResult.exportData,
        model: "deterministic",
        contextUsed: { ...prepared.contextUsed, answerMode: "report" },
        appVersion: APP_VERSION
      }, 200, { "cache-control": "no-store" });
    }

    if (queryMode === "alert") {
      // Para alertas necesitamos rankings + clientDiff — si no hay, usar modelo
      if (prepared.currentSummary) {
        const alertText = buildAlertAnswer(prepared);
        trackAIChat(env, { intent: "alert", answerMode: "alert", modelUsed: "deterministic", latencyMs: Date.now() - t0, historyLen: history.length });
        return json({
          ok: true,
          answer: alertText,
          model: "deterministic",
          contextUsed: { ...prepared.contextUsed, answerMode: "alert" },
          appVersion: APP_VERSION
        }, 200, { "cache-control": "no-store" });
      }
    }

    if (queryMode === "frequency") {
      // Devolver contexto para que el modelo interprete con info de Frecuencia
      // El sistema prompt ya explica los segmentos — usamos el modelo con contexto enriquecido
      const freqNote = `El usuario pregunta sobre frecuencia de compra. En el tablero existe la solapa "Frecuencia" con métricas de cadencia por cliente. Los segmentos son: Frecuente (≥2/sem), Semanal (≥0.8/sem), Quincenal (≥0.4/sem), Mensual (≥0.15/sem), Ocasional y Inactivo (>90 días sin compra). Respondé con los datos del JSON e indicá que puede ver el análisis completo en la solapa Frecuencia del tablero.`;
      prepared.promptPayload = { ...prepared.promptPayload, notaFrecuencia: freqNote };
    }

    if (queryMode === "ticket") {
      // Si hay resumen actual, calcular ticket promedio
      const cur = prepared.currentSummary;
      if (cur && Number(cur.registros || 0) > 0) {
        const ticketProm = Number(cur.kilos || 0) / Number(cur.registros);
        const ticketNote = `Ticket promedio del período: ${fmtKg(ticketProm)} kg por transacción (${fmtKg(cur.kilos)} kg totales ÷ ${Number(cur.registros)} registros).`;
        prepared.promptPayload = { ...prepared.promptPayload, ticketPromedio: ticketNote };
      }
    }

    // Rama 2: fast-path determinista opt-in
    if (wantsFast && shouldUseFastPath(prepared, userMessage.length)) {
      const manualAnswer = buildManualAnswer(prepared);
      trackAIChat(env, {
        intent: prepared.plan?.intent?.rankingKinds?.[0] || prepared.plan?.mode || "summary",
        answerMode: prepared.plan.answerMode || "summary",
        modelUsed: "fast-path",
        latencyMs: Date.now() - t0,
        tokensOutput: manualAnswer.length,
        fromFastPath: true,
        historyLen: history.length
      });
      return json({
        ok: true,
        answer: manualAnswer,
        model: "fast-path",
        contextUsed: {
          ...prepared.contextUsed,
          fastPath: true,
          periodLabel: prepared.plan.periodLabel,
          answerMode: prepared.plan.answerMode || "summary"
        },
        appVersion: APP_VERSION
      }, 200, { "cache-control": "no-store" });
    }

    const systemPrompt = buildSystemPrompt(prepared.promptPayload);
    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userMessage }
    ];

    // Rama 3: streaming SSE (opt-in)
    if (wantsStream) {
      return await runModelChainStream(env, messages, prepared, history);
    }

    // Rama 4: JSON clásico (comportamiento v30 intacto)
    const { answer: maybeAnswer, usedModel, lastError } = await runModelChainJSON(env, messages);
    let answer = maybeAnswer;
    if (!answer) {
      console.error("[ai-handler] toda la cadena de modelos falló:", lastError);
      answer = buildManualAnswer(prepared);
    }

    trackAIChat(env, {
      intent: prepared.plan?.intent?.rankingKinds?.[0] || prepared.plan?.mode || "summary",
      answerMode: prepared.plan.answerMode || "summary",
      modelUsed: usedModel,
      latencyMs: Date.now() - t0,
      tokensOutput: answer.length,
      historyLen: history.length
    });

    return json({
      ok: true,
      answer,
      model: usedModel,
      contextUsed: {
        ...prepared.contextUsed,
        periodLabel: prepared.plan.periodLabel,
        rankingKinds: prepared.plan.intent?.rankingKinds || [],
        answerMode: prepared.plan.answerMode || "summary",
        disponibilidad: prepared.availability,
        kpis: {
          current: prepared.currentSummary ? {
            kilos: Number(prepared.currentSummary.kilos || 0),
            clientes: Number(prepared.currentSummary.clientes || 0),
            agentes: Number(prepared.currentSummary.agentes || 0)
          } : null,
          historical: prepared.historicalSummary ? {
            kilos: Number(prepared.historicalSummary.kilos || 0),
            clientes: Number(prepared.historicalSummary.clientes || 0),
            agentes: Number(prepared.historicalSummary.agentes || 0)
          } : null
        }
      },
      appVersion: APP_VERSION
    }, 200, { "cache-control": "no-store" });
  } catch (error) {
    console.error("[ai-handler] unhandled error:", error);
    return json({
      ok: false,
      error: humanizeError(error),
      where: "handleAIChat",
      appVersion: APP_VERSION
    }, 500, { "cache-control": "no-store" });
  }
}
