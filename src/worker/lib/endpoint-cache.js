import { buildVersionedCacheKey, json, withCors, withPatchedHeaders } from "./http.js";

const pendingResponseCache = new Map();

export function buildPublicCacheControl(ttlSeconds) {
  const ttl = Math.max(0, Number(ttlSeconds || 0));
  return `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=300`;
}

export function buildResponseEtag(dataVersion = "") {
  const clean = String(dataVersion || "legacy-no-metadata").replace(/"/g, "").trim() || "legacy-no-metadata";
  return `"${clean}"`;
}

function normalizeWeakEtag(value = "") {
  return String(value || "").trim().replace(/^W\//i, "");
}

export function matchesIfNoneMatch(value = "", etag = "") {
  const expected = normalizeWeakEtag(etag);
  if (!value || !expected) return false;
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .some(item => item === "*" || normalizeWeakEtag(item) === expected);
}

function buildNotModifiedResponse(etag = "", cacheControl = "") {
  const headers = {};
  if (etag) headers.etag = etag;
  if (cacheControl) headers["cache-control"] = cacheControl;
  return withCors(new Response(null, { status: 304, headers }));
}

export function jsonNoStore(payload, status = 200, extraHdrs = {}) {
  return json(payload, status, {
    "cache-control": "no-store",
    ...extraHdrs
  });
}

export function jsonPublic(payload, ttlSeconds, status = 200, extraHdrs = {}) {
  return json(payload, status, {
    "cache-control": buildPublicCacheControl(ttlSeconds),
    ...extraHdrs
  });
}

export async function respondWithVersionedCache({ request, url, dataVersion, ctx, build }) {
  const cacheKey = buildVersionedCacheKey(url, dataVersion);
  const cacheKeyUrl = cacheKey.url;
  const cache = caches.default;
  const etag = buildResponseEtag(dataVersion);
  const requestIfNoneMatch = request?.headers?.get("if-none-match") || "";

  const cached = await cache.match(cacheKey);
  if (cached) {
    const cacheControl = String(cached.headers.get("cache-control") || "");
    if (matchesIfNoneMatch(requestIfNoneMatch, etag)) {
      return buildNotModifiedResponse(etag, cacheControl);
    }
    return withCors(withPatchedHeaders(cached, { etag }));
  }

  if (matchesIfNoneMatch(requestIfNoneMatch, etag)) {
    return buildNotModifiedResponse(etag);
  }

  if (pendingResponseCache.has(cacheKeyUrl)) {
    const sharedResponse = await pendingResponseCache.get(cacheKeyUrl);
    return withCors(withPatchedHeaders(sharedResponse.clone(), { etag }));
  }

  const buildPromise = (async () => {
    let response = await build();
    response = withPatchedHeaders(response, { etag });

    const cacheControl = String(response?.headers?.get("cache-control") || "");
    const shouldCache = Boolean(
      response &&
      ctx &&
      !/\bno-store\b/i.test(cacheControl)
    );

    if (shouldCache) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response.clone();
  })().finally(() => {
    pendingResponseCache.delete(cacheKeyUrl);
  });

  pendingResponseCache.set(cacheKeyUrl, buildPromise);

  const response = await buildPromise;
  return withCors(response);
}
