(function (global) {
  const DEFAULT_API_BASE = "/api";

  function normalizeApiBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function resolveApiBase() {
    const fromNamespace = typeof global !== "undefined"
      ? normalizeApiBase(global.VentasDash?.apiBase)
      : "";
    const fromConfig = typeof global !== "undefined"
      ? normalizeApiBase(global.__VENTAS_APP_CONFIG__?.apiBase)
      : "";
    const fromMeta = typeof document !== "undefined"
      ? normalizeApiBase(document.querySelector('meta[name="ventas-api-base"]')?.content)
      : "";
    const fromOrigin = typeof location !== "undefined"
      ? `${location.origin.replace(/\/+$/, "")}/api`
      : DEFAULT_API_BASE;
    return fromNamespace || fromConfig || fromMeta || fromOrigin || DEFAULT_API_BASE;
  }

  function resolveAppVersion() {
    return String(global.__VENTAS_APP_VERSION__ || "20260420-v40-kpi-middle-pan-chart-share").trim()
      || String(global.VentasDash?.version || "").trim()
      || "dev";
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = value;
  }

  function fmt(value) {
    return Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
  }

  function fmtK(value) {
    const kilos = Number(value || 0);
    return kilos >= 1000 ? `${(kilos / 1000).toFixed(1)}k` : fmt(kilos);
  }

  function fmtSigned(value) {
    const num = Number(value || 0);
    if (!num) return "0";
    return `${num > 0 ? "+" : "−"}${fmt(Math.abs(num))}`;
  }

  function fmtPct(value) {
    return `${Number(value || 0).toLocaleString("es-AR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })}%`;
  }

  function fmtSignedPct(value) {
    const num = Number(value || 0);
    if (!num) return "0,0%";
    return `${num > 0 ? "+" : "−"}${fmtPct(Math.abs(num))}`;
  }

  function monthNameEs(month) {
    return [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ][Math.max(1, Math.min(12, Number(month || 1))) - 1];
  }

  function parseIsoDateParts(value) {
    const text = String(value || "");
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      iso: text
    };
  }

  function escHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toNum(value) {
    if (value == null || value === "") return 0;
    const num = Number(String(value).replace(",", "."));
    return Number.isFinite(num) ? num : 0;
  }

  function toISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function yieldToUI() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function normText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function localeEs(a, b) {
    return String(a || "").localeCompare(String(b || ""), "es");
  }

  function buildApiErrorMessage(status, bodyText = "") {
    const text = String(bodyText || "").trim();
    if (/Error\s*1102/i.test(text) || /Worker exceeded resource limits/i.test(text)) {
      return "Cloudflare Worker excedio recursos (Error 1102).";
    }
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.mensaje === "string" && parsed.mensaje.trim()) {
          return parsed.mensaje.trim();
        }
      } catch (_) {}
    }
    if (status === 404) {
      return "HTTP 404. La app no encontro la ruta API; revisar apiBase del Worker en config.js.";
    }
    if (status) return `HTTP ${status}`;
    return "Respuesta invalida del servidor";
  }

  async function readApiPayload(response) {
    const contentType = String(response.headers.get("content-type") || "");
    const text = await response.text();
    if (!response.ok) throw new Error(buildApiErrorMessage(response.status, text));
    if (!contentType.includes("application/json")) {
      throw new Error(buildApiErrorMessage(response.status, text));
    }
    try {
      return JSON.parse(text);
    } catch (_) {
      const sample = String(text || "").slice(0, 220).trim();
      if (sample) throw new Error(`JSON incompleto o invalido. Inicio de respuesta: ${sample}`);
      throw new Error("JSON incompleto o invalido.");
    }
  }

  function buildBasicToken(user, pass) {
    return btoa(`${String(user || "")}:${String(pass || "")}`);
  }

  function decodeBasicUser(token) {
    try {
      const raw = atob(String(token || ""));
      const sep = raw.indexOf(":");
      return sep >= 0 ? raw.slice(0, sep) : "";
    } catch (_) {
      return "";
    }
  }

  global.VentasDashShared = {
    DEFAULT_API_BASE,
    resolveAppVersion,
    normalizeApiBase,
    resolveApiBase,
    el,
    setText,
    fmt,
    fmtK,
    fmtSigned,
    fmtPct,
    fmtSignedPct,
    monthNameEs,
    parseIsoDateParts,
    escHtml,
    toNum,
    toISO,
    yieldToUI,
    normText,
    localeEs,
    buildApiErrorMessage,
    readApiPayload,
    buildBasicToken,
    decodeBasicUser
  };
})(window);
