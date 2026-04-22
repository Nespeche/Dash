import { buildCatalogScopeKey } from "./dashboard-queries.js";

export function createCatalogStore({
  constants,
  stores,
  apis,
  runtime,
  invalidateClientOptionCache,
  invalidateProductOptionCache
} = {}) {
  let clientSearchTimer = 0;
  let productSearchTimer = 0;

  function normalizeCatalogItems(items = []) {
    return (items || []).map(item => ({
      codigo: String(item?.codigo || "").trim(),
      nombre: String(item?.nombre || item?.codigo || "").trim() || String(item?.codigo || "").trim()
    })).filter(item => item.codigo);
  }

  function readClientSeed() {
    const key = String(constants.sessionClientSeedKey || "").trim();
    if (!key || typeof sessionStorage === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return normalizeCatalogItems(parsed).slice(0, Number(constants.sessionClientSeedMax || constants.catalogFetchLimit || 25));
    } catch (e) {
      console.warn("[catalog-store] readClientSeed falló:", e);
      return [];
    }
  }

  function writeClientSeed(items = []) {
    const key = String(constants.sessionClientSeedKey || "").trim();
    if (!key || typeof sessionStorage === "undefined") return;
    try {
      const normalized = normalizeCatalogItems(items).slice(0, Number(constants.sessionClientSeedMax || constants.catalogFetchLimit || 25));
      if (!normalized.length) return;
      sessionStorage.setItem(key, JSON.stringify(normalized));
    } catch (e) {
      console.warn("[catalog-store] writeClientSeed falló:", e);
    }
  }

  function ensureClientSeedLoaded() {
    const state = getCatalogState().clientes;
    if (!state || state.loaded || (Array.isArray(state.items) && state.items.length)) return;
    const seed = readClientSeed();
    if (!seed.length) return;
    state.scopeKey = state.scopeKey || 'session-seed';
    state.items = seed;
    state.loaded = true;
  }

  function getPeriodo() {
    return stores.getPeriodo();
  }

  function getFiltros() {
    return stores.getFiltros();
  }

  function getCatalogState() {
    return stores.getCatalogState();
  }

  function buildScopeKey(kind) {
    if (kind === "clientes") ensureClientSeedLoaded();
    return buildCatalogScopeKey({
      periodo: getPeriodo(),
      filtros: getFiltros(),
      kind
    });
  }

  function clearTransientCaches() {
    if (clientSearchTimer) {
      clearTimeout(clientSearchTimer);
      clientSearchTimer = 0;
    }
    if (productSearchTimer) {
      clearTimeout(productSearchTimer);
      productSearchTimer = 0;
    }
    invalidateClientOptionCache?.();
    invalidateProductOptionCache?.();
  }

  function mergeCatalogItems(kind, items = []) {
    if (kind === "clientes") ensureClientSeedLoaded();
    const state = getCatalogState()[kind];
    const byCode = new Map((state.items || []).map(item => [String(item.codigo || ""), item]));
    for (const item of normalizeCatalogItems(items)) {
      byCode.set(item.codigo, item);
    }
    state.items = [...byCode.values()];
    state.loaded = true;
    if (kind === "clientes") {
      writeClientSeed(state.items);
      invalidateClientOptionCache?.();
    } else invalidateProductOptionCache?.();
  }

  function setCatalogItems(kind, items = [], scopeKey = "") {
    if (kind === "clientes") ensureClientSeedLoaded();
    const state = getCatalogState()[kind];
    state.scopeKey = scopeKey;
    const normalized = normalizeCatalogItems(items);
    state.items = normalized.length ? normalized : (kind === "clientes" ? (state.items || []) : normalized);
    state.loaded = true;
    if (kind === "clientes") {
      writeClientSeed(state.items);
      invalidateClientOptionCache?.();
    } else invalidateProductOptionCache?.();
  }

  async function fetchCatalogOptions(kind, term = "", { force = false } = {}) {
    const q = String(term || "").trim();
    const scopeKey = buildScopeKey(kind);
    const version = runtime.getActiveDataVersion();
    const cacheKey = `${version}::catalog:${kind}:${scopeKey}:${q.toLowerCase()}:${constants.catalogFetchLimit}`;
    const cached = !force ? runtime.cacheGet(runtime.catalogCache, cacheKey, constants.clientCacheTtlMs) : null;
    if (cached) {
      setCatalogItems(kind, cached.items || [], scopeKey);
      getCatalogState()[kind].lastTerm = q;
      return cached;
    }

    const state = getCatalogState()[kind];
    const mySeq = ++state.requestSeq;
    state.loading = true;
    state.lastTerm = q;

    try {
      const qs = new URLSearchParams(scopeKey);
      qs.set("kind", kind);
      qs.set("limit", String(constants.catalogFetchLimit));
      if (q) qs.set("q", q);
      const response = await apis.apiFetch(`${apis.catalogUrl}?${qs}`, { cache: "no-store" });
      const payload = await apis.readApiPayload(response);
      apis.syncDataVersionFromPayload(payload);
      runtime.cacheSet(runtime.catalogCache, `${runtime.getActiveDataVersion()}::catalog:${kind}:${scopeKey}:${q.toLowerCase()}:${constants.catalogFetchLimit}`, payload, constants.clientCacheMax);
      if (getCatalogState()[kind].requestSeq === mySeq) {
        setCatalogItems(kind, payload.items || [], scopeKey);
      }
      return payload;
    } finally {
      if (getCatalogState()[kind].requestSeq === mySeq) {
        state.loading = false;
      }
    }
  }

  function scheduleClientLoad(term = "", immediate = false, task) {
    if (clientSearchTimer) clearTimeout(clientSearchTimer);
    const run = async () => {
      clientSearchTimer = 0;
      await task();
    };
    if (immediate) run();
    else clientSearchTimer = window.setTimeout(run, constants.searchInputDebounceMs);
  }

  function scheduleProductLoad(term = "", immediate = false, task) {
    if (productSearchTimer) clearTimeout(productSearchTimer);
    const run = async () => {
      productSearchTimer = 0;
      await task();
    };
    if (immediate) run();
    else productSearchTimer = window.setTimeout(run, constants.searchInputDebounceMs);
  }

  ensureClientSeedLoaded();

  return {
    getCatalogState,
    buildCatalogScopeKey: buildScopeKey,
    mergeCatalogItems,
    setCatalogItems,
    fetchCatalogOptions,
    clearTransientCaches,
    scheduleClientLoad,
    scheduleProductLoad
  };
}
