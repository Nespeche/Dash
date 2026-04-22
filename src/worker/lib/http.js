const JSON_HDR = { "content-type": "application/json; charset=utf-8" };

function mergeHeaderValue(current = "", next = "") {
  const items = [...String(current || "").split(","), ...String(next || "").split(",")]
    .map(value => value.trim())
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  items.forEach(value => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(value);
  });
  return unique.join(", ");
}

function buildResponseHeaders(extraHdrs = {}) {
  const headers = new Headers();
  Object.entries(JSON_HDR).forEach(([key, value]) => headers.set(key, value));
  Object.entries(corsHdrs()).forEach(([key, value]) => headers.set(key, value));
  Object.entries(extraHdrs || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    if (String(key).toLowerCase() === "vary") {
      headers.set("vary", mergeHeaderValue(headers.get("vary"), value));
      return;
    }
    headers.set(key, value);
  });
  headers.set("vary", mergeHeaderValue(headers.get("vary"), "accept-encoding"));
  return headers;
}

export function json(obj, status = 200, extraHdrs = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: buildResponseHeaders(extraHdrs)
  });
}

export function withPatchedHeaders(response, extraHdrs = {}) {
  const headers = new Headers(response.headers || undefined);
  Object.entries(extraHdrs || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    if (String(key).toLowerCase() === "vary") {
      headers.set("vary", mergeHeaderValue(headers.get("vary"), value));
      return;
    }
    headers.set(key, value);
  });
  headers.set("vary", mergeHeaderValue(headers.get("vary"), "accept-encoding"));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function withCors(response) {
  return withPatchedHeaders(response, corsHdrs());
}

export function corsHdrs() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400"
  };
}

export function humanizeError(err) {
  const msg = String(err?.message || err || "Error interno");
  if (/exceeded resource limits/i.test(msg)) return "Cloudflare Worker excedio recursos.";
  return msg;
}

export function canonicalizeRequestUrl(url) {
  const input = new URL(url.toString());
  const entries = [...input.searchParams.entries()].sort((left, right) => {
    if (left[0] !== right[0]) return left[0].localeCompare(right[0], "es");
    return String(left[1] || "").localeCompare(String(right[1] || ""), "es");
  });

  input.search = "";
  for (const [key, value] of entries) {
    input.searchParams.append(key, value);
  }

  return input;
}

export function buildVersionedCacheKey(url, dataVersion) {
  const canonicalUrl = canonicalizeRequestUrl(url);
  if (dataVersion) canonicalUrl.searchParams.set("__v", String(dataVersion));
  const versionedCanonicalUrl = canonicalizeRequestUrl(canonicalUrl);
  return new Request(versionedCanonicalUrl.toString(), { method: "GET" });
}
