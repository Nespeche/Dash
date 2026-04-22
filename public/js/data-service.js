function normalizeQueryString(value = "") {
  const raw = String(value || "").trim().replace(/^\?+/, "");
  if (!raw) return "";

  const params = new URLSearchParams(raw);
  const entries = [...params.entries()].sort((left, right) => {
    if (left[0] !== right[0]) return left[0].localeCompare(right[0], "es");
    return String(left[1] || "").localeCompare(String(right[1] || ""), "es");
  });

  const normalized = new URLSearchParams();
  entries.forEach(([key, val]) => normalized.append(key, val));
  return normalized.toString();
}

function linkAbortSignals(externalSignal) {
  const controller = new AbortController();
  let detach = null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      const forward = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener("abort", forward, { once: true });
      detach = () => externalSignal.removeEventListener("abort", forward);
    }
  }

  return {
    controller,
    cleanup() {
      if (detach) detach();
    }
  };
}

export function createDataService({
  apiFetch,
  readApiPayload,
  cacheGet,
  cacheSet,
  syncDataVersionFromPayload,
  cacheKeyWithVersion,
  caches = {},
  urls = {},
  ttlMs = 120000,
  maxSize = 60
} = {}) {
  const pending = {
    state: null,
    detail: null,
    insights: null,
    projectionCompare: null,
    projectionDetail: null,
    projectionHierarchy: null,
    projectionProductHierarchy: null,
    detailOptions: null
  };
  const inflight = new Map();

  function clearPending(kind, controller) {
    if (pending[kind] === controller) pending[kind] = null;
  }

  function abort(kind) {
    pending[kind]?.abort();
    pending[kind] = null;
  }

  function abortAll() {
    Object.keys(pending).forEach(abort);
  }

  function reset() {
    abortAll();
    inflight.clear();
  }

  async function fetchCached(kind, qs = "", {
    signal,
    abortPrevious = true,
    cacheMap,
    ttl = ttlMs,
    cacheMax = maxSize,
    url
  } = {}) {
    const query = normalizeQueryString(qs);
    const versionedKey = () => cacheKeyWithVersion(query);
    const cached = cacheMap ? cacheGet(cacheMap, versionedKey(), ttl) : null;
    if (cached) return cached;

    const inflightKey = `${kind}::${versionedKey()}`;
    if (inflight.has(inflightKey)) {
      return inflight.get(inflightKey);
    }

    const pendingController = pending[kind];
    const samePendingQuery = pendingController?.__query === query;
    if (abortPrevious && pendingController && !samePendingQuery) abort(kind);

    const { controller, cleanup } = linkAbortSignals(signal);
    controller.__query = query;
    pending[kind] = controller;

    const FETCH_TIMEOUT_MS = 15000;
    const timeoutId = setTimeout(() => controller.abort(new DOMException("Tiempo de espera agotado.", "TimeoutError")), FETCH_TIMEOUT_MS);

    const requestPromise = (async () => {
      try {
        const requestUrl = query ? `${url}?${query}` : url;
        const response = await apiFetch(requestUrl, {
          signal: controller.signal,
          cache: "no-store"
        });
        const payload = await readApiPayload(response);
        syncDataVersionFromPayload(payload);
        if (cacheMap) cacheSet(cacheMap, versionedKey(), payload, cacheMax);
        return payload;
      } finally {
        clearTimeout(timeoutId);
        cleanup();
        inflight.delete(inflightKey);
        clearPending(kind, controller);
      }
    })();

    inflight.set(inflightKey, requestPromise);
    return requestPromise;
  }

  function fetchStatePayload(qs, signal) {
    return fetchCached("state", qs, {
      signal,
      abortPrevious: true,
      cacheMap: caches.state,
      url: urls.state
    });
  }

  function fetchDetailPage(qs, options = {}) {
    return fetchCached("detail", qs, {
      signal: options.signal,
      abortPrevious: options.abortPrevious !== false,
      cacheMap: caches.detail,
      url: urls.detail
    });
  }

  function fetchDetailOptions(qs, options = {}) {
    return fetchCached("detailOptions", qs, {
      signal: options.signal,
      abortPrevious: options.abortPrevious !== false,
      cacheMap: caches.detailOptions,
      url: urls.detailOptions
    });
  }

  function fetchInsights(qs, options = {}) {
    return fetchCached("insights", qs, {
      signal: options.signal,
      abortPrevious: options.abortPrevious !== false,
      cacheMap: caches.insights,
      url: urls.insights
    });
  }

  function fetchProjectionCompare(qs, options = {}) {
    return fetchCached("projectionCompare", qs, {
      signal: options.signal,
      abortPrevious: options.abortPrevious !== false,
      cacheMap: caches.projectionCompare,
      url: urls.projectionCompare
    });
  }

  function fetchProjectionDetailPage(qs, options = {}) {
    return fetchCached("projectionDetail", qs, {
      signal: options.signal,
      abortPrevious: options.abortPrevious !== false,
      cacheMap: caches.projectionDetail,
      url: urls.projectionDetail
    });
  }

  function fetchProjectionHierarchy(qs, options = {}) {
    return fetchCached("projectionHierarchy", qs, {
      signal: options.signal,
      abortPrevious: options.abortPrevious !== false,
      cacheMap: caches.projectionHierarchy,
      url: urls.projectionHierarchy
    });
  }

  function fetchProjectionProductHierarchy(qs, options = {}) {
    return fetchCached("projectionProductHierarchy", qs, {
      signal: options.signal,
      abortPrevious: options.abortPrevious !== false,
      cacheMap: caches.projectionProductHierarchy,
      url: urls.projectionProductHierarchy
    });
  }

  return {
    fetchStatePayload,
    fetchDetailPage,
    fetchDetailOptions,
    fetchInsights,
    fetchProjectionCompare,
    fetchProjectionDetailPage,
    fetchProjectionHierarchy,
    fetchProjectionProductHierarchy,
    abort,
    abortAll,
    reset
  };
}
