importScripts("./app_version.js");

const APP_VERSION = String(self.__VENTAS_APP_VERSION__ || "20260420-v40-kpi-middle-pan-chart-share");
const CACHE_NAME = `ventas-app-shell-${APP_VERSION}`;
const CACHE_PREFIX = "ventas-app-shell-";
const APP_SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./favicon.svg",
  "./app_version.js",
  "./config.js",
  "./app_shared.js",
  "./app.js",
  "./js/auth-ui.js",
  "./js/runtime-state.js",
  "./js/explorer-state.js",
  "./js/projection.js",
  "./js/accessible-tabs.js",
  "./js/accessible-combobox.js",
  "./js/table-ui.js",
  "./js/table-sort-filter.js",
  "./js/table-scale.js",
  "./js/dashboard-queries.js",
  "./js/data-service.js",
  "./js/detail-controller.js",
  "./js/insights-controller.js",
  "./js/projection-controller.js",
  "./js/catalog-store.js",
  "./js/client-search-controller.js",
  "./js/product-selector-controller.js",
  "./js/filter-pills-controller.js",
  "./js/filter-controller.js",
  "./js/app-listeners.js",
  "./manifest.json",
  // v31 — módulos y estilos nuevos
  "./css/tokens.css",
  "./css/v31-enhancements.css",
  "./css/ui-refresh-v32.css",
  "./js/v31/kpi-delta.js",
  "./js/v31/empty-states.js",
  "./js/v31/ai-suggestions.js",
  "./js/v31/ai-feedback.js",
  "./js/v31/ai-enhancements.js",
  "./js/v31/bookmarks.js",
  "./js/v31/multi-sort.js",
  "./js/v31/row-drawer.js",
  "./js/v31/chart-crossfilter.js"
];

function normalizeCacheKey(requestOrUrl) {
  const url = new URL(typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url, self.location.origin);
  url.hash = "";
  if (url.origin === self.location.origin) {
    url.search = "";
  }
  return url.toString();
}

const APP_SHELL_CACHE_KEYS = new Set(APP_SHELL_ASSETS.map(asset => normalizeCacheKey(asset)));

function isAppShellAsset(request) {
  return APP_SHELL_CACHE_KEYS.has(normalizeCacheKey(request));
}

async function putInCache(cache, requestOrUrl, response) {
  if (!response || !response.ok) return response;
  const cacheKey = normalizeCacheKey(requestOrUrl);
  await cache.put(cacheKey, response.clone()).catch(() => null);
  return response;
}

async function matchFromCache(cache, requestOrUrl) {
  const cacheKey = normalizeCacheKey(requestOrUrl);
  return cache.match(cacheKey);
}

async function fetchAndCache(cache, requestOrUrl) {
  const networkRequest = new Request(requestOrUrl, { cache: "no-store" });
  const response = await fetch(networkRequest);
  return putInCache(cache, requestOrUrl, response);
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      APP_SHELL_ASSETS.map(async asset => {
        try {
          const response = await fetch(asset, { cache: "no-store" });
          await putInCache(cache, asset, response);
        } catch (_) {}
      })
    );
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function handleShellAssetRequest(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await matchFromCache(cache, request);

  if (cached) {
    event.waitUntil(fetchAndCache(cache, request).catch(() => null));
    return cached;
  }

  try {
    return await fetchAndCache(cache, request);
  } catch (_) {
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function handleAssetRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    return await fetchAndCache(cache, request);
  } catch (_) {
    return (await matchFromCache(cache, request))
      || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function handleHtmlRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: "no-store" });
    return await putInCache(cache, request, response);
  } catch (_) {
    return (await matchFromCache(cache, request))
      || (await matchFromCache(cache, "./index.html"))
      || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const accept = String(request.headers.get("accept") || "");
  const isHtml = request.mode === "navigate" || accept.includes("text/html");

  if (isHtml) {
    event.respondWith(handleHtmlRequest(request));
    return;
  }

  if (isAppShellAsset(request)) {
    event.respondWith(handleShellAssetRequest(request, event));
    return;
  }

  event.respondWith(handleAssetRequest(request));
});
