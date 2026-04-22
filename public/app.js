import {
  createAuthStore,
  ensureAuthShell as renderAuthShell,
  hideAuthOverlay as closeAuthOverlay,
  setAuthMessage,
  showAuthOverlay as openAuthOverlay,
  updateAuthUserBadge as renderAuthUserBadge
} from "./js/auth-ui.js";
import {
  cacheGet,
  cacheSet,
  createCatalogState,
  createEmptyDashboardState as emptyDashboardState
} from "./js/runtime-state.js";
import {
  formatProjectionDateLabel,
  getProjectionMeta as getProjectionMetaFromModule,
  normalizeProjectionValue,
  projectRankEntries,
  projectValue,
  projectionDelta,
  projectionDetailedRowHtml,
  projectionSummaryRowHtml,
  projectionTableColspan,
  projectionTableHeaders,
  projectionTotalRowHtml,
  toProjectionDetailObjects
} from "./js/projection.js";
import {
  renderAccumulatedTables,
  renderDetailTable
} from "./js/table-ui.js";
import {
  createExplorerState,
  patchExplorerState
} from "./js/explorer-state.js";
import { setupAppListeners } from "./js/app-listeners.js";
import { createFilterController } from "./js/filter-controller.js";
import { createDataService } from "./js/data-service.js";
import { createDetailController } from "./js/detail-controller.js";
import { createInsightsController } from "./js/insights-controller.js";
import { createProjectionController } from "./js/projection-controller.js";
import {
  buildDetailOptionsQueryString,
  buildDetailQueryString,
  buildProjectionCompareContext,
  buildProjectionCompareQueryString,
  buildProjectionDetailQueryString,
  buildStateQueryString
} from "./js/dashboard-queries.js";

// =============================================================================
// app.js  —  Ventas Dashboard · Frontend · Arquitectura v4
// Frontend liviano: KPIs/sets/gráficos server-side + detalle paginado server-side
// =============================================================================
// Cierre fase 3: limpieza final del bootstrap, endurecimiento del runtime y sincronización segura del app shell.

const {
  resolveAppVersion,
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
  readApiPayload,
  buildBasicToken,
  decodeBasicUser
} = window.VentasDashShared;

const APP_VERSION = resolveAppVersion();
const API_BASE = resolveApiBase();
const HEALTH_URL = `${API_BASE}/health`;
const STATE_URL = `${API_BASE}/state`;
const DETAIL_URL = `${API_BASE}/detail`;
const DETAIL_OPTIONS_URL = `${API_BASE}/detail-options`;
const INSIGHTS_URL = `${API_BASE}/insights`;
const PROJECTION_COMPARE_URL = `${API_BASE}/projection-compare`;
const PROJECTION_DETAIL_URL = `${API_BASE}/projection-detail`;
const PROJECTION_HIERARCHY_URL = `${API_BASE}/projection-hierarchy`;
const PROJECTION_PRODUCT_HIERARCHY_URL = `${API_BASE}/projection-product-hierarchy`;
const CATALOG_URL = `${API_BASE}/catalog`;

const TAB_DETALLE = "detalle";
const TAB_PROY = "proyeccion";
const TAB_ACUM = "acumulados";
const TAB_RESUMEN_ACUM = "resumen-acum";
const TAB_FREC = "frecuencia";
const TAB_GRAF = "graficos";
const MOBILE_FILTER_BREAKPOINT = 900;

const DETAIL_PAGE = 50;
const DETAIL_BULK_PAGE = 1000;
const PROJECTION_DETAIL_PAGE = 50;
const PROJECTION_DETAIL_BULK_PAGE = 600;
const SEARCH_DROPDOWN_LIMIT = 20;
const CATALOG_FETCH_LIMIT = 25;
const SEARCH_INPUT_DEBOUNCE_MS = 120;
const PROJECTION_GROUP_DEBOUNCE_MS = 240;
const CLIENT_CACHE_TTL_MS = 120000;
const CLIENT_CACHE_MAX = 60;
const HEALTH_CHECK_TTL_MS = 5 * 60 * 1000;
const STATE_LOAD_DEBOUNCE_MS = 160; // reduced from 220ms for faster filter response
const FILTERS_PREF_KEY = "ventasDashFiltersCollapsed";
const PROJECTION_PREF_KEY = "ventasDashProjectionConfig";
const DETAIL_FAVORITES_KEY = "ventasDashDetailFavorites";
const DETAIL_EXPLORER_STATE_KEY = "ventasDashDetailExplorer";
const DETAIL_FAVORITES_LIMIT = 8;
const AUTH_STORAGE_KEY = "ventasDashBasicAuth";
const AUTH_STYLE_ID = "ventasDashAuthStyle";
const APP_UPDATE_TOAST_ID = "appUpdateToast";
const ACTIVE_TAB_PREF_KEY = "ventasDashActiveTab";
const IDLE_WARMUP_DELAY_MS = 900;
const SERVICE_WORKER_IDLE_DELAY_MS = 1200;
const CLIENT_SESSION_SEED_KEY = "ventasDashClientSeed";
const SCROLL_TOP_BTN_ID = "uxScrollTop";

const PAL = [
  "#d6a756", "#6ea8fe", "#4cc9a6", "#9c8cff",
  "#61c4d8", "#f08a5d", "#7dcb7b", "#e07a7a",
  "#8fa8c7", "#d9c36a", "#5fa7a0", "#b8a1ff",
];

const DETAIL_EXPLORER_VIEWS = new Set(["detalle", "cliente", "grupo", "producto", "fecha"]);
const VALID_TABS = new Set([TAB_DETALLE, TAB_PROY, TAB_ACUM, TAB_RESUMEN_ACUM, TAB_FREC, TAB_GRAF]);
const lazyModuleState = {
  charts: { loaded: null, pending: null },
  explorerViews: { loaded: null, pending: null }
};
let lazyWarmupHandle = null;
let serviceWorkerRegistrationHandle = null;

function normalizeTabName(value) {
  const raw = String(value || "").trim().toLowerCase();
  return VALID_TABS.has(raw) ? raw : TAB_DETALLE;
}

function loadStoredActiveTab() {
  try {
    return normalizeTabName(localStorage.getItem(ACTIVE_TAB_PREF_KEY));
  } catch (_) {
    return TAB_DETALLE;
  }
}

function persistActiveTab(tabName) {
  const next = normalizeTabName(tabName);
  try {
    localStorage.setItem(ACTIVE_TAB_PREF_KEY, next);
  } catch (_) {}
  return next;
}

function scheduleBrowserIdleTask(callback, timeout = 800) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    return { kind: "idle", id: window.requestIdleCallback(() => callback(), { timeout }) };
  }
  return { kind: "timeout", id: window.setTimeout(callback, Math.min(timeout, 600)) };
}

function cancelBrowserIdleTask(handle) {
  if (!handle) return;
  if (handle.kind === "idle" && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle.id);
    return;
  }
  clearTimeout(handle.id);
}

async function loadLazyModule(kind, importer) {
  const state = lazyModuleState[kind];
  if (state.loaded) return state.loaded;
  if (state.pending) return state.pending;
  state.pending = importer().then(module => {
    state.loaded = module;
    return module;
  }).finally(() => {
    state.pending = null;
  });
  return state.pending;
}

function loadChartsModule() {
  return loadLazyModule("charts", () => import("./js/charts.js"));
}

function loadExplorerViewsModule() {
  return loadLazyModule("explorerViews", () => import("./js/explorer-views.js"));
}

function warmModulesForTab(tabName = activeTab) {
  const nextTab = normalizeTabName(tabName);
  if (nextTab === TAB_GRAF) {
    void loadChartsModule().catch(error => console.warn("[lazy.charts]", error));
  }
  if (nextTab === TAB_PROY || nextTab === TAB_ACUM) {
    void loadExplorerViewsModule().catch(error => console.warn("[lazy.explorerViews]", error));
  }
}

function maybeWarmNonCriticalModules() {
  if (lazyWarmupHandle) return;
  lazyWarmupHandle = scheduleBrowserIdleTask(() => {
    lazyWarmupHandle = null;
    void Promise.allSettled([
      loadExplorerViewsModule(),
      loadChartsModule()
    ]);
  }, IDLE_WARMUP_DELAY_MS);
}

function hasWarmClientCaches() {
  return [
    stateCache,
    detailCache,
    detailOptionsCache,
    insightsCache,
    projectionCompareCache,
    projectionDetailCache,
    catalogCache
  ].some(cache => cache instanceof Map && cache.size > 0);
}

function normalizePeriodRange(value = {}) {
  const next = {
    desde: String(value?.desde || "").trim(),
    hasta: String(value?.hasta || "").trim()
  };
  if (next.desde && next.hasta && next.desde > next.hasta) {
    return { desde: next.hasta, hasta: next.desde };
  }
  return next;
}

function syncPeriodInputs(nextPeriod = periodo) {
  const normalized = normalizePeriodRange(nextPeriod);
  const fromInput = el("fDesde");
  const untilInput = el("fHasta");
  if (fromInput && fromInput.value !== normalized.desde) fromInput.value = normalized.desde;
  if (untilInput && untilInput.value !== normalized.hasta) untilInput.value = normalized.hasta;
}

function normalizedPeriodo() {
  return normalizePeriodRange(periodo);
}

function createDetailExplorerState(overrides = {}) {
  const view = DETAIL_EXPLORER_VIEWS.has(String(overrides.view || "")) ? String(overrides.view) : "detalle";
  const metricFallback = view === "detalle" ? "Fecha" : "Kilos";
  const columnFilters = overrides.columnFilters && typeof overrides.columnFilters === "object"
    ? Object.fromEntries(Object.entries(overrides.columnFilters).map(([key, values]) => [
        String(key || ""),
        Array.isArray(values) ? [...new Set(values.map(value => String(value ?? "")).filter(value => value !== ""))] : []
      ]).filter(([key, values]) => key && values.length))
    : {};

  return {
    view,
    sort: String(overrides.sort || "default"),
    direction: overrides.direction === "asc" ? "asc" : "desc",
    search: String(overrides.search || ""),
    sortStack: Array.isArray(overrides.sortStack)
      ? overrides.sortStack.map(item => ({
          key: String(item?.key || ""),
          direction: item?.direction === "asc" ? "asc" : "desc"
        })).filter(item => item.key)
      : [],
    columnFilters,
    openColumnMenu: String(overrides.openColumnMenu || ""),
    metric: String(overrides.metric || metricFallback),
    topN: String(overrides.topN || "50"),
    groupOthers: Object.prototype.hasOwnProperty.call(overrides, "groupOthers") ? Boolean(overrides.groupOthers) : true,
    showAdvanced: Boolean(overrides.showAdvanced),
    currentPreset: String(overrides.currentPreset || "custom"),
    favoriteId: String(overrides.favoriteId || "")
  };
}

function loadDetailFavorites() {
  try {
    const raw = localStorage.getItem(DETAIL_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => ({
        id: String(item?.id || ""),
        name: String(item?.name || "").trim(),
        updatedAt: Number(item?.updatedAt || 0) || Date.now(),
        snapshot: createDetailExplorerState(item?.snapshot || {})
      }))
      .filter(item => item.id && item.name)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  } catch (error) {
    console.warn("[detailFavorites.load]", error);
    return [];
  }
}

function persistDetailFavorites(favorites = []) {
  try {
    localStorage.setItem(DETAIL_FAVORITES_KEY, JSON.stringify(favorites.slice(0, DETAIL_FAVORITES_LIMIT)));
  } catch (error) {
    console.warn("[detailFavorites.persist]", error);
  }
}

function loadStoredDetailExplorer() {
  try {
    const raw = sessionStorage.getItem(DETAIL_EXPLORER_STATE_KEY);
    if (!raw) return createDetailExplorerState();
    return createDetailExplorerState(JSON.parse(raw));
  } catch (error) {
    console.warn("[detailExplorer.load]", error);
    return createDetailExplorerState();
  }
}

function persistDetailExplorerState(state = detailExplorerState) {
  try {
    const snapshot = createDetailExplorerState({
      ...(state || {}),
      openColumnMenu: ""
    });
    sessionStorage.setItem(DETAIL_EXPLORER_STATE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("[detailExplorer.persist]", error);
  }
}

function clearStoredDetailExplorerState() {
  try {
    sessionStorage.removeItem(DETAIL_EXPLORER_STATE_KEY);
  } catch (_) {}
}

function hasMeaningfulDetailExplorerChange(patch = {}) {
  return ["view", "sort", "direction", "search", "sortStack", "columnFilters", "metric", "topN", "groupOthers"].some(key => Object.prototype.hasOwnProperty.call(patch, key));
}

let activeTab = TAB_DETALLE;
let currentLoadCtrl = null;
let loadSeq = 0;
let activeStateKey = "";
let keepProductDropdownOpen = false;
let activeDataVersion = "bootstrap";
let scheduledStateLoadTimer = 0;
let scheduledProjectionLoadTimer = 0;
let runtimeVersionState = { checkedAt: 0, pending: null };
let tabsController = null;
let clientCombobox = null;
let productCombobox = null;
const serviceWorkerState = { registration: null, activationRequested: false, listenersReady: false, scheduled: false };

let keyboardShortcutsBound = false;
let scrollTopButtonListenersBound = false;

let filtersCollapsed = false;
let projectionConfig = loadProjectionConfig();
let periodo = { desde: "", hasta: "" };
let filtros = {
  coordinador: "", agente: "", cliente: "",
  grupo: "", marca: "", region: "", codProd: []
};

let dashboardState = emptyDashboardState();
let detailFavorites = loadDetailFavorites();
let detailExplorerState = loadStoredDetailExplorer();
let detailColumnOptionsState = { scopeKey: "", byColumn: {}, loadingKey: "", seq: 0 };
let projectionExplorerState = createExplorerState({ view: "cliente", sort: "KilosProyectados", direction: "desc", metric: "KilosProyectados", topN: "50", groupOthers: true });
let accumExplorerState = createExplorerState({ view: "coordinadores", sort: "Kilos", direction: "desc", metric: "Kilos", topN: "50", groupOthers: true });
let detailQuickGroups = [];

const stateCache = new Map();
const detailCache = new Map();
const detailOptionsCache = new Map();
const insightsCache = new Map();
const projectionCompareCache = new Map();
const projectionDetailCache = new Map();
const projectionHierarchyCache = new Map();
const projectionProductHierarchyCache = new Map();
const catalogCache = new Map();
let catalogState = createCatalogState();

const dataService = createDataService({
  apiFetch,
  readApiPayload,
  cacheGet,
  cacheSet,
  syncDataVersionFromPayload,
  cacheKeyWithVersion,
  caches: {
    state: stateCache,
    detail: detailCache,
    detailOptions: detailOptionsCache,
    insights: insightsCache,
    projectionCompare: projectionCompareCache,
    projectionDetail: projectionDetailCache,
    projectionHierarchy: projectionHierarchyCache,
    projectionProductHierarchy: projectionProductHierarchyCache
  },
  urls: {
    state: STATE_URL,
    detail: DETAIL_URL,
    detailOptions: DETAIL_OPTIONS_URL,
    insights: INSIGHTS_URL,
    projectionCompare: PROJECTION_COMPARE_URL,
    projectionDetail: PROJECTION_DETAIL_URL,
    projectionHierarchy: PROJECTION_HIERARCHY_URL,
    projectionProductHierarchy: PROJECTION_PRODUCT_HIERARCHY_URL
  },
  ttlMs: CLIENT_CACHE_TTL_MS,
  maxSize: CLIENT_CACHE_MAX
});

const filterController = createFilterController({
  constants: {
    filtersPrefKey: FILTERS_PREF_KEY,
    searchDropdownLimit: SEARCH_DROPDOWN_LIMIT,
    catalogFetchLimit: CATALOG_FETCH_LIMIT,
    searchInputDebounceMs: SEARCH_INPUT_DEBOUNCE_MS,
    clientCacheTtlMs: CLIENT_CACHE_TTL_MS,
    clientCacheMax: CLIENT_CACHE_MAX,
    sessionClientSeedKey: CLIENT_SESSION_SEED_KEY,
    sessionClientSeedMax: Math.max(CATALOG_FETCH_LIMIT, 40)
  },
  helpers: { el, fmt, escHtml, normText, localeEs, toISO },
  stores: {
    getPeriodo: () => periodo,
    setPeriodo: value => { periodo = normalizePeriodRange(value); syncPeriodInputs(periodo); },
    getFiltros: () => filtros,
    setFiltros: value => { filtros = value; },
    getDashboardState: () => dashboardState,
    getCatalogState: () => catalogState,
    getFiltersCollapsed: () => filtersCollapsed,
    setFiltersCollapsed: value => { filtersCollapsed = value; },
    getKeepProductDropdownOpen: () => keepProductDropdownOpen,
    setKeepProductDropdownOpen: value => { keepProductDropdownOpen = !!value; },
    createEmptyDashboardOptions: () => emptyDashboardState().options
  },
  ui: {
    getClientCombobox: () => clientCombobox,
    getProductCombobox: () => productCombobox
  },
  callbacks: {
    scheduleStateLoad,
    syncTabsTop
  },
  apis: {
    apiFetch,
    readApiPayload,
    syncDataVersionFromPayload,
    catalogUrl: CATALOG_URL
  },
  runtime: {
    getActiveDataVersion: () => activeDataVersion,
    cacheGet,
    cacheSet,
    catalogCache
  }
});

const {
  getPeriodo,
  setPeriodo,
  getFiltros,
  setFiltros,
  setFiltersCollapsed,
  applyPeriod,
  resetFilters,
  getSelectedProducts,
  hasProductFilter,
  countBusinessFilters,
  shouldShowSummaryTable,
  getSelectedClientLabel,
  clearClientSelectionState,
  syncClientSearchUI,
  renderClientDropdown,
  setClientSelection,
  clearClientSelection,
  clearProductInputSilent,
  buildCatalogScopeKey,
  mergeCatalogItems,
  setCatalogItems,
  fetchCatalogOptions,
  scheduleClientDropdownLoad,
  scheduleProductDropdownLoad,
  filterClientOptions,
  closeSearchDropdown,
  syncProductSearchUI,
  renderProductDropdown,
  addProductSelection,
  removeProductSelection,
  clearProductSelection,
  renderSelectedProducts,
  rebuildSelects,
  updatePills,
  filterProductOptions,
  clearTransientCaches
} = filterController;

const detailController = createDetailController({
  fetchDetailPage: (qs, options) => dataService.fetchDetailPage(qs, options),
  buildDetailQueryString: (offset, limit) => detailQueryString(offset, limit),
  renderDetailTable,
  constants: {
    pageSize: DETAIL_PAGE,
    bulkPageSize: DETAIL_BULK_PAGE,
    projectionTab: TAB_PROY
  },
  helpers: { el, fmt, escHtml, toNum, yieldToUI },
  callbacks: {
    showError: showErr,
    setStatus,
    shouldShowSummaryTable: shouldShowDetailSummaryTable,
    getActiveTab: () => activeTab,
    onProjectionNeedsRefresh: () => {
      if (activeTab === TAB_PROY) renderProjectionPage();
    },
    onRequestRevealMore: (step) => revealMoreDetailRows(step),
    onRequestRevealAll: () => revealAllDetailRows(),
    getDetailRenderContext: () => ({
      explorer: detailExplorerState,
      quickGroups: getDetailQuickGroups(),
      onExplorerPatch: patchDetailExplorer,
      columnOptionsOverride: detailExplorerState.view === "detalle"
        ? {
            ...(detailColumnOptionsState.byColumn || {}),
            ...(detailColumnOptionsState.loadingKey && !Object.prototype.hasOwnProperty.call(detailColumnOptionsState.byColumn || {}, detailColumnOptionsState.loadingKey)
              ? { [detailColumnOptionsState.loadingKey]: [] }
              : {})
          }
        : null,
      columnOptionsLoadingKey: detailExplorerState.view === "detalle" ? String(detailColumnOptionsState.loadingKey || "") : "",
      toolbarActions: {
        favorites: detailFavorites,
        onSaveFavorite: saveCurrentDetailFavorite,
        onApplyFavorite: applyDetailFavorite,
        onDeleteFavorite: deleteDetailFavorite
      },
      onRowDrill: applyDetailDrilldown
    })
  }
});

const insightsController = createInsightsController({
  fetchInsights: (qs, options) => dataService.fetchInsights(qs, options),
  emptyDashboardState,
  getDashboardState: () => dashboardState,
  setDashboardState: value => { dashboardState = value; },
  getActiveStateKey: () => activeStateKey
});

const projectionController = createProjectionController({
  fetchProjectionCompare: (qs, options) => dataService.fetchProjectionCompare(qs, options),
  fetchProjectionDetailPage: (qs, options) => dataService.fetchProjectionDetailPage(qs, options),
  createEmptyProjectionCompareState: () => ({
    loaded: false,
    loading: false,
    available: false,
    currentLabel: "",
    compareLabel: "",
    currentMode: "month",
    compareMode: "month",
    compareYear: 2025,
    compareMonth: null,
    kilos: 0,
    clientes: 0,
    agentes: 0,
    registros: 0,
    currentKilos: 0,
    currentClientes: 0,
    currentAgentes: 0,
    currentRegistros: 0,
    latestDate: "",
    latestKilos: 0,
    reason: "idle",
    message: ""
  }),
  createEmptyProjectionDetailState: () => ({
    loaded: false,
    loading: false,
    rows: [],
    total: 0,
    totalKnown: true,
    nextOffset: 0,
    hasMore: false,
    projectedDate: "",
    viewMode: "summary",
    selectedGroups: [],
    summary: {
      totalRows: 0,
      kilosActuales: 0,
      kilos2025: 0
    },
    reason: "idle",
    message: ""
  }),
  projectionDetailTotalKnown: payload => {
    if (!payload || typeof payload !== "object") return true;
    if (typeof payload.totalKnown === "boolean") return payload.totalKnown;
    const total = Number(payload.total);
    return Number.isFinite(total) && total >= 0;
  },
  toProjectionDetailObjects: (headers, rows) => toProjectionDetailObjects(headers, rows, { toNum }),
  normalizeProjectionGroupSelection: values => [...new Set((values || []).map(v => String(v || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
  getProjectionCompareContext,
  buildProjectionCompareQueryString: (context, groups) => buildProjectionCompareQueryString({
    context,
    periodo: normalizedPeriodo(),
    filtros,
    getSelectedProducts,
    localeEs,
    projectionGroups: groups
  }),
  buildProjectionDetailBaseQueryString: (context, groups) => {
    const qs = new URLSearchParams(buildProjectionCompareQueryString({
      context,
      periodo: normalizedPeriodo(),
      filtros,
      getSelectedProducts,
      localeEs,
      projectionGroups: groups
    }));
    qs.set("detailView", groups.length ? "detail" : "summary");
    groups.forEach(group => qs.append("detailGroup", group));
    return qs.toString();
  },
  buildProjectionDetailQueryString: (context, offset, limit, groups) => buildProjectionDetailQueryString({
    context,
    periodo: normalizedPeriodo(),
    filtros,
    getSelectedProducts,
    localeEs,
    projectionGroups: groups,
    offset,
    limit
  }),
  getCurrentKpis: () => getProjectionCurrentKpis(),
  getDashboardState: () => dashboardState,
  shouldShowProjectionSummaryTable,
  getProjectionMeta,
  projectValue,
  yieldToUI,
  pageSize: () => projectionDetailPageSize(),
  bulkPageSize: () => projectionDetailBulkPageSize(),
  callbacks: {
    setStatus,
    showError: showErr
  }
});


let projectionHierarchyState = createEmptyProjectionHierarchyState();
let projectionHierarchyLoadedFor = "";
let projectionHierarchySeq = 0;
let projectionHierarchyExpanded = new Set();
let projectionHierarchyViewState = createProjectionHierarchyViewState();
let projectionProductHierarchyState = createEmptyProjectionProductHierarchyState();
let projectionProductHierarchyLoadedFor = "";
let projectionProductHierarchySeq = 0;
let projectionProductHierarchyExpanded = new Set();
let projectionProductHierarchyViewState = createProjectionProductHierarchyViewState();

const PROJECTION_HIERARCHY_COORD_PRIORITY = Object.freeze(["CS/AV", "MIENKO", "BLANCO", "ESPECIALES", "JEF"]);
const PROJECTION_HIERARCHY_SORT_OPTIONS = Object.freeze([
  { value: "excel", label: "Orden Excel" },
  { value: "projected", label: "Mayor proyección" },
  { value: "historical", label: "Mayor base 2025" },
  { value: "deltaKg", label: "Mayor variación Kg" },
  { value: "deltaPct", label: "Mayor variación %" },
  { value: "name", label: "A-Z" }
]);
const PROJECTION_HIERARCHY_COORD_PRIORITY_MAP = new Map(
  PROJECTION_HIERARCHY_COORD_PRIORITY.map((item, index) => [normText(item), index])
);

function createEmptyProjectionHierarchyState() {
  return {
    loaded: false,
    loading: false,
    available: false,
    currentLabel: "",
    compareLabel: "",
    groups: [],
    summary: {
      coordinadores: 0,
      agentes: 0,
      kilosActuales: 0,
      kilos2025: 0
    },
    message: "",
    currentSource: "",
    historicalSource: ""
  };
}

function createProjectionHierarchyViewState() {
  return {
    sort: "excel",
    onlyChanges: false
  };
}

function normalizeProjectionHierarchySort(value = "excel") {
  const clean = String(value || "excel").trim();
  return PROJECTION_HIERARCHY_SORT_OPTIONS.some(option => option.value === clean) ? clean : "excel";
}

function resetProjectionHierarchyState({ preserveExpansion = true } = {}) {
  projectionHierarchyState = createEmptyProjectionHierarchyState();
  projectionHierarchyLoadedFor = "";
  projectionHierarchySeq = 0;
  if (!preserveExpansion) projectionHierarchyExpanded = new Set();
}

function createEmptyProjectionProductHierarchyState() {
  return {
    loaded: false,
    loading: false,
    available: false,
    currentLabel: "",
    compareLabel: "",
    groups: [],
    summaryRows: [],
    summary: {
      familias: 0,
      productos: 0,
      kilosActuales: 0,
      kilos2025: 0
    },
    message: "",
    note: "",
    currentSource: "",
    historicalSource: ""
  };
}

function createProjectionProductHierarchyViewState() {
  return {
    sort: "excel",
    onlyChanges: false
  };
}

function resetProjectionProductHierarchyState({ preserveExpansion = true } = {}) {
  projectionProductHierarchyState = createEmptyProjectionProductHierarchyState();
  projectionProductHierarchyLoadedFor = "";
  projectionProductHierarchySeq = 0;
  if (!preserveExpansion) projectionProductHierarchyExpanded = new Set();
}

function getProjectionProductHierarchyKey(context = getProjectionCompareContext()) {
  return buildProjectionCompareQueryString({
    context,
    periodo: normalizedPeriodo(),
    filtros,
    getSelectedProducts,
    localeEs,
    projectionGroups: getProjectionSelectedGroups()
  });
}

function getProjectionProductHierarchyState() {
  return projectionProductHierarchyState;
}

function getProjectionProductHierarchyViewState() {
  return { ...projectionProductHierarchyViewState };
}

function patchProjectionProductHierarchyView(patch = {}) {
  projectionProductHierarchyViewState = {
    ...projectionProductHierarchyViewState,
    ...patch,
    sort: normalizeProjectionHierarchySort(patch?.sort ?? projectionProductHierarchyViewState.sort),
    onlyChanges: patch?.onlyChanges == null ? Boolean(projectionProductHierarchyViewState.onlyChanges) : Boolean(patch.onlyChanges)
  };
  if (activeTab === TAB_PROY) renderProjectionProductHierarchy(getProjectionMeta());
}

function needsProjectionProductHierarchyLoad(context = getProjectionCompareContext()) {
  if (!context?.valid) return false;
  const key = getProjectionProductHierarchyKey(context);
  return projectionProductHierarchyLoadedFor !== key || !projectionProductHierarchyState.loaded;
}

function getProjectionHierarchyKey(context = getProjectionCompareContext()) {
  return buildProjectionCompareQueryString({
    context,
    periodo: normalizedPeriodo(),
    filtros,
    getSelectedProducts,
    localeEs,
    projectionGroups: getProjectionSelectedGroups()
  });
}

function getProjectionHierarchyState() {
  return projectionHierarchyState;
}

function getProjectionHierarchyViewState() {
  return { ...projectionHierarchyViewState };
}

function patchProjectionHierarchyView(patch = {}) {
  projectionHierarchyViewState = {
    ...projectionHierarchyViewState,
    ...patch,
    sort: normalizeProjectionHierarchySort(patch?.sort ?? projectionHierarchyViewState.sort),
    onlyChanges: patch?.onlyChanges == null ? Boolean(projectionHierarchyViewState.onlyChanges) : Boolean(patch.onlyChanges)
  };
  if (activeTab === TAB_PROY) renderProjectionHierarchy(getProjectionMeta());
}

function needsProjectionHierarchyLoad(context = getProjectionCompareContext()) {
  if (!context?.valid) return false;
  const key = getProjectionHierarchyKey(context);
  return projectionHierarchyLoadedFor !== key || !projectionHierarchyState.loaded;
}

function normalizeProjectionHierarchyPayloadGroups(groups = []) {
  return (groups || []).map(group => ({
    coordinador: String(group?.coordinador || "Sin coordinador").trim() || "Sin coordinador",
    kilosActuales: Number(group?.kilosActuales || 0),
    kilos2025: Number(group?.kilos2025 || 0),
    agentes: (group?.agentes || []).map(agent => ({
      agente: String(agent?.agente || "").trim(),
      agenteNombre: String(agent?.agenteNombre || "").trim(),
      kilosActuales: Number(agent?.kilosActuales || 0),
      kilos2025: Number(agent?.kilos2025 || 0)
    }))
  }));
}

function projectionHierarchyTextCompare(left, right) {
  return String(left || "").localeCompare(String(right || ""), "es", { numeric: true, sensitivity: "base" });
}

function projectionHierarchyCoordinatorRank(value = "") {
  const normalized = normText(value);
  return PROJECTION_HIERARCHY_COORD_PRIORITY_MAP.has(normalized)
    ? PROJECTION_HIERARCHY_COORD_PRIORITY_MAP.get(normalized)
    : Number.POSITIVE_INFINITY;
}

function resolveProjectionHierarchyMetricValue(item = {}, key = "projected") {
  if (key === "historical") return Number(item?.kilos2025 || 0);
  if (key === "deltaKg") return Number(item?.deltaKg || 0);
  if (key === "deltaPct") {
    if (Number.isFinite(item?.deltaPct)) return Number(item.deltaPct || 0);
    return Number(item?.projected || 0) > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  return Number(item?.projected || 0);
}

function projectionHierarchySortComparator(sortMode = "excel", level = "group") {
  const mode = normalizeProjectionHierarchySort(sortMode);
  const labelKey = level === "group" ? "coordinador" : "sortLabel";

  return (left = {}, right = {}) => {
    if (mode === "excel" && level === "group") {
      const rankDelta = projectionHierarchyCoordinatorRank(left.coordinador) - projectionHierarchyCoordinatorRank(right.coordinador);
      if (rankDelta !== 0) return rankDelta;
      return projectionHierarchyTextCompare(left.coordinador, right.coordinador);
    }

    if (mode === "excel" || mode === "name") {
      const nameDelta = projectionHierarchyTextCompare(left?.[labelKey], right?.[labelKey]);
      if (nameDelta !== 0) return nameDelta;
    } else {
      const metricKey = mode === "historical" ? "historical" : mode;
      const primaryDelta = resolveProjectionHierarchyMetricValue(right, metricKey) - resolveProjectionHierarchyMetricValue(left, metricKey);
      if (Number.isFinite(primaryDelta) && primaryDelta !== 0) return primaryDelta;
    }

    const projectedDelta = Number(right?.projected || 0) - Number(left?.projected || 0);
    if (projectedDelta !== 0) return projectedDelta;
    const historicalDelta = Number(right?.kilos2025 || 0) - Number(left?.kilos2025 || 0);
    if (historicalDelta !== 0) return historicalDelta;
    return projectionHierarchyTextCompare(left?.[labelKey], right?.[labelKey]);
  };
}

function sanitizeProjectionHierarchyFilename(value = "") {
  return String(value || "proyeccion_coordinador_agente")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "proyeccion_coordinador_agente";
}

function csvEscapeProjectionHierarchyValue(value) {
  const raw = value == null ? "" : String(value);
  if (/[";\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function buildProjectionHierarchyPresentation(meta = getProjectionMeta()) {
  const state = getProjectionHierarchyState();
  const view = getProjectionHierarchyViewState();

  const preparedGroups = (state.groups || []).map((group) => {
    const projectedGroup = projectValue(group.kilosActuales, meta);
    const deltaGroup = projectionDelta(projectedGroup, group.kilos2025, { fmtSignedPct });
    const agentes = (group.agentes || []).map((agent) => {
      const projectedAgent = projectValue(agent.kilosActuales, meta);
      const deltaAgent = projectionDelta(projectedAgent, agent.kilos2025, { fmtSignedPct });
      const sortLabel = agent.agente || agent.agenteNombre || "Sin agente";
      return {
        ...agent,
        sortLabel,
        projected: projectedAgent,
        deltaKg: Number(deltaAgent.deltaKg || 0),
        deltaPct: deltaAgent.deltaPct,
        deltaPctLabel: deltaAgent.deltaPctLabel,
        trend: deltaAgent.trend,
        changed: Boolean(deltaAgent.deltaKg) || deltaAgent.deltaPct === null
      };
    });

    return {
      ...group,
      projected: projectedGroup,
      deltaKg: Number(deltaGroup.deltaKg || 0),
      deltaPct: deltaGroup.deltaPct,
      deltaPctLabel: deltaGroup.deltaPctLabel,
      trend: deltaGroup.trend,
      changed: Boolean(deltaGroup.deltaKg) || deltaGroup.deltaPct === null,
      agentesPositivos: agentes.filter(agent => Number(agent.deltaKg || 0) > 0).length,
      agentesNegativos: agentes.filter(agent => Number(agent.deltaKg || 0) < 0).length,
      agentes
    };
  });

  const filteredGroups = view.onlyChanges
    ? preparedGroups.filter(group => group.changed || group.agentes.some(agent => agent.changed))
    : preparedGroups;

  const groupComparator = projectionHierarchySortComparator(view.sort, "group");
  const agentComparator = projectionHierarchySortComparator(view.sort, "agent");

  const groups = filteredGroups
    .map(group => ({
      ...group,
      agentes: [...group.agentes].sort(agentComparator)
    }))
    .sort(groupComparator);

  const summary = groups.reduce((acc, group) => {
    acc.coordinadores += 1;
    acc.agentes += group.agentes.length;
    acc.kilosActuales += Number(group.kilosActuales || 0);
    acc.kilos2025 += Number(group.kilos2025 || 0);
    acc.kilosProyectados += Number(group.projected || 0);
    if (group.deltaKg > 0) acc.positivos += 1;
    if (group.deltaKg < 0) acc.negativos += 1;
    return acc;
  }, {
    coordinadores: 0,
    agentes: 0,
    kilosActuales: 0,
    kilos2025: 0,
    kilosProyectados: 0,
    positivos: 0,
    negativos: 0
  });

  summary.delta = projectionDelta(summary.kilosProyectados, summary.kilos2025, { fmtSignedPct });

  return {
    sortLabel: PROJECTION_HIERARCHY_SORT_OPTIONS.find(option => option.value === view.sort)?.label || "Orden Excel",
    groups,
    summary,
    hiddenCount: Math.max(0, preparedGroups.length - groups.length),
    totalGroups: preparedGroups.length
  };
}

function downloadProjectionHierarchyCsv(presentation = {}, labels = {}) {
  const groups = Array.isArray(presentation?.groups) ? presentation.groups : [];
  if (!groups.length) return false;

  const compareLabel = String(labels?.compareLabel || "2025");
  const projectedLabel = String(labels?.projectedLabel || "Proyección");
  const rows = [
    ["Nivel", "Coordinador", "Agente", "Nombre agente", compareLabel, projectedLabel, "Var Kg", "Var %"]
  ];

  groups.forEach((group) => {
    rows.push([
      "Coordinador",
      group.coordinador,
      "",
      "",
      Number(group.kilos2025 || 0),
      Number(group.projected || 0),
      Number(group.deltaKg || 0),
      group.deltaPct == null ? "Nuevo" : Number(group.deltaPct || 0)
    ]);

    (group.agentes || []).forEach((agent) => {
      rows.push([
        "Agente",
        group.coordinador,
        agent.agente || agent.sortLabel || "",
        agent.agenteNombre || "",
        Number(agent.kilos2025 || 0),
        Number(agent.projected || 0),
        Number(agent.deltaKg || 0),
        agent.deltaPct == null ? "Nuevo" : Number(agent.deltaPct || 0)
      ]);
    });
  });

  rows.push([
    "Total",
    "",
    "",
    "",
    Number(presentation?.summary?.kilos2025 || 0),
    Number(presentation?.summary?.kilosProyectados || 0),
    Number(presentation?.summary?.delta?.deltaKg || 0),
    presentation?.summary?.delta?.deltaPct == null ? "Nuevo" : Number(presentation?.summary?.delta?.deltaPct || 0)
  ]);

  const csv = `﻿${rows.map(row => row.map(csvEscapeProjectionHierarchyValue).join(";")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeProjectionHierarchyFilename(`proyeccion_coord_agente_${labels?.compareLabel || "2025"}_${labels?.projectedLabel || "proyeccion"}`)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

function normalizeProjectionProductHierarchyPayloadGroups(groups = []) {
  return (groups || []).map(group => ({
    grupo: String(group?.grupo || "Sin familia").trim() || "Sin familia",
    kilosActuales: Number(group?.kilosActuales || 0),
    kilos2025: Number(group?.kilos2025 || 0),
    productos: (group?.productos || []).map(product => ({
      codProducto: String(product?.codProducto || "").trim(),
      productoDesc: String(product?.productoDesc || "").trim(),
      kilosActuales: Number(product?.kilosActuales || 0),
      kilos2025: Number(product?.kilos2025 || 0)
    }))
  }));
}

function normalizeProjectionProductHierarchySummaryRows(rows = []) {
  return (rows || []).map(row => ({
    key: String(row?.key || "").trim(),
    label: String(row?.label || "").trim(),
    kilosActuales: Number(row?.kilosActuales || 0),
    kilos2025: Number(row?.kilos2025 || 0)
  })).filter(row => row.label);
}

function resolveProjectionProductHierarchyMetricValue(item = {}, key = "projected") {
  if (key === "historical") return Number(item?.kilos2025 || 0);
  if (key === "deltaKg") return Number(item?.deltaKg || 0);
  if (key === "deltaPct") {
    if (Number.isFinite(item?.deltaPct)) return Number(item.deltaPct || 0);
    return Number(item?.projected || 0) > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  return Number(item?.projected || 0);
}

function projectionProductHierarchySortComparator(sortMode = "excel", level = "group") {
  const mode = normalizeProjectionHierarchySort(sortMode);
  const labelKey = level === "group" ? "grupo" : "sortLabel";

  return (left = {}, right = {}) => {
    if (mode === "excel" || mode === "name") {
      const nameDelta = projectionHierarchyTextCompare(left?.[labelKey], right?.[labelKey]);
      if (nameDelta !== 0) return nameDelta;
    } else {
      const metricKey = mode === "historical" ? "historical" : mode;
      const primaryDelta = resolveProjectionProductHierarchyMetricValue(right, metricKey) - resolveProjectionProductHierarchyMetricValue(left, metricKey);
      if (Number.isFinite(primaryDelta) && primaryDelta !== 0) return primaryDelta;
    }

    const projectedDelta = Number(right?.projected || 0) - Number(left?.projected || 0);
    if (projectedDelta !== 0) return projectedDelta;
    const historicalDelta = Number(right?.kilos2025 || 0) - Number(left?.kilos2025 || 0);
    if (historicalDelta !== 0) return historicalDelta;
    return projectionHierarchyTextCompare(left?.[labelKey], right?.[labelKey]);
  };
}

function buildProjectionProductHierarchyPresentation(meta = getProjectionMeta()) {
  const state = getProjectionProductHierarchyState();
  const view = getProjectionProductHierarchyViewState();

  const preparedGroups = (state.groups || []).map((group) => {
    const projectedGroup = projectValue(group.kilosActuales, meta);
    const deltaGroup = projectionDelta(projectedGroup, group.kilos2025, { fmtSignedPct });
    const productos = (group.productos || []).map((product) => {
      const projectedProduct = projectValue(product.kilosActuales, meta);
      const deltaProduct = projectionDelta(projectedProduct, product.kilos2025, { fmtSignedPct });
      const code = product.codProducto || "";
      const desc = product.productoDesc || "";
      const sortLabel = code && desc ? `${code} ${desc}` : (code || desc || "Sin producto");
      return {
        ...product,
        sortLabel,
        projected: projectedProduct,
        deltaKg: Number(deltaProduct.deltaKg || 0),
        deltaPct: deltaProduct.deltaPct,
        deltaPctLabel: deltaProduct.deltaPctLabel,
        trend: deltaProduct.trend,
        changed: Boolean(deltaProduct.deltaKg) || deltaProduct.deltaPct === null
      };
    });

    return {
      ...group,
      projected: projectedGroup,
      deltaKg: Number(deltaGroup.deltaKg || 0),
      deltaPct: deltaGroup.deltaPct,
      deltaPctLabel: deltaGroup.deltaPctLabel,
      trend: deltaGroup.trend,
      changed: Boolean(deltaGroup.deltaKg) || deltaGroup.deltaPct === null,
      productosPositivos: productos.filter(product => Number(product.deltaKg || 0) > 0).length,
      productosNegativos: productos.filter(product => Number(product.deltaKg || 0) < 0).length,
      productos
    };
  });

  const filteredGroups = view.onlyChanges
    ? preparedGroups.filter(group => group.changed || group.productos.some(product => product.changed))
    : preparedGroups;

  const groupComparator = projectionProductHierarchySortComparator(view.sort, "group");
  const productComparator = projectionProductHierarchySortComparator(view.sort, "product");

  const groups = filteredGroups
    .map(group => ({
      ...group,
      productos: [...group.productos].sort(productComparator)
    }))
    .sort(groupComparator);

  const summary = groups.reduce((acc, group) => {
    acc.familias += 1;
    acc.productos += group.productos.length;
    acc.kilosActuales += Number(group.kilosActuales || 0);
    acc.kilos2025 += Number(group.kilos2025 || 0);
    acc.kilosProyectados += Number(group.projected || 0);
    return acc;
  }, {
    familias: 0,
    productos: 0,
    kilosActuales: 0,
    kilos2025: 0,
    kilosProyectados: 0
  });
  summary.delta = projectionDelta(summary.kilosProyectados, summary.kilos2025, { fmtSignedPct });

  const summaryRows = (state.summaryRows || []).map((row) => {
    const projected = projectValue(row.kilosActuales, meta);
    const delta = projectionDelta(projected, row.kilos2025, { fmtSignedPct });
    return {
      ...row,
      projected,
      deltaKg: Number(delta.deltaKg || 0),
      deltaPct: delta.deltaPct,
      deltaPctLabel: delta.deltaPctLabel,
      trend: delta.trend
    };
  });

  return {
    sortLabel: PROJECTION_HIERARCHY_SORT_OPTIONS.find(option => option.value === view.sort)?.label || "Orden Excel",
    groups,
    summaryRows,
    summary,
    hiddenCount: Math.max(0, preparedGroups.length - groups.length),
    totalGroups: preparedGroups.length
  };
}

function downloadProjectionProductHierarchyCsv(presentation = {}, labels = {}) {
  const groups = Array.isArray(presentation?.groups) ? presentation.groups : [];
  if (!groups.length) return false;

  const compareLabel = String(labels?.compareLabel || "2025");
  const projectedLabel = String(labels?.projectedLabel || "Proyección");
  const rows = [
    ["Sección", "Nivel", "Familia", "Código", "Descripción", compareLabel, projectedLabel, "Var Kg", "Var %"]
  ];

  (presentation.summaryRows || []).forEach((row) => {
    rows.push([
      "Resumen",
      row.label,
      "",
      "",
      "",
      Number(row.kilos2025 || 0),
      Number(row.projected || 0),
      Number(row.deltaKg || 0),
      row.deltaPct == null ? "Nuevo" : Number(row.deltaPct || 0)
    ]);
  });

  groups.forEach((group) => {
    rows.push([
      "Familia",
      "Familia",
      group.grupo,
      "",
      "",
      Number(group.kilos2025 || 0),
      Number(group.projected || 0),
      Number(group.deltaKg || 0),
      group.deltaPct == null ? "Nuevo" : Number(group.deltaPct || 0)
    ]);

    (group.productos || []).forEach((product) => {
      rows.push([
        "Familia/Producto",
        "Producto",
        group.grupo,
        product.codProducto || "",
        product.productoDesc || "",
        Number(product.kilos2025 || 0),
        Number(product.projected || 0),
        Number(product.deltaKg || 0),
        product.deltaPct == null ? "Nuevo" : Number(product.deltaPct || 0)
      ]);
    });
  });

  const csv = `﻿${rows.map(row => row.map(csvEscapeProjectionHierarchyValue).join(";")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeProjectionHierarchyFilename(`proyeccion_familia_producto_${labels?.compareLabel || "2025"}_${labels?.projectedLabel || "proyeccion"}`)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

async function ensureProjectionProductHierarchyLoaded(force = false) {
  const context = getProjectionCompareContext();
  if (!context?.valid) {
    projectionProductHierarchyState = {
      ...createEmptyProjectionProductHierarchyState(),
      loaded: true,
      available: false,
      message: context?.message || "No se pudo determinar el período a comparar."
    };
    projectionProductHierarchyLoadedFor = "";
    return false;
  }

  const qs = getProjectionProductHierarchyKey(context);
  if (!force && projectionProductHierarchyLoadedFor === qs && projectionProductHierarchyState.loaded) return true;

  const mySeq = ++projectionProductHierarchySeq;
  projectionProductHierarchyState = {
    ...createEmptyProjectionProductHierarchyState(),
    loading: true,
    currentLabel: context.currentLabel || "",
    compareLabel: context.compareLabel || ""
  };

  try {
    const payload = await dataService.fetchProjectionProductHierarchy(qs, { abortPrevious: true });
    if (mySeq !== projectionProductHierarchySeq) return false;

    const groups = normalizeProjectionProductHierarchyPayloadGroups(payload?.familyGroups || payload?.groups || []);
    const availableKeys = new Set(groups.map(group => String(group.grupo || "")));
    if (!projectionProductHierarchyExpanded.size) {
      projectionProductHierarchyExpanded = new Set(groups.map(group => String(group.grupo || "")));
    } else {
      projectionProductHierarchyExpanded = new Set([...projectionProductHierarchyExpanded].filter(key => availableKeys.has(key)));
      if (!projectionProductHierarchyExpanded.size && groups.length) {
        projectionProductHierarchyExpanded = new Set(groups.map(group => String(group.grupo || "")));
      }
    }

    projectionProductHierarchyState = {
      ...createEmptyProjectionProductHierarchyState(),
      loaded: true,
      available: Boolean(payload?.available),
      currentLabel: String(payload?.current?.label || context.currentLabel || ""),
      compareLabel: String(payload?.compare?.label || context.compareLabel || ""),
      groups,
      summaryRows: normalizeProjectionProductHierarchySummaryRows(payload?.summaryRows || []),
      summary: {
        familias: Number(payload?.summary?.familias || 0),
        productos: Number(payload?.summary?.productos || 0),
        kilosActuales: Number(payload?.summary?.kilosActuales || 0),
        kilos2025: Number(payload?.summary?.kilos2025 || 0)
      },
      note: String(payload?.meta?.summaryRuleNote || ""),
      message: String(payload?.meta?.message || ""),
      currentSource: String(payload?.meta?.currentSource || ""),
      historicalSource: String(payload?.meta?.historicalSource || "")
    };
    projectionProductHierarchyLoadedFor = qs;
    return true;
  } catch (error) {
    console.warn("[ensureProjectionProductHierarchyLoaded]", error);
    projectionProductHierarchyState = {
      ...createEmptyProjectionProductHierarchyState(),
      loaded: true,
      available: false,
      currentLabel: context.currentLabel || "",
      compareLabel: context.compareLabel || "",
      message: error?.message || "No se pudo cargar la proyección por familia y producto."
    };
    projectionProductHierarchyLoadedFor = qs;
    return false;
  }
}

function setProjectionProductHierarchyExpanded(expanded = true) {
  const groups = projectionProductHierarchyState.groups || [];
  projectionProductHierarchyExpanded = expanded
    ? new Set(groups.map(group => String(group.grupo || "")))
    : new Set();
  if (activeTab === TAB_PROY) renderProjectionProductHierarchy(getProjectionMeta());
}

function toggleProjectionProductHierarchyGroup(groupName = "") {
  const key = String(groupName || "");
  if (!key) return;
  if (projectionProductHierarchyExpanded.has(key)) projectionProductHierarchyExpanded.delete(key);
  else projectionProductHierarchyExpanded.add(key);
  if (activeTab === TAB_PROY) renderProjectionProductHierarchy(getProjectionMeta());
}

function renderProjectionProductHierarchy(meta = getProjectionMeta()) {
  const state = getProjectionProductHierarchyState();
  const context = getProjectionCompareContext();
  const view = getProjectionProductHierarchyViewState();
  const presentation = buildProjectionProductHierarchyPresentation(meta);
  const summaryBody = el("projectionFamilySummaryBody");
  const summaryNote = el("projectionFamilySummaryNote");
  const summaryCompareHead = el("projectionFamilySummaryHeadCompare");
  const summaryProjectedHead = el("projectionFamilySummaryHeadProjected");
  const productTools = el("projectionProductHierarchyTools");
  const productBody = el("projectionProductHierarchyBody");
  const productNote = el("projectionProductHierarchyNote");
  const productCompareHead = el("projectionProductHierarchyHeadCompare");
  const productProjectedHead = el("projectionProductHierarchyHeadProjected");

  if (!summaryBody || !productBody) return;

  const compareLabel = state.compareLabel || context.compareLabel || "2025";
  const currentLabel = state.currentLabel || context.currentLabel || "Período actual";
  const projectedLabel = `${currentLabel} Proy.`;

  if (summaryCompareHead) summaryCompareHead.textContent = compareLabel || "Base 2025";
  if (summaryProjectedHead) summaryProjectedHead.textContent = projectedLabel;
  if (productCompareHead) productCompareHead.textContent = compareLabel || "Base 2025";
  if (productProjectedHead) productProjectedHead.textContent = projectedLabel;
  if (productTools) productTools.innerHTML = "";

  if (!meta.ok) {
    setText("projectionFamilySummaryBadge", "Configurar");
    setText("projectionProductHierarchyBadge", "Configurar");
    summaryBody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🧮</div><p>${escHtml(meta.message)}</p></div></td></tr>`;
    productBody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🧮</div><p>${escHtml(meta.message)}</p></div></td></tr>`;
    if (summaryNote) {
      summaryNote.style.display = "block";
      summaryNote.textContent = "El resumen usa definiciones fijas de negocio para FIAMBRES, SALCHICHAS, HAMBURGUESAS, F+S+H y FRESCO.";
    }
    if (productNote) {
      productNote.style.display = "block";
      productNote.textContent = "Esta vista replica la jerarquía Grupo de Familia > Producto con la misma configuración de proyección.";
    }
    return;
  }

  if ((state.loading && !state.loaded) || (!state.loaded && !state.groups.length)) {
    setText("projectionFamilySummaryBadge", "Cargando");
    setText("projectionProductHierarchyBadge", "Cargando");
    summaryBody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">⏳</div><p>Cargando resumen de familias...</p></div></td></tr>`;
    productBody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">⏳</div><p>Cargando proyección por familia y producto...</p></div></td></tr>`;
    if (summaryNote) {
      summaryNote.style.display = "block";
      summaryNote.textContent = state.note || "Las definiciones del resumen están fijadas en backend para mantener consistencia con Excel.";
    }
    if (productNote) {
      productNote.style.display = "block";
      productNote.textContent = "Podés expandir o contraer cada familia para revisar el detalle de productos.";
    }
    return;
  }

  setText("projectionFamilySummaryBadge", `${fmt((presentation.summaryRows || []).length)} totales`);
  setText("projectionProductHierarchyBadge", `${fmt(presentation.summary.familias || 0)} fam. · ${fmt(presentation.summary.productos || 0)} prod.`);

  if (productTools && state.groups.length) {
    const deltaSummary = presentation.summary.delta || projectionDelta(0, 0, { fmtSignedPct });
    productTools.innerHTML = `
      <div class="projection-hierarchy-toolbar__summary">
        <span class="projection-hierarchy-chip">${fmt(presentation.summary.familias || 0)} familias</span>
        <span class="projection-hierarchy-chip">${fmt(presentation.summary.productos || 0)} productos</span>
        <span class="projection-hierarchy-chip">${projectedLabel}: ${fmt(presentation.summary.kilosProyectados || 0)}</span>
        <span class="projection-hierarchy-chip ${deltaSummary.trend}">Var. total ${fmtSigned(deltaSummary.deltaKg)} · ${deltaSummary.deltaPctLabel}</span>
      </div>
      <div class="projection-hierarchy-toolbar__actions">
        <label class="projection-hierarchy-control">
          <span>Orden</span>
          <select data-proj-product-sort aria-label="Ordenar proyección por familia y producto">
            ${PROJECTION_HIERARCHY_SORT_OPTIONS.map(option => `<option value="${option.value}" ${option.value === view.sort ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
        <label class="projection-hierarchy-control projection-hierarchy-control--toggle">
          <input type="checkbox" data-proj-product-only-changes ${view.onlyChanges ? "checked" : ""}>
          <span>Solo con variación</span>
        </label>
        <button type="button" class="btn-xs" data-proj-product-action="expand">Expandir</button>
        <button type="button" class="btn-xs" data-proj-product-action="collapse">Contraer</button>
        <button type="button" class="btn-xs" data-proj-product-action="export">Exportar CSV</button>
      </div>
    `;

    const sortSelect = productTools.querySelector("[data-proj-product-sort]");
    if (sortSelect) {
      sortSelect.addEventListener("change", () => patchProjectionProductHierarchyView({ sort: sortSelect.value }));
    }

    const onlyChangesInput = productTools.querySelector("[data-proj-product-only-changes]");
    if (onlyChangesInput) {
      onlyChangesInput.addEventListener("change", () => patchProjectionProductHierarchyView({ onlyChanges: onlyChangesInput.checked }));
    }

    productTools.querySelectorAll("[data-proj-product-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-proj-product-action");
        if (action === "expand" || action === "collapse") {
          setProjectionProductHierarchyExpanded(action === "expand");
          return;
        }
        if (action === "export") {
          const exported = downloadProjectionProductHierarchyCsv(presentation, { compareLabel, projectedLabel });
          if (exported) setStatus("CSV familia/producto descargado", "ok");
        }
      });
    });
  }

  if (!state.groups.length) {
    summaryBody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🔍</div><p>Sin resultados para los filtros actuales.</p></div></td></tr>`;
    productBody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🔍</div><p>Sin productos visibles para los filtros actuales.</p></div></td></tr>`;
    if (summaryNote) {
      summaryNote.style.display = "block";
      summaryNote.textContent = state.note || "Las definiciones fijas del resumen siguen activas aunque no haya resultados en este filtro.";
    }
    if (productNote) {
      productNote.style.display = "block";
      productNote.textContent = state.message || "Probá ampliando el período o quitando algún filtro para ver la jerarquía completa.";
    }
    return;
  }

  if (!presentation.groups.length) {
    summaryBody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🎯</div><p>No hay familias visibles con la opción actual.</p></div></td></tr>`;
    productBody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🎯</div><p>No hay familias o productos visibles con la opción actual.</p></div></td></tr>`;
    if (summaryNote) {
      summaryNote.style.display = "block";
      summaryNote.textContent = view.onlyChanges ? `La opción “Solo con variación” ocultó ${fmt(presentation.hiddenCount || 0)} familias sin diferencias.` : (state.note || "");
    }
    if (productNote) {
      productNote.style.display = "block";
      productNote.textContent = view.onlyChanges ? `La opción “Solo con variación” ocultó ${fmt(presentation.hiddenCount || 0)} familias sin diferencias.` : (state.message || "");
    }
    return;
  }

  const summaryRows = presentation.summaryRows.length
    ? presentation.summaryRows.map(row => `
      <tr class="proj-hierarchy-row proj-hierarchy-row--summary is-${row.trend}">
        <td data-label="Resumen">${escHtml(row.label)}</td>
        <td data-label="${escHtml(compareLabel)}" class="num r">${fmt(row.kilos2025)}</td>
        <td data-label="${escHtml(projectedLabel)}" class="num r">${fmt(row.projected)}</td>
        <td data-label="Var. Kg" class="num r"><span class="trend-chip ${row.trend}">${fmtSigned(row.deltaKg)}</span></td>
        <td data-label="Var. %" class="num r"><span class="trend-chip ${row.trend}">${row.deltaPctLabel}</span></td>
      </tr>
    `).join("")
    : `<tr><td colspan="5"><div class="empty"><div class="eico">📋</div><p>No hay totales resumidos para los filtros actuales.</p></div></td></tr>`;
  summaryBody.innerHTML = summaryRows;

  const productRows = [];
  presentation.groups.forEach((group) => {
    const expanded = projectionProductHierarchyExpanded.has(String(group.grupo || ""));
    productRows.push(`
      <tr class="proj-hierarchy-row proj-hierarchy-row--group is-${group.trend}">
        <td data-label="Etiquetas de fila">
          <button type="button" class="proj-hierarchy-toggle" data-proj-product-toggle="${escHtml(group.grupo)}" aria-expanded="${expanded ? "true" : "false"}">
            <span class="proj-hierarchy-caret">${expanded ? "▾" : "▸"}</span>
            <span class="proj-hierarchy-name-wrap">
              <span class="proj-hierarchy-name">${escHtml(group.grupo)}</span>
              <span class="proj-hierarchy-group-meta">
                <span class="proj-hierarchy-pill">Subtotal</span>
                <span class="proj-hierarchy-pill proj-hierarchy-pill--subtle">${fmt(group.productos.length)} productos</span>
                ${group.productosPositivos ? `<span class="proj-hierarchy-pill proj-hierarchy-pill--positive">+${fmt(group.productosPositivos)}</span>` : ""}
                ${group.productosNegativos ? `<span class="proj-hierarchy-pill proj-hierarchy-pill--negative">−${fmt(group.productosNegativos)}</span>` : ""}
              </span>
            </span>
          </button>
        </td>
        <td data-label="${escHtml(compareLabel)}" class="num r">${fmt(group.kilos2025)}</td>
        <td data-label="${escHtml(projectedLabel)}" class="num r">${fmt(group.projected)}</td>
        <td data-label="Var. Kg" class="num r"><span class="trend-chip ${group.trend}">${fmtSigned(group.deltaKg)}</span></td>
        <td data-label="Var. %" class="num r"><span class="trend-chip ${group.trend}">${group.deltaPctLabel}</span></td>
      </tr>
    `);

    if (!expanded) return;

    group.productos.forEach((product) => {
      const productLabel = product.codProducto || product.productoDesc || product.sortLabel || "Sin producto";
      const showSub = product.codProducto && product.productoDesc;
      productRows.push(`
        <tr class="proj-hierarchy-row proj-hierarchy-row--agent">
          <td data-label="Etiquetas de fila">
            <div class="proj-hierarchy-agent-cell" title="${escHtml(product.productoDesc || productLabel)}">
              <span class="proj-hierarchy-agent-code">${escHtml(productLabel)}</span>
              ${showSub ? `<span class="proj-hierarchy-agent-sub">${escHtml(product.productoDesc)}</span>` : ""}
            </div>
          </td>
          <td data-label="${escHtml(compareLabel)}" class="num r">${fmt(product.kilos2025)}</td>
          <td data-label="${escHtml(projectedLabel)}" class="num r">${fmt(product.projected)}</td>
          <td data-label="Var. Kg" class="num r">${fmtSigned(product.deltaKg)}</td>
          <td data-label="Var. %" class="num r"><span class="trend-chip ${product.trend}">${product.deltaPctLabel}</span></td>
        </tr>
      `);
    });
  });

  productRows.push(`
    <tr class="proj-hierarchy-row proj-hierarchy-row--total">
      <td data-label="Etiquetas de fila">Total general</td>
      <td data-label="${escHtml(compareLabel)}" class="num r">${fmt(presentation.summary.kilos2025 || 0)}</td>
      <td data-label="${escHtml(projectedLabel)}" class="num r">${fmt(presentation.summary.kilosProyectados || 0)}</td>
      <td data-label="Var. Kg" class="num r"><span class="trend-chip ${presentation.summary.delta?.trend || 'neutral'}">${fmtSigned(presentation.summary.delta?.deltaKg || 0)}</span></td>
      <td data-label="Var. %" class="num r"><span class="trend-chip ${presentation.summary.delta?.trend || 'neutral'}">${presentation.summary.delta?.deltaPctLabel || '0,0%'}</span></td>
    </tr>
  `);
  productBody.innerHTML = productRows.join("");
  productBody.querySelectorAll("[data-proj-product-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleProjectionProductHierarchyGroup(button.getAttribute("data-proj-product-toggle")));
  });

  if (summaryNote) {
    summaryNote.style.display = "block";
    summaryNote.textContent = state.note || "FIAMBRES = todas las familias salvo Fresco, Hamburguesas y Salchichas. F+S+H = total sin Fresco.";
  }
  if (productNote) {
    productNote.style.display = "block";
    productNote.textContent = `Expandí cada familia para ver sus productos. Orden actual: ${presentation.sortLabel}. ${view.onlyChanges ? `Se ocultaron ${fmt(presentation.hiddenCount || 0)} familias sin variación.` : ""}`.trim();
  }
}

async function ensureProjectionHierarchyLoaded(force = false) {
  const context = getProjectionCompareContext();
  if (!context?.valid) {
    projectionHierarchyState = {
      ...createEmptyProjectionHierarchyState(),
      loaded: true,
      available: false,
      message: context?.message || "No se pudo determinar el período a comparar."
    };
    projectionHierarchyLoadedFor = "";
    return false;
  }

  const qs = getProjectionHierarchyKey(context);
  if (!force && projectionHierarchyLoadedFor === qs && projectionHierarchyState.loaded) return true;

  const mySeq = ++projectionHierarchySeq;
  projectionHierarchyState = {
    ...createEmptyProjectionHierarchyState(),
    loading: true,
    currentLabel: context.currentLabel || "",
    compareLabel: context.compareLabel || ""
  };

  try {
    const payload = await dataService.fetchProjectionHierarchy(qs, { abortPrevious: true });
    if (mySeq !== projectionHierarchySeq) return false;

    const groups = normalizeProjectionHierarchyPayloadGroups(payload?.groups || []);
    const availableKeys = new Set(groups.map(group => String(group.coordinador || "")));
    if (!projectionHierarchyExpanded.size) {
      projectionHierarchyExpanded = new Set(groups.map(group => String(group.coordinador || "")));
    } else {
      projectionHierarchyExpanded = new Set([...projectionHierarchyExpanded].filter(key => availableKeys.has(key)));
      if (!projectionHierarchyExpanded.size && groups.length) {
        projectionHierarchyExpanded = new Set(groups.map(group => String(group.coordinador || "")));
      }
    }

    projectionHierarchyState = {
      ...createEmptyProjectionHierarchyState(),
      loaded: true,
      available: Boolean(payload?.available),
      currentLabel: String(payload?.current?.label || context.currentLabel || ""),
      compareLabel: String(payload?.compare?.label || context.compareLabel || ""),
      groups,
      summary: {
        coordinadores: Number(payload?.summary?.coordinadores || 0),
        agentes: Number(payload?.summary?.agentes || 0),
        kilosActuales: Number(payload?.summary?.kilosActuales || 0),
        kilos2025: Number(payload?.summary?.kilos2025 || 0)
      },
      message: String(payload?.meta?.message || ""),
      currentSource: String(payload?.meta?.currentSource || ""),
      historicalSource: String(payload?.meta?.historicalSource || "")
    };
    projectionHierarchyLoadedFor = qs;
    return true;
  } catch (error) {
    console.warn("[ensureProjectionHierarchyLoaded]", error);
    projectionHierarchyState = {
      ...createEmptyProjectionHierarchyState(),
      loaded: true,
      available: false,
      currentLabel: context.currentLabel || "",
      compareLabel: context.compareLabel || "",
      message: error?.message || "No se pudo cargar la proyección por coordinador y agente."
    };
    projectionHierarchyLoadedFor = qs;
    return false;
  }
}

function setProjectionHierarchyExpanded(expanded = true) {
  const groups = projectionHierarchyState.groups || [];
  projectionHierarchyExpanded = expanded
    ? new Set(groups.map(group => String(group.coordinador || "")))
    : new Set();
  if (activeTab === TAB_PROY) renderProjectionHierarchy(getProjectionMeta());
}

function toggleProjectionHierarchyGroup(coordinador) {
  const key = String(coordinador || "").trim();
  if (!key) return;
  if (projectionHierarchyExpanded.has(key)) projectionHierarchyExpanded.delete(key);
  else projectionHierarchyExpanded.add(key);
  if (activeTab === TAB_PROY) renderProjectionHierarchy(getProjectionMeta());
}


// ── Utils ─────────────────────────────────────────────────────────────────────
function setActiveTab(tabName, { persist = true } = {}) {
  activeTab = normalizeTabName(tabName);
  if (persist) persistActiveTab(activeTab);
  if (tabsController) {
    tabsController.activate(activeTab, { emit: false });
    return;
  }
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.tab === activeTab));
  document.querySelectorAll(".page").forEach(x => {
    const active = x.id === `page-${activeTab}`;
    x.classList.toggle("on", active);
    x.hidden = !active;
  });
}

function setStatus(t, s = "ok") {
  const d = el("dot"), tx = el("stxt"), live = el("ariaStatus");
  if (d) {
    d.className = "dot " + s;
    const label = s === "err" ? "Estado: Error" : s === "spin" ? "Estado: Conectando" : "Estado: Conectado";
    d.setAttribute("aria-label", label);
    d.setAttribute("title", label);
  }
  if (tx) tx.textContent = t;
  if (live) live.textContent = t;
}

function showOverlay(on) {
  const o = el("ov");
  if (o) o.classList.toggle("h", !on);
}

// v40: error state contextualizado — clasifica el error para dar contexto al usuario
function classifyError(msg) {
  const s = String(msg || "").toLowerCase();
  if (/401|403|autorizaci|credencial|sesión|login|auth/.test(s))
    return { type: "auth",    title: "Sesión expirada",        icon: "🔑", hint: "Volvé a ingresar con tus credenciales." };
  if (/timeout|time.out|504|503|connect|network|net::err|fetch/.test(s))
    return { type: "network", title: "Sin conexión",           icon: "📡", hint: "Verificá tu conexión a internet." };
  if (/500|worker|d1|database|sql/.test(s))
    return { type: "server",  title: "Error del servidor",     icon: "⚙️", hint: "El servidor tuvo un problema. Reintentá en unos segundos." };
  return   { type: "unknown", title: "Error al cargar datos",  icon: "⚠️", hint: "" };
}

let _errCountdownTimer = 0;

function showErr(msg) {
  const b = el("ebar"), m = el("emsg"), tit = b?.querySelector(".etit");
  const info = classifyError(msg);
  if (tit) tit.textContent = info.title;
  if (m)   m.textContent   = info.hint ? `${info.hint}${msg ? " (" + msg + ")" : ""}` : (msg || "");
  if (b)   b.classList.add("v");
  // icono en el ebar si existe
  const ico = b?.querySelector(".ebar-ico");
  if (ico) ico.textContent = info.icon;
  // Retry automático con countdown de 8s (solo para errores de red)
  if (info.type === "network") {
    clearInterval(_errCountdownTimer);
    let secs = 8;
    const btn = el("btnRetryLoad");
    const orig = btn?.textContent || "Reintentar";
    if (btn) btn.textContent = `Reintentar (${secs}s)`;
    _errCountdownTimer = setInterval(() => {
      secs--;
      if (btn) btn.textContent = secs > 0 ? `Reintentar (${secs}s)` : orig;
      if (secs <= 0) {
        clearInterval(_errCountdownTimer);
        hideErr();
        el("btnRetryLoad")?.click();
      }
    }, 1000);
  }
}

function hideErr() {
  const b = el("ebar");
  if (b) b.classList.remove("v");
  clearInterval(_errCountdownTimer);
  const btn = el("btnRetryLoad");
  if (btn && btn.textContent.includes("s)")) btn.textContent = "Reintentar";
}

const authStore = createAuthStore(AUTH_STORAGE_KEY);

const authUi = {
  ensureShell() {
    return renderAuthShell({
      documentRef: document,
      el,
      styleId: AUTH_STYLE_ID,
      onSubmit: handleAuthSubmit,
      onLogout: logoutAuth
    });
  },
  showOverlay(message = "") {
    return openAuthOverlay({
      el,
      ensureShell: () => authUi.ensureShell(),
      message
    });
  },
  hideOverlay() {
    return closeAuthOverlay({ el });
  },
  updateUserBadge(user = "") {
    return renderAuthUserBadge({ el, user });
  }
};

function getStoredAuthToken() {
  return authStore.get();
}

function setStoredAuthToken(token) {
  return authStore.set(token);
}

function clearStoredAuthToken() {
  return authStore.clear();
}

function cancelScheduledLoads() {
  if (scheduledStateLoadTimer) {
    clearTimeout(scheduledStateLoadTimer);
    scheduledStateLoadTimer = 0;
  }
  if (scheduledProjectionLoadTimer) {
    clearTimeout(scheduledProjectionLoadTimer);
    scheduledProjectionLoadTimer = 0;
  }
}

function abortInflightWork() {
  dataService.abortAll();
  if (currentLoadCtrl) currentLoadCtrl.abort();
  currentLoadCtrl = null;
}

function resetViewControllers({ preserveProjectionGroups = true, preserveDetailExplorer = true } = {}) {
  detailController.reset();
  if (!preserveDetailExplorer) {
    resetDetailExplorer();
  }
  resetDetailColumnOptions();
  resetProjectionExplorer();
  resetAccumExplorer();
  projectionController.reset({ preserveGroups: preserveProjectionGroups });
  resetProjectionHierarchyState({ preserveExpansion: true });
  resetProjectionProductHierarchyState({ preserveExpansion: true });
  insightsController.reset();
}

function shouldIgnoreRuntimeError(error) {
  if (!error) return false;
  if (error?.name === "AbortError") return true;
  return /Autenticacion requerida/i.test(String(error?.message || error || ""));
}

function reportRuntimeError(context, error) {
  if (shouldIgnoreRuntimeError(error)) return;
  const message = String(error?.message || error || "Error inesperado de interfaz.").trim() || "Error inesperado de interfaz.";
  console.error(`[${context}]`, error);
  showOverlay(false);
  setStatus("Error de interfaz", "err");
  showErr(message);
}

function installRuntimeGuards() {
  if (window.__ventasDashRuntimeGuardsInstalled) return;
  window.__ventasDashRuntimeGuardsInstalled = true;

  window.addEventListener("error", (event) => {
    reportRuntimeError("window.error", event?.error || event);
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportRuntimeError("window.unhandledrejection", event?.reason || event);
  });

  window.addEventListener("pagehide", () => {
    cancelScheduledLoads();
    abortInflightWork();
    cancelBrowserIdleTask(lazyWarmupHandle);
    lazyWarmupHandle = null;
    cancelBrowserIdleTask(serviceWorkerRegistrationHandle);
    serviceWorkerRegistrationHandle = null;
  }, { capture: true });
}

function handleUnauthorized(message = "Autenticacion requerida.") {
  clearStoredAuthToken();
  authUi.updateUserBadge("");
  showOverlay(false);
  setStatus("Ingreso requerido", "err");
  authUi.showOverlay(message);
}

async function apiFetch(url, options = {}) {
  const token = getStoredAuthToken();
  if (!token) {
    handleUnauthorized();
    throw new Error("Autenticacion requerida.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Basic ${token}`);

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    handleUnauthorized("Credenciales invalidas o sesion cerrada.");
    throw new Error("Autenticacion requerida.");
  }

  return res;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const mail = String(el("authMail")?.value || "").trim();
  const pass = String(el("authPass")?.value || "");
  const submit = el("authSubmit");

  if (!mail || !pass) {
    setAuthMessage({ el, message: "Completá usuario y contraseña.", kind: "err" });
    return;
  }

  try {
    if (submit) submit.disabled = true;
    setAuthMessage({ el, message: "Validando acceso..." });
    const token = buildBasicToken(mail, pass);
    const res = await fetch(HEALTH_URL, {
      cache: "no-store",
      headers: { Authorization: `Basic ${token}` }
    });
    await readApiPayload(res);
    setStoredAuthToken(token);
    authUi.updateUserBadge(mail);
    authUi.hideOverlay();
    setStatus("Acceso concedido", "ok");
    await cargarEstado();
  } catch (err) {
    console.error("[auth]", err);
    clearStoredAuthToken();
    authUi.updateUserBadge("");
    const msg = /Autenticacion requerida/i.test(String(err?.message || ""))
      ? "Usuario o contraseña incorrectos."
      : (err?.message || "No se pudo validar el acceso.");
    setAuthMessage({ el, message: msg, kind: "err" });
    setStatus("Ingreso requerido", "err");
  } finally {
    if (submit) submit.disabled = false;
  }
}

function logoutAuth() {
  clearStoredAuthToken();
  authUi.updateUserBadge("");
  clearStoredDetailExplorerState();
  clearRuntimeCaches({ preserveProjectionGroups: false, preserveDetailExplorer: false });
  dashboardState = emptyDashboardState();
  cancelScheduledLoads();
  abortInflightWork();
  renderAll();
  showErr("Sesión cerrada. Volvé a ingresar para consultar datos.");
  authUi.showOverlay("Sesión cerrada.");
  setStatus("Ingreso requerido", "err");
}

function clearRuntimeCaches({ preserveProjectionGroups = true, preserveDetailExplorer = true } = {}) {
  stateCache.clear();
  detailCache.clear();
  insightsCache.clear();
  projectionCompareCache.clear();
  projectionDetailCache.clear();
  projectionHierarchyCache.clear();
  projectionProductHierarchyCache.clear();
  catalogCache.clear();
  catalogState = createCatalogState();
  clearTransientCaches();
  dataService.reset();
  resetViewControllers({ preserveProjectionGroups, preserveDetailExplorer });
}

function setActiveDataVersion(version) {
  const next = String(version || "legacy-no-metadata");
  if (activeDataVersion === next) return;
  activeDataVersion = next;
  clearRuntimeCaches();
}

function cacheKeyWithVersion(key) {
  return `${activeDataVersion}::${String(key || "")}`;
}

function rememberRuntimeVersion(version) {
  const clean = String(version || activeDataVersion || "legacy-no-metadata");
  setActiveDataVersion(clean);
  runtimeVersionState.checkedAt = Date.now();
  return activeDataVersion;
}

function syncDataVersionFromPayload(payload) {
  const next = payload?.meta?.dataVersion || payload?.dataVersion || payload?.dataset?.dataVersion;
  if (next) rememberRuntimeVersion(next);
  return activeDataVersion;
}

function scheduleStateLoad(delay = STATE_LOAD_DEBOUNCE_MS) {
  if (scheduledStateLoadTimer) clearTimeout(scheduledStateLoadTimer);
  setKPIsLoading(true);
  // Barra de progreso top
  const bar = document.getElementById("loadProgressBar");
  if (bar) { bar.className = "active"; }
  scheduledStateLoadTimer = window.setTimeout(() => {
    scheduledStateLoadTimer = 0;
    const nextStateKey = stateQueryString({ includeDetail: shouldShowDetailSummaryTable() });
    if (!currentLoadCtrl && nextStateKey && nextStateKey === activeStateKey) {
      setKPIsLoading(false);
      setFiltersCollapsed(filtersCollapsed, false);
      renderActiveTab();
      return;
    }
    cargarEstado();
  }, delay);
}

async function ensureRuntimeVersion(force = false) {
  const fresh = !force && activeDataVersion !== "bootstrap" && runtimeVersionState.checkedAt > 0 && (Date.now() - runtimeVersionState.checkedAt) < HEALTH_CHECK_TTL_MS;
  if (fresh) return activeDataVersion;
  if (!force && activeDataVersion === "bootstrap" && !hasWarmClientCaches()) {
    return activeDataVersion;
  }
  if (runtimeVersionState.pending) return runtimeVersionState.pending;

  runtimeVersionState.pending = (async () => {
    try {
      const res = await apiFetch(HEALTH_URL, { cache: "no-store" });
      const payload = await readApiPayload(res);
      return rememberRuntimeVersion(payload?.dataVersion || payload?.dataset?.dataVersion || activeDataVersion || "legacy-no-metadata");
    } catch (_) {
      runtimeVersionState.checkedAt = Date.now();
      return activeDataVersion || "legacy-no-metadata";
    } finally {
      runtimeVersionState.pending = null;
    }
  })();

  return runtimeVersionState.pending;
}

function stateQueryString({ includeDetail = false } = {}) {
  return buildStateQueryString({
    periodo: normalizedPeriodo(),
    filtros,
    includeDetail,
    detailGroups: getDetailQuickGroups(),
    getSelectedProducts,
    localeEs
  });
}

function detailQueryString(offset, limit) {
  return buildDetailQueryString({
    periodo: normalizedPeriodo(),
    filtros,
    detailGroups: getDetailQuickGroups(),
    offset,
    limit,
    columnFilters: detailExplorerState.view === "detalle" ? detailExplorerState.columnFilters : {},
    getSelectedProducts,
    localeEs
  });
}

function hasActiveDetailColumnFilters(state = detailExplorerState) {
  return Object.values(state?.columnFilters || {}).some(values => Array.isArray(values) && values.length);
}

function isDetailContextFullyHydrated() {
  const state = detailController.getState?.() || {};
  const rowsLoaded = Array.isArray(state.rows) ? state.rows.length : 0;
  const totalRows = Number(state.total || 0);
  if (!rowsLoaded) return totalRows === 0 && !state.hasMore;
  return !state.hasMore && (!Number.isFinite(totalRows) || totalRows === 0 || rowsLoaded >= totalRows);
}

async function reloadDetailSummaryFromBackend({ preserveStatus = false, hydrateAll = false } = {}) {
  if (!shouldShowDetailSummaryTable()) {
    renderTable();
    return false;
  }

  try {
    if (!preserveStatus) setStatus(hydrateAll ? "Recargando detalle filtrado completo..." : "Actualizando resumen filtrado...", "spin");
    const ok = await detailController.reloadContext({
      limit: DETAIL_PAGE,
      hydrateAll
    });
    if (ok && !preserveStatus) {
      const nextState = detailController.getState?.() || {};
      const suffix = hydrateAll && nextState.hasMore ? "+" : "";
      setStatus(`${fmt(Number(nextState.total || 0))}${suffix} registros`, "ok");
    }
    return ok;
  } catch (error) {
    if (error?.name === "AbortError") return false;
    console.error("[reloadDetailSummaryFromBackend]", error);
    showErr(error?.message || "Error actualizando resumen filtrado");
    setStatus("Error de carga", "err");
    return false;
  }
}

function detailOptionsScopeKey() {
  return buildStateQueryString({
    periodo: normalizedPeriodo(),
    filtros,
    detailGroups: getDetailQuickGroups(),
    includeDetail: false,
    getSelectedProducts,
    localeEs
  });
}

function detailOptionsQueryString(columnKey) {
  return buildDetailOptionsQueryString({
    periodo: normalizedPeriodo(),
    filtros,
    detailGroups: getDetailQuickGroups(),
    column: columnKey,
    columnFilters: detailExplorerState.columnFilters,
    getSelectedProducts,
    localeEs
  });
}

function resetDetailColumnOptions() {
  detailColumnOptionsState = { scopeKey: detailOptionsScopeKey(), byColumn: {}, loadingKey: "", seq: detailColumnOptionsState.seq + 1 };
}

async function ensureDetailColumnOptions(columnKey, { force = false } = {}) {
  const key = String(columnKey || "").trim();
  if (!key || detailExplorerState.view !== "detalle") return [];

  const scopeKey = detailOptionsScopeKey();
  if (detailColumnOptionsState.scopeKey !== scopeKey) {
    detailColumnOptionsState = { scopeKey, byColumn: {}, loadingKey: "", seq: detailColumnOptionsState.seq + 1 };
  }

  if (!force && Array.isArray(detailColumnOptionsState.byColumn[key])) return detailColumnOptionsState.byColumn[key];

  const seq = ++detailColumnOptionsState.seq;
  detailColumnOptionsState = { ...detailColumnOptionsState, loadingKey: key };
  renderTable();

  try {
    const payload = await dataService.fetchDetailOptions(detailOptionsQueryString(key), { abortPrevious: false });
    if (seq !== detailColumnOptionsState.seq) return detailColumnOptionsState.byColumn[key] || [];
    const values = Array.isArray(payload?.values) ? payload.values : [];
    const nextOptions = values.map(value => {
      const raw = String(value ?? "");
      return {
        value: raw,
        label: key === "Kilos" ? fmt(Number(raw || 0)) : raw
      };
    }).filter(option => option.value !== "");
    detailColumnOptionsState = {
      ...detailColumnOptionsState,
      byColumn: { ...detailColumnOptionsState.byColumn, [key]: nextOptions },
      loadingKey: detailColumnOptionsState.loadingKey === key ? "" : detailColumnOptionsState.loadingKey
    };
    renderTable();
    return nextOptions;
  } catch (error) {
    if (!shouldIgnoreRuntimeError(error)) console.error("[ensureDetailColumnOptions]", error);
    if (seq === detailColumnOptionsState.seq) {
      detailColumnOptionsState = {
        ...detailColumnOptionsState,
        loadingKey: detailColumnOptionsState.loadingKey === key ? "" : detailColumnOptionsState.loadingKey
      };
      renderTable();
    }
    return detailColumnOptionsState.byColumn[key] || [];
  }
}

function getProjectionCompareContext() {
  return buildProjectionCompareContext({
    periodo: normalizedPeriodo(),
    toISO,
    parseIsoDateParts,
    monthNameEs
  });
}

function getProjectionSelectedGroups() {
  return projectionController.getSelectedGroups();
}

function hasProjectionGroupSelection() {
  return projectionController.hasGroupSelection();
}

function normalizeQuickGroupSelection(values = []) {
  return [...new Set((values || []).map(value => String(value || "").trim()).filter(Boolean))].sort((a, b) => localeEs(a, b));
}

function getDetailQuickGroups() {
  return detailQuickGroups.slice();
}

function hasDetailQuickGroupSelection() {
  return detailQuickGroups.length > 0;
}

function buildAiContextSnapshot() {
  return {
    period: { ...normalizedPeriodo() },
    activeTab,
    filters: {
      ...filtros,
      codProd: getSelectedProducts(),
      projGroups: getProjectionSelectedGroups(),
      detailGroups: getDetailQuickGroups(),
      extraColumnFilters: detailExplorerState?.view === "detalle"
        ? { ...(detailExplorerState.columnFilters || {}) }
        : {}
    },
    projectionCompare: getProjectionCompareContext(),
    detailExplorer: {
      view: detailExplorerState?.view || "detalle",
      currentPreset: detailExplorerState?.currentPreset || "",
      columnFilters: detailExplorerState?.view === "detalle"
        ? { ...(detailExplorerState.columnFilters || {}) }
        : {}
    }
  };
}

window.VentasDashAIContext = {
  getSnapshot: buildAiContextSnapshot
};

function shouldShowDetailSummaryTable() {
  return shouldShowSummaryTable() || hasDetailQuickGroupSelection();
}

function clearDetailQuickGroups({ silent = false } = {}) {
  if (!detailQuickGroups.length) return false;
  detailQuickGroups = [];
  if (!silent) scheduleStateLoad();
  return true;
}

function toggleDetailQuickGroupSelection(groupName) {
  const nextValue = String(groupName || "").trim();
  if (!nextValue) return false;
  const next = new Set(detailQuickGroups);
  if (next.has(nextValue)) next.delete(nextValue);
  else next.add(nextValue);
  detailQuickGroups = normalizeQuickGroupSelection([...next]);
  scheduleStateLoad();
  return true;
}

function pruneDetailQuickGroups(entries = dashboardState?.rankings?.grupos || []) {
  const available = new Set((entries || []).map(item => String(item?.name || "").trim()).filter(Boolean));
  const next = normalizeQuickGroupSelection(detailQuickGroups.filter(group => available.has(group)));
  const changed = next.length !== detailQuickGroups.length || next.some((value, index) => value !== detailQuickGroups[index]);
  detailQuickGroups = next;
  return changed;
}

function shouldShowProjectionSummaryTable() {
  return shouldShowSummaryTable() || hasProjectionGroupSelection();
}

function getProjectionCurrentKpis() {
  const compareState = projectionController.getCompareState();
  const fallback = dashboardState?.kpis || emptyDashboardState().kpis;
  if (!compareState?.loaded) return fallback;
  const hasCurrentScope =
    Number.isFinite(Number(compareState.currentKilos)) ||
    Number.isFinite(Number(compareState.currentClientes)) ||
    Number.isFinite(Number(compareState.currentAgentes)) ||
    Number.isFinite(Number(compareState.currentRegistros));

  if (!hasCurrentScope) return fallback;

  return {
    kilos: Number(compareState.currentKilos || 0),
    clientes: Number(compareState.currentClientes || 0),
    agentes: Number(compareState.currentAgentes || 0),
    registros: Number(compareState.currentRegistros || 0)
  };
}

function renderProjectionPageStatic(meta = getProjectionMeta()) {
  syncProjectionInputs();
  renderProjectionCompareKpis(meta);
  updateProjectionSummary(meta);
  setProjectionKPIBlock(meta);
  renderProjectionStrip(meta);
  renderProjectionProductHierarchy(meta);
  renderProjectionHierarchy(meta);
  renderProjectionTable(meta);
}

function projectionDetailPageSize() {
  return hasProjectionGroupSelection() ? PROJECTION_DETAIL_PAGE : DETAIL_PAGE;
}

function projectionDetailBulkPageSize() {
  return hasProjectionGroupSelection() ? PROJECTION_DETAIL_BULK_PAGE : DETAIL_BULK_PAGE;
}

function scheduleProjectionLoad(delay = PROJECTION_GROUP_DEBOUNCE_MS) {
  if (scheduledProjectionLoadTimer) clearTimeout(scheduledProjectionLoadTimer);
  scheduledProjectionLoadTimer = window.setTimeout(() => {
    scheduledProjectionLoadTimer = 0;
    if (activeTab === TAB_PROY) renderProjectionPage();
  }, delay);
}

function toggleProjectionDetailGroup(groupName) {
  projectionController.toggleGroup(groupName);
  if (activeTab === TAB_PROY) {
    renderProjectionPageStatic(getProjectionMeta());
    scheduleProjectionLoad();
  }
}

function pruneProjectionGroupSelection() {
  return projectionController.pruneSelectedGroups();
}

function readyStatusLabel() {
  const detailState = detailController.getState();
  return shouldShowDetailSummaryTable() ? `${fmt(detailState.total)} filas resumen` : "Listo";
}

function needsInsightsForTab(tabName = activeTab) {
  return tabName === TAB_DETALLE || tabName === TAB_ACUM || tabName === TAB_GRAF;
}

function loadProjectionConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROJECTION_PREF_KEY) || "{}");
    return {
      habiles: normalizeProjectionValue(raw.habiles),
      transcurridos: normalizeProjectionValue(raw.transcurridos)
    };
  } catch (_) {
    return { habiles: "", transcurridos: "" };
  }
}

function persistProjectionConfig() {
  try {
    localStorage.setItem(PROJECTION_PREF_KEY, JSON.stringify(projectionConfig));
  } catch (_) {}
}

function syncProjectionInputs() {
  const inHabiles = el("pHabiles");
  const inTrans = el("pTranscurridos");
  if (inHabiles && document.activeElement !== inHabiles) inHabiles.value = projectionConfig.habiles || "";
  if (inTrans && document.activeElement !== inTrans) inTrans.value = projectionConfig.transcurridos || "";
}

function resolveProjectionConfigForRender() {
  const stateHabiles = normalizeProjectionValue(projectionConfig?.habiles);
  const stateTranscurridos = normalizeProjectionValue(projectionConfig?.transcurridos);
  if (stateHabiles && stateTranscurridos) {
    if (projectionConfig.habiles !== stateHabiles || projectionConfig.transcurridos !== stateTranscurridos) {
      projectionConfig = { habiles: stateHabiles, transcurridos: stateTranscurridos };
    }
    return projectionConfig;
  }

  const inputHabiles = normalizeProjectionValue(el("pHabiles")?.value || "");
  const inputTranscurridos = normalizeProjectionValue(el("pTranscurridos")?.value || "");
  if (inputHabiles || inputTranscurridos) {
    projectionConfig = {
      habiles: inputHabiles || stateHabiles || "",
      transcurridos: inputTranscurridos || stateTranscurridos || ""
    };
    return projectionConfig;
  }

  const stored = loadProjectionConfig();
  if (stored.habiles || stored.transcurridos) {
    projectionConfig = stored;
    return projectionConfig;
  }

  return projectionConfig;
}

function getProjectionMeta() {
  return getProjectionMetaFromModule(resolveProjectionConfigForRender());
}

function projectionTableIsExpanded() {
  const detailState = projectionController.getDetailState();
  return (detailState?.viewMode || "") === "detail" || hasProjectionGroupSelection();
}

function setProjectionTableHead(expanded = projectionTableIsExpanded()) {
  const head = el("pthead");
  if (!head) return;
  head.innerHTML = `<tr>${projectionTableHeaders(expanded).map((label, idx) => `<th${idx >= (expanded ? 5 : 2) ? ' class="r"' : ''}>${label}</th>`).join("")}</tr>`;
}


function syncTabsTop() {
  const hdr = document.querySelector(".hdr");
  const fp = el("filterPanel");
  const tb = el("tabsBar");
  if (!hdr || !fp || !tb) return;
  // v42b FIX: on mobile, filter panel is a fixed bottom-sheet (position:fixed,
  // transform:translateY(105%)). offsetHeight returns full rendered height
  // even when the panel is off-screen — causing tabs to stick at wrong position.
  // When it's a mobile sheet, it contributes 0 to the sticky offset.
  const fpH = isMobileSheet() ? 0 : fp.offsetHeight;
  const offset = hdr.offsetHeight + fpH;
  if (tabsController) {
    tabsController.setTop(offset);
    return;
  }
  tb.style.top = offset + "px";
}


const TAB_UX_CONTENT = {
  [TAB_DETALLE]: {
    eyebrow: "Vista operativa",
    title: "Detalle comercial",
    copy: "Seguimiento diario con filtros en cascada, grupos con filtro rápido, comparativa diaria de meses y un explorador local del resumen para ordenar y buscar sin salir de la pantalla.",
    context: "Exploración y validación"
  },
  [TAB_PROY]: {
    eyebrow: "Planeamiento",
    title: "Proyección del mes",
    copy: "2026 se lee en base diaria y la referencia 2025 se toma a cierre mensual. La pantalla está pensada para decidir rápido y profundizar sólo cuando hace falta.",
    context: "2026 diario · 2025 cierre"
  },
  [TAB_ACUM]: {
    eyebrow: "Distribución comercial",
    title: "Acumulados y concentración",
    copy: "Lectura ejecutiva de coordinadores, agentes, grupos, marcas y clientes para detectar concentración y oportunidades de cobertura.",
    context: "Rankings y concentración"
  },
  [TAB_RESUMEN_ACUM]: {
    eyebrow: "Resumen ejecutivo",
    title: "Resumen acumulado",
    copy: "Vista rápida de ventas acumuladas por familia, coordinador, agente o región, respetando los filtros del tablero y con comparación YTD contra 2025.",
    context: "Acumulado filtrable"
  },
  [TAB_FREC]: {
    eyebrow: "Comportamiento comercial",
    title: "Frecuencia de compra",
    copy: "Analizá con qué regularidad compran tus clientes, familias, productos o agentes. Detectá clientes regulares, en riesgo, dormidos y perdidos según su patrón de compra.",
    context: "Frecuencia · Recencia · Segmentación"
  },
  [TAB_GRAF]: {
    eyebrow: "Lectura visual",
    title: "Gráficos y tendencias",
    copy: "Visuales rápidas para detectar mix, líderes y evolución mensual, ahora complementadas con una comparativa diaria del mes de referencia frente a sus meses previos.",
    context: "Storytelling visual"
  }
};

const PERIOD_BUTTON_TITLES = {
  "7": "Últimos 7 días",
  "15": "Últimos 15 días",
  "30": "Últimos 30 días",
  "90": "Últimos 3 meses",
  mes: "Mes calendario en curso (del 1 al día de hoy)",
  todo: "Todo el histórico disponible"
};

function formatPeriodSummary() {
  const desde = String(periodo?.desde || '').trim();
  const hasta = String(periodo?.hasta || '').trim();
  if (!desde && !hasta) return 'Período: todo el histórico disponible';
  return `Período: ${desde || 'inicio'} → ${hasta || 'hoy'}`;
}

function buildActiveFilterSummary() {
  const parts = [];
  if (filtros.coordinador) parts.push(`Coord. ${filtros.coordinador}`);
  if (filtros.agente) parts.push(`Agente ${filtros.agente}`);
  if (filtros.cliente) parts.push(`Cliente ${getSelectedClientLabel() || filtros.cliente}`);
  if (filtros.grupo) parts.push(`Grupo ${filtros.grupo}`);
  if (filtros.marca) parts.push(`Marca ${filtros.marca}`);
  if (hasProductFilter()) {
    const selected = getSelectedProducts();
    parts.push(selected.length === 1 ? `Producto ${selected[0]}` : `${selected.length} productos`);
  }
  return parts;
}

function updateUxChrome() {
  const content = TAB_UX_CONTENT[activeTab] || TAB_UX_CONTENT[TAB_DETALLE];
  const periodRange = normalizedPeriodo();
  const filterCount = countBusinessFilters();
  const filterSummary = buildActiveFilterSummary();
  const periodShort = (periodRange.desde || periodRange.hasta || '').slice(0, 7);
  const filterLabel = filterCount ? ` · ${filterCount} filtro${filterCount > 1 ? 's' : ''}` : '';

  setText('pageEyebrow', content.eyebrow);
  setText('pageTitle', content.title);
  setText('pageCopy', content.copy);
  setText('heroPeriod', formatPeriodSummary());
  setText('heroFilters', filterCount ? `${filterCount} filtro${filterCount === 1 ? '' : 's'} activo${filterCount === 1 ? '' : 's'}` : 'Sin filtros de negocio');
  setText('heroContext', filterSummary.length ? filterSummary.slice(0, 2).join(' · ') : content.context);
  setText('heroToggleFilters', filtersCollapsed ? 'Mostrar filtros' : 'Ocultar filtros');
  setText('mobileFiltersBtn', filterCount ? `Filtros (${filterCount})` : 'Filtros');
  setText('mobileSummaryBtn', activeTab === TAB_PROY ? 'Proyección' : activeTab === TAB_ACUM ? 'Acumulados' : activeTab === TAB_GRAF ? 'Gráficos' : 'Resumen');

  document.querySelectorAll('.pbtn[data-p]').forEach(button => {
    const title = PERIOD_BUTTON_TITLES[button.dataset.p];
    if (!title) return;
    button.title = title;
    button.setAttribute('aria-label', title);
  });

  document.title = `${content.title}${filterLabel}${periodShort ? ` · ${periodShort}` : ''} — DASH`;
}

function isMobileSheet() {
  return typeof window !== "undefined" && window.innerWidth < 600;
}

function closeMobileSheet() {
  el('filterPanel')?.classList.remove('sheet-open');
  const bd = el('filterBackdrop');
  if (bd) { bd.classList.remove('visible'); bd.setAttribute('aria-hidden', 'true'); }
}

function openMobileSheet() {
  const panel = el('filterPanel');
  panel?.classList.add('sheet-open');
  const bd = el('filterBackdrop');
  if (bd) { bd.classList.add('visible'); bd.setAttribute('aria-hidden', 'false'); }
  panel?.querySelector('button, input, select')?.focus();
}

function toggleFiltersPanelAndFocus(forceOpen = false) {
  if (isMobileSheet()) {
    const isOpen = el('filterPanel')?.classList.contains('sheet-open');
    if (forceOpen || !isOpen) openMobileSheet();
    else closeMobileSheet();
    return;
  }
  const panel = el('filterPanel');
  if (forceOpen) {
    setFiltersCollapsed(false);
  } else {
    setFiltersCollapsed(!filtersCollapsed);
  }
  updateUxChrome();
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToActivePageStart() {
  const target = document.getElementById(`page-${activeTab}`) || document.querySelector('.page.on');
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildStoryCard({ tone = 'accent', label = 'Sin datos', title = '—', value = '—', meta = '', share = null, foot = '' } = {}) {
  const safeShare = Number.isFinite(Number(share)) ? Math.max(0, Math.min(Number(share), 100)) : null;
  return `<article class="story-card ${tone}">
    <div class="story-label">${escHtml(label)}</div>
    <div class="story-title">${escHtml(title)}</div>
    <div class="story-value">${escHtml(String(value))}</div>
    <div class="story-meta">${escHtml(meta)}</div>
    <div class="story-progress">
      <div class="story-progress-line"><div class="story-progress-bar" style="width:${safeShare == null ? 18 : safeShare.toFixed(1)}%"></div></div>
      <div class="story-foot"><span>${safeShare == null ? 'Sin participación calculable' : `${safeShare.toFixed(1)}% del total`}</span><span>${escHtml(foot)}</span></div>
    </div>
  </article>`;
}

function renderStoryDeck(containerId, cards = []) {
  const container = el(containerId);
  if (!container) return;
  container.innerHTML = cards.join('');
}

function renderAccumulatedStories() {
  const total = Number(dashboardState?.kpis?.kilos || 0);
  const topCoord = dashboardState?.rankings?.coordinadores?.[0];
  const topGroup = dashboardState?.rankings?.grupos?.[0];
  const topBrand = dashboardState?.rankings?.marcas?.[0];
  const topClient = dashboardState?.rankings?.clientes?.[0];
  const cards = [
    buildStoryCard({
      tone: 'accent',
      label: 'Coordinador líder',
      title: topCoord?.name || 'Sin datos',
      value: topCoord ? fmt(topCoord.kilos) : '—',
      meta: topCoord ? 'Mayor volumen dentro del alcance filtrado.' : 'Ajustá filtros para descubrir el principal responsable.',
      share: total > 0 && topCoord ? (Number(topCoord.kilos || 0) / total) * 100 : null,
      foot: 'Ranking actual'
    }),
    buildStoryCard({
      tone: 'blu',
      label: 'Grupo dominante',
      title: topGroup?.name || 'Sin datos',
      value: topGroup ? fmt(topGroup.kilos) : '—',
      meta: topGroup ? 'Concentra el mayor peso del mix seleccionado.' : 'Sin participación disponible todavía.',
      share: total > 0 && topGroup ? (Number(topGroup.kilos || 0) / total) * 100 : null,
      foot: 'Mix del período'
    }),
    buildStoryCard({
      tone: 'grn',
      label: 'Marca más fuerte',
      title: topBrand?.name || 'Sin datos',
      value: topBrand ? fmt(topBrand.kilos) : '—',
      meta: topBrand ? 'Referencia rápida para lectura de portfolio.' : 'Esperando datos para mostrar liderazgo por marca.',
      share: total > 0 && topBrand ? (Number(topBrand.kilos || 0) / total) * 100 : null,
      foot: 'Cobertura actual'
    }),
    buildStoryCard({
      tone: 'pur',
      label: 'Cliente principal',
      title: topClient?.nombre || 'Sin datos',
      value: topClient ? fmt(topClient.kilos) : '—',
      meta: topClient ? `${topClient.coordinador || 'Sin coord.'} · ${topClient.agente || 'Sin agente'}` : 'Sin top cliente disponible todavía.',
      share: total > 0 && topClient ? (Number(topClient.kilos || 0) / total) * 100 : null,
      foot: 'Top 20 clientes'
    })
  ];
  renderStoryDeck('acumStoryGrid', cards);
}

function renderGraphStories() {
  const total = Number(dashboardState?.kpis?.kilos || 0);
  const topGroup = dashboardState?.rankings?.grupos?.[0];
  const topAgent = dashboardState?.rankings?.agentes?.[0];
  const topClient = dashboardState?.rankings?.clientes?.[0];
  const line = dashboardState?.charts?.lineMensual || [];
  const latestPoint = line.length ? line[line.length - 1] : null;
  const latestLabel = latestPoint?.mes || latestPoint?.label || 'Sin datos';
  const latestValue = latestPoint ? fmt(latestPoint.kilos || latestPoint.value || 0) : '—';
  const cards = [
    buildStoryCard({
      tone: 'tea',
      label: 'Foco visual',
      title: topGroup?.name || 'Sin grupo líder',
      value: topGroup ? fmt(topGroup.kilos) : '—',
      meta: topGroup ? 'Es el primer bloque para revisar cuando el mix cambia.' : 'Sin ranking disponible aún.',
      share: total > 0 && topGroup ? (Number(topGroup.kilos || 0) / total) * 100 : null,
      foot: 'Grupo con mayor peso'
    }),
    buildStoryCard({
      tone: 'blu',
      label: 'Agente destacado',
      title: topAgent?.name || 'Sin agente líder',
      value: topAgent ? fmt(topAgent.kilos) : '—',
      meta: topAgent ? 'Útil para una lectura ejecutiva antes de bajar al detalle.' : 'Esperando datos para resaltar desempeño comercial.',
      share: total > 0 && topAgent ? (Number(topAgent.kilos || 0) / total) * 100 : null,
      foot: 'Top 10 agentes'
    }),
    buildStoryCard({
      tone: 'grn',
      label: 'Cliente referencia',
      title: topClient?.nombre || 'Sin cliente líder',
      value: topClient ? fmt(topClient.kilos) : '—',
      meta: topClient ? `${topClient.coordinador || 'Sin coord.'} · ${topClient.agente || 'Sin agente'}` : 'Sin cliente destacado todavía.',
      share: total > 0 && topClient ? (Number(topClient.kilos || 0) / total) * 100 : null,
      foot: 'Participación en cartera'
    }),
    buildStoryCard({
      tone: 'pur',
      label: 'Ritmo mensual',
      title: latestLabel,
      value: latestValue,
      meta: latestPoint ? 'Último punto disponible de la serie temporal cargada.' : 'Sin serie mensual para mostrar evolución.',
      share: line.length > 1 ? Math.min(100, (line.length / 12) * 100) : null,
      foot: `${line.length || 0} puntos en la serie`
    })
  ];
  renderStoryDeck('graphStoryGrid', cards);
}

function ensureDesktopScrollTopButton() {
  let button = el(SCROLL_TOP_BTN_ID);
  if (button) return button;

  button = document.createElement('button');
  button.type = 'button';
  button.id = SCROLL_TOP_BTN_ID;
  button.className = 'ux-scroll-top';
  button.title = 'Volver arriba';
  button.setAttribute('aria-label', 'Volver arriba');
  button.textContent = '↑';
  button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(button);
  return button;
}

function syncDesktopScrollTopButton() {
  const button = ensureDesktopScrollTopButton();
  const desktopViewport = window.matchMedia('(min-width: 861px)').matches;
  button.classList.toggle('visible', desktopViewport && window.scrollY > 320);
}

function bindGlobalKeyboardShortcuts() {
  if (keyboardShortcutsBound) return;
  keyboardShortcutsBound = true;
  document.addEventListener('keydown', event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const map = { '1': TAB_DETALLE, '2': TAB_PROY, '3': TAB_ACUM, '4': TAB_GRAF };
    const tabName = map[event.key];
    if (!tabName) return;
    event.preventDefault();
    tabsController?.activate(tabName, { emit: true, focus: true });
  });
}

function setupUxChromeListeners() {
  el('heroToggleFilters')?.addEventListener('click', () => toggleFiltersPanelAndFocus(false));
  el('mobileFiltersBtn')?.addEventListener('click', () => toggleFiltersPanelAndFocus(true));
  el('mobileSummaryBtn')?.addEventListener('click', () => scrollToActivePageStart());
  el('mobileTopBtn')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  el('btnToggleFilters')?.addEventListener('click', () => {
    if (isMobileSheet()) { closeMobileSheet(); return; }
    window.requestAnimationFrame(updateUxChrome);
  });
  el('filterBackdrop')?.addEventListener('click', () => closeMobileSheet());

  ensureDesktopScrollTopButton();
  if (!scrollTopButtonListenersBound) {
    window.addEventListener('scroll', syncDesktopScrollTopButton, { passive: true });
    window.addEventListener('resize', syncDesktopScrollTopButton, { passive: true });
    scrollTopButtonListenersBound = true;
  }
  syncDesktopScrollTopButton();
}

// ── KPIs y strip ──────────────────────────────────────────────────────────────
function findSelectedAgent() {
  const codigo = String(filtros.agente || '').trim();
  if (!codigo) return null;

  const agentes = dashboardState?.options?.agentes || [];
  const fromOptions = agentes.find(x => String(x?.codigo || '').trim() === codigo);
  if (fromOptions) {
    return {
      codigo,
      nombre: String(fromOptions.nombre || codigo).trim() || codigo
    };
  }

  const option = document.querySelector(`#sAgte option[value="${CSS.escape(codigo)}"]`);
  const rawLabel = String(option?.textContent || '').trim();
  const nombre = rawLabel.replace(/\s+[—-]\s*C[oó]d:\s*.*$/i, '').trim() || codigo;
  return { codigo, nombre };
}

function fitTextToWidth(node, { max = 18, min = 10, step = 0.5 } = {}) {
  if (!node) return;

  const parent = node.parentElement;
  if (!parent) return;

  const available = Math.max(parent.clientWidth - 2, 0);
  if (!available) return;

  let size = max;
  node.style.fontSize = `${size}px`;
  node.style.whiteSpace = 'nowrap';
  node.style.overflow = 'visible';
  node.style.textOverflow = 'clip';
  node.style.letterSpacing = '';

  while (size > min && node.scrollWidth > available) {
    size = Math.max(size - step, min);
    node.style.fontSize = `${size}px`;
  }

  if (node.scrollWidth > available) {
    node.style.letterSpacing = '-0.02em';
  }
}

function renderAgentKpiValue(targetId, kpis) {
  const target = el(targetId);
  if (!target) return;

  const selected = findSelectedAgent();
  if (!selected) {
    target.textContent = fmt(kpis.agentes);
    target.title = '';
    return;
  }

  const nombre = escHtml(selected.nombre);
  const codigo = escHtml(selected.codigo);
  const fitId = `ag-name-${targetId}`;
  target.title = `${selected.nombre} — Cód: ${selected.codigo}`;
  target.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:2px;line-height:1.05;min-width:0;width:100%">
      <span id="${fitId}" style="font-size:18px;font-weight:800;white-space:nowrap;min-width:0">${nombre}</span>
      <span style="font-size:11px;color:var(--mut);font-family:'DM Sans',sans-serif;font-weight:600">Cód: ${codigo}</span>
    </div>`;

  requestAnimationFrame(() => fitTextToWidth(el(fitId), { max: 18, min: 9, step: 0.5 }));
}

function setKPIsLoading(on) {
  ["a", "b", "g", "p"].forEach(cls => {
    document.querySelector(`#page-detalle .kpi.${cls}`)?.classList.toggle("kpi--loading", Boolean(on));
  });
}

// ── Contador numérico animado para KPIs ────────────────────────────────────
// Anima el valor desde el número actual hasta el target en ~700ms.
// Si el elemento no existe o el valor no cambió, no hace nada.
function countUp(id, target, duration = 700) {
  const el = document.getElementById(id);
  if (!el) return;
  const raw = String(el.textContent || "").replace(/\./g, "").replace(/,/g, "");
  const from = parseInt(raw, 10) || 0;
  const to = Number(target) || 0;
  if (from === to) { el.textContent = fmt(to); return; }
  const startTime = performance.now();
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const current = Math.round(from + (to - from) * easeOut(progress));
    el.textContent = fmt(current);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = fmt(to);
  }
  requestAnimationFrame(step);
}

function setKPIBlock(kpis, prefix = "") {
  if (!prefix) setKPIsLoading(false);
  // Usar countUp para los valores numéricos del bloque principal (sin prefix)
  if (!prefix) {
    countUp("kK", kpis.kilos);
    countUp("kC", kpis.clientes);
    countUp("kR", kpis.registros);
    renderAgentKpiValue(prefix + "kA", kpis);
  } else {
    setText(prefix + "kK", fmt(kpis.kilos));
    setText(prefix + "kC", fmt(kpis.clientes));
    renderAgentKpiValue(prefix + "kA", kpis);
    setText(prefix + "kR", fmt(kpis.registros));
  }
}

function renderDetailGroupHint() {
  const hint = el("detailGroupHint");
  const clearBtn = el("btnDetailClearGroup");
  const badge = el("detailGroupBadge");
  const selected = getDetailQuickGroups();
  if (clearBtn) clearBtn.disabled = !selected.length;
  if (badge) badge.textContent = selected.length ? `${selected.length} grupo${selected.length === 1 ? "" : "s"} activo${selected.length === 1 ? "" : "s"}` : "Sin filtro rápido";
  if (!hint) return;
  if (!selected.length) {
    hint.textContent = "Usá estas tarjetas como filtro rápido para centrar el resumen en uno o varios grupos sin bajar al selector principal.";
    return;
  }
  hint.textContent = `Filtro rápido activo en detalle para: ${selected.join(", ")}. Podés combinar varios grupos y volver a hacer click sobre una tarjeta para quitarla.`;
}

function bindMiddleButtonHorizontalPan(container) {
  if (!container || container.dataset.middlePanBound === "1") return;
  container.dataset.middlePanBound = "1";

  // v42: ← → keyboard scroll when the strip (or a child) has focus
  container.setAttribute("tabindex", container.getAttribute("tabindex") ?? "-1");
  container.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // Only scroll if no modifier keys — don't interfere with Alt+number tab shortcuts
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 200 : -200;
    container.scrollBy({ left: delta, behavior: "smooth" });
  });

  let dragState = null;

  const finishDrag = () => {
    if (!dragState) return;
    dragState = null;
    container.classList.remove("is-middle-dragging");
    document.body?.classList.remove("cursor-middle-dragging");
  };

  const handleMove = event => {
    if (!dragState) return;
    event.preventDefault();
    const deltaX = Number(event.clientX || 0) - dragState.startX;
    container.scrollLeft = dragState.startScrollLeft - deltaX;
  };

  const handleMouseDown = event => {
    if (event.button !== 1) return;
    if (!container.contains(event.target)) return;
    event.preventDefault();
    dragState = {
      startX: Number(event.clientX || 0),
      startScrollLeft: container.scrollLeft
    };
    container.classList.add("is-middle-dragging");
    document.body?.classList.add("cursor-middle-dragging");
  };

  container.addEventListener("mousedown", handleMouseDown);
  container.addEventListener("auxclick", event => {
    if (event.button === 1) event.preventDefault();
  });
  window.addEventListener("mousemove", handleMove, { passive: false });
  window.addEventListener("mouseup", finishDrag);
  window.addEventListener("blur", finishDrag);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") finishDrag();
  });
}

function toggleDetailGroup(groupName) {
  toggleDetailQuickGroupSelection(groupName);
}

function renderGrupoStrip(entries) {
  const cont = el("grupoStrip"); if (!cont) return;
  bindMiddleButtonHorizontalPan(cont);
  pruneDetailQuickGroups(entries);
  const selected = new Set(getDetailQuickGroups());
  const total = (entries || []).reduce((a, x) => a + Number(x.kilos || 0), 0) || 1;
  const maxK = Number(entries?.[0]?.kilos || 0) || 1;

  renderDetailGroupHint();

  if (!entries || !entries.length) {
    cont.innerHTML = `<div class="gk"><div class="gk-name" style="color:var(--mut)">Sin datos</div><div class="gk-val">—</div></div>`;
    return;
  }

  cont.innerHTML = entries.map((x, i) => {
    const col = PAL[i % PAL.length];
    const kg = Number(x.kilos || 0);
    const pct = ((kg / total) * 100).toFixed(1);
    const bw = ((kg / maxK) * 100).toFixed(1);
    const name = String(x.name || "");
    const active = selected.has(name);
    return `<button type="button" class="gk clickable${active ? ' active' : ''}" data-detail-group="${escHtml(name)}" aria-pressed="${active ? 'true' : 'false'}" title="${active ? 'Quitar filtro rápido de ' : 'Sumar filtro rápido por '}${escHtml(name)}" style="border-color:${active ? `${col}88` : `${col}22`};background:${active ? `${col}14` : `${col}08`}">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${col}"></div>
      <div class="gk-name" style="color:${col}aa">${escHtml(name)}</div>
      <div class="gk-val" style="color:${col}">${fmtK(kg)}</div>
      <div class="gk-pct" style="color:${col}88">${pct}%</div>
      <div class="gk-bar" style="width:${bw}%;background:${col}"></div>
    </button>`;
  }).join("");

  cont.querySelectorAll("[data-detail-group]").forEach(node => {
    node.addEventListener("click", () => toggleDetailGroup(node.getAttribute("data-detail-group")));
  });
}

function patchDetailExplorer(patch = {}) {
  const meaningfulChange = hasMeaningfulDetailExplorerChange(patch);
  const nextColumnFilters = Object.prototype.hasOwnProperty.call(patch, "columnFilters")
    ? Object.fromEntries(Object.entries(patch.columnFilters || {}).map(([key, values]) => [
        String(key || ""),
        Array.isArray(values) ? [...new Set(values.map(value => String(value ?? "")).filter(value => value !== ""))] : []
      ]).filter(([key, values]) => key && values.length))
    : detailExplorerState.columnFilters;

  const nextState = createDetailExplorerState({
    ...detailExplorerState,
    ...patch,
    columnFilters: nextColumnFilters,
    currentPreset: Object.prototype.hasOwnProperty.call(patch, "currentPreset")
      ? String(patch.currentPreset || "custom")
      : (meaningfulChange ? "custom" : detailExplorerState.currentPreset),
    favoriteId: Object.prototype.hasOwnProperty.call(patch, "favoriteId")
      ? String(patch.favoriteId || "")
      : (meaningfulChange ? "" : detailExplorerState.favoriteId)
  });

  detailExplorerState = nextState;
  persistDetailExplorerState(detailExplorerState);

  const openColumnKey = String(detailExplorerState.openColumnMenu || "").trim();
  const explicitMenuToggle = Object.prototype.hasOwnProperty.call(patch, "openColumnMenu");
  const menuClosedExplicitly = explicitMenuToggle && !openColumnKey;
  const columnFiltersChanged = Object.prototype.hasOwnProperty.call(patch, "columnFilters");
  const viewChanged = Object.prototype.hasOwnProperty.call(patch, "view");
  const shouldRefreshOpenColumn = Boolean(openColumnKey) && (
    explicitMenuToggle ||
    columnFiltersChanged ||
    viewChanged
  );

  const shouldHydrateFilteredContext = hasActiveDetailColumnFilters(detailExplorerState)
    && detailExplorerState.view !== "detalle"
    && (columnFiltersChanged || !isDetailContextFullyHydrated());
  const needsBackendReload = shouldShowDetailSummaryTable() && (
    columnFiltersChanged
    || (viewChanged && hasActiveDetailColumnFilters(detailExplorerState) && !isDetailContextFullyHydrated())
  );

  if (detailExplorerState.view === "detalle") {
    const scopeKey = detailOptionsScopeKey();
    const shouldResetOptionCache = detailColumnOptionsState.scopeKey !== scopeKey
      || columnFiltersChanged
      || viewChanged;
    if (shouldResetOptionCache) {
      detailColumnOptionsState = {
        scopeKey,
        byColumn: {},
        loadingKey: detailColumnOptionsState.loadingKey,
        seq: detailColumnOptionsState.seq + 1
      };
    }
    if (menuClosedExplicitly) {
      detailColumnOptionsState = {
        ...detailColumnOptionsState,
        loadingKey: "",
        seq: detailColumnOptionsState.seq + 1
      };
    }
    if (shouldRefreshOpenColumn) {
      const hasCachedOptions = Array.isArray(detailColumnOptionsState.byColumn?.[openColumnKey])
        && detailColumnOptionsState.byColumn[openColumnKey].length > 0;
      detailColumnOptionsState = {
        ...detailColumnOptionsState,
        loadingKey: openColumnKey,
        seq: detailColumnOptionsState.seq + 1
      };
      void ensureDetailColumnOptions(openColumnKey, { force: shouldResetOptionCache || !hasCachedOptions });
    }
  } else if (viewChanged) {
    detailColumnOptionsState = { ...detailColumnOptionsState, loadingKey: "", seq: detailColumnOptionsState.seq + 1 };
  }

  if (needsBackendReload) {
    void reloadDetailSummaryFromBackend({ hydrateAll: shouldHydrateFilteredContext });
    return;
  }

  renderTable();
}

function resetDetailExplorer() {
  detailExplorerState = createDetailExplorerState();
  persistDetailExplorerState(detailExplorerState);
}

function saveCurrentDetailFavorite() {
  const currentFavorite = detailFavorites.find(item => item.id === detailExplorerState.favoriteId);
  const suggested = currentFavorite?.name || "";
  const name = String(window.prompt("Nombre para esta vista del resumen:", suggested) || "").trim();
  if (!name) return;

  const id = currentFavorite?.id || `detail-${Date.now().toString(36)}`;
  const snapshot = createDetailExplorerState({
    ...detailExplorerState,
    favoriteId: id,
    openColumnMenu: "",
    showAdvanced: false
  });

  detailFavorites = [
    { id, name, updatedAt: Date.now(), snapshot },
    ...detailFavorites.filter(item => item.id !== id)
  ].slice(0, DETAIL_FAVORITES_LIMIT);
  persistDetailFavorites(detailFavorites);
  detailExplorerState = createDetailExplorerState({ ...detailExplorerState, favoriteId: id });
  persistDetailExplorerState(detailExplorerState);
  renderTable();
}

function applyDetailFavorite(favoriteId = "") {
  const favorite = detailFavorites.find(item => item.id === favoriteId);
  if (!favorite) return;
  detailExplorerState = createDetailExplorerState({
    ...favorite.snapshot,
    favoriteId: favorite.id,
    openColumnMenu: ""
  });
  persistDetailExplorerState(detailExplorerState);
  renderTable();
}

function deleteDetailFavorite(favoriteId = "") {
  if (!favoriteId) return;
  detailFavorites = detailFavorites.filter(item => item.id !== favoriteId);
  persistDetailFavorites(detailFavorites);
  if (detailExplorerState.favoriteId === favoriteId) {
    detailExplorerState = createDetailExplorerState({ ...detailExplorerState, favoriteId: "" });
  }
  persistDetailExplorerState(detailExplorerState);
  renderTable();
}

function applyDetailDrilldown(drill = {}) {
  const key = String(drill?.key || "");
  const value = String(drill?.value || "").trim();
  if (!key || !value) return;
  const nextColumnFilters = { ...(detailExplorerState.columnFilters || {}) };
  nextColumnFilters[key] = [value];
  patchDetailExplorer({
    view: "detalle",
    metric: "Fecha",
    columnFilters: nextColumnFilters,
    openColumnMenu: "",
    currentPreset: "custom",
    favoriteId: ""
  });
}

function patchProjectionExplorer(patch = {}) {
  projectionExplorerState = patchExplorerState(projectionExplorerState, patch, { view: "cliente", sort: "KilosProyectados", direction: "desc", metric: "KilosProyectados", topN: "50", groupOthers: true });
  if (activeTab === TAB_PROY) renderProjectionTable();
}

function resetProjectionExplorer() {
  projectionExplorerState = createExplorerState({ view: "cliente", sort: "KilosProyectados", direction: "desc", metric: "KilosProyectados", topN: "50", groupOthers: true });
}

function patchAccumExplorer(patch = {}) {
  accumExplorerState = patchExplorerState(accumExplorerState, patch, { view: "coordinadores", sort: "Kilos", direction: "desc", metric: "Kilos", topN: "50", groupOthers: true });
  if (activeTab === TAB_ACUM) renderAcumuladosFromState();
}

function resetAccumExplorer() {
  accumExplorerState = createExplorerState({ view: "coordinadores", sort: "Kilos", direction: "desc", metric: "Kilos", topN: "50", groupOthers: true });
}

// ── Detalle paginado server-side ──────────────────────────────────────────────
function renderTable() {
  detailController.render();
}

async function fetchStatePayload(qs, signal) {
  return dataService.fetchStatePayload(qs, signal);
}

async function ensureProjectionCompareLoaded(force = false) {
  return projectionController.ensureCompareLoaded(force);
}

async function ensureProjectionDetailLoaded(force = false) {
  return projectionController.ensureDetailLoaded(force);
}

async function loadMoreProjectionDetail(limit = DETAIL_PAGE) {
  const loaded = await projectionController.loadMoreDetail(limit);
  if (activeTab === TAB_PROY) renderProjectionTable();
  return loaded;
}

async function loadAllProjectionDetail() {
  const loaded = await projectionController.loadAllDetail();
  if (activeTab === TAB_PROY) renderProjectionTable();
  return loaded;
}

function parseExplorerTopN(value, fallback = 50) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Math.floor(Number(fallback) || 50));
  return Math.max(1, Math.floor(parsed));
}

async function ensureDetailRowsLoaded(targetRows = 0, chunkSize = DETAIL_PAGE) {
  let state = detailController.getState?.() || {};
  const safeTarget = Math.max(0, Math.floor(Number(targetRows) || 0));
  const safeChunk = Math.max(1, Math.floor(Number(chunkSize) || DETAIL_PAGE));
  while (state.hasMore && Array.isArray(state.rows) && state.rows.length < safeTarget) {
    const missing = Math.max(safeTarget - state.rows.length, 0);
    const requestLimit = Math.max(safeChunk, missing);
    const loaded = await detailController.loadMore(requestLimit);
    if (!loaded) break;
    await yieldToUI();
    state = detailController.getState?.() || {};
  }
  return detailController.getState?.() || state;
}

async function revealMoreDetailRows(step = DETAIL_PAGE) {
  const increment = Math.max(1, Math.floor(Number(step) || DETAIL_PAGE));
  const currentTopN = parseExplorerTopN(detailExplorerState.topN, increment);
  if (currentTopN !== null) {
    patchDetailExplorer({ topN: String(currentTopN + increment), currentPreset: "custom", favoriteId: "" });
    await ensureDetailRowsLoaded(currentTopN + increment, increment);
  } else {
    await detailController.loadMore(increment);
  }
  if (activeTab !== TAB_PROY) renderTable();
  return true;
}

async function revealAllDetailRows() {
  patchDetailExplorer({ topN: "all", currentPreset: "custom", favoriteId: "" });
  const state = detailController.getState?.() || {};
  if (state.hasMore) {
    await detailController.loadAll();
  }
  if (activeTab !== TAB_PROY) renderTable();
  return true;
}

async function ensureProjectionRowsLoaded(targetRows = 0, chunkSize = PROJECTION_DETAIL_PAGE) {
  let state = projectionController.getDetailState?.() || {};
  const safeTarget = Math.max(0, Math.floor(Number(targetRows) || 0));
  const safeChunk = Math.max(1, Math.floor(Number(chunkSize) || PROJECTION_DETAIL_PAGE));
  while (state.hasMore && Array.isArray(state.rows) && state.rows.length < safeTarget) {
    const missing = Math.max(safeTarget - state.rows.length, 0);
    const requestLimit = Math.max(safeChunk, missing);
    const loaded = await loadMoreProjectionDetail(requestLimit);
    if (!loaded) break;
    await yieldToUI();
    state = projectionController.getDetailState?.() || {};
  }
  return projectionController.getDetailState?.() || state;
}

async function revealMoreProjectionRows(step = PROJECTION_DETAIL_PAGE) {
  const increment = Math.max(1, Math.floor(Number(step) || PROJECTION_DETAIL_PAGE));
  const currentTopN = parseExplorerTopN(projectionExplorerState.topN, increment);
  if (currentTopN !== null) {
    patchProjectionExplorer({ topN: String(currentTopN + increment), currentPreset: "custom", favoriteId: "" });
    await ensureProjectionRowsLoaded(currentTopN + increment, increment);
  } else {
    await loadMoreProjectionDetail(increment);
  }
  if (activeTab === TAB_PROY) renderProjectionTable();
  return true;
}

async function revealAllProjectionRows() {
  patchProjectionExplorer({ topN: "all", currentPreset: "custom", favoriteId: "" });
  const state = projectionController.getDetailState?.() || {};
  if (state.hasMore) {
    await loadAllProjectionDetail();
  }
  if (activeTab === TAB_PROY) renderProjectionTable();
  return true;
}

async function ensureInsightsLoaded(force = false) {
  return insightsController.ensureLoaded(activeStateKey ?? "", force);
}

function getProjectionComparison(meta = getProjectionMeta()) {
  const comparison = projectionController.getComparison(meta);
  const baseKilos = Number(comparison.baseKilos || 0);
  let deltaPct = comparison.deltaPct;
  let deltaPctLabel = comparison.deltaPctLabel;

  if (baseKilos > 0) {
    deltaPctLabel = fmtSignedPct(deltaPct);
  } else if (comparison.projectedKilos > 0) {
    deltaPctLabel = "Nuevo";
  } else {
    deltaPct = 0;
    deltaPctLabel = "0,0%";
  }

  return {
    ...comparison,
    deltaPct,
    deltaPctLabel,
    trend: comparison.deltaKg > 0 ? "positive" : comparison.deltaKg < 0 ? "negative" : "neutral"
  };
}

function setTrendCardState(id, trend = "neutral") {
  const card = el(id);
  if (!card) return;
  card.classList.remove("positive", "negative", "neutral");
  card.classList.add(trend || "neutral");
}

function renderProjectionCompareKpis(meta = getProjectionMeta()) {
  const projectionCompareState = projectionController.getCompareState();
  const context = getProjectionCompareContext();
  const comparison = getProjectionComparison(meta);
  const latestDate = projectionCompareState.latestDate || "";
  const latestLabel = latestDate ? formatProjectionDateLabel(latestDate, { parseIsoDateParts, monthNameEs }) : "Última fecha con ventas";
  const compareLabel = projectionCompareState.compareLabel || context.compareLabel || "";
  const currentLabel = projectionCompareState.currentLabel || context.currentLabel || "—";
  const compareMode = projectionCompareState.compareMode || context.mode || "month";
  const baseTitle = compareLabel
    ? `${compareMode === "range" ? "Acumulado" : "Cierre"} ${compareLabel}`
    : (compareMode === "range" ? "Acumulado 2025" : "Cierre mes 2025");
  const baseSubReady = compareLabel
    ? `${compareMode === "range" ? "Total acumulado" : "Mes cerrado"} ${compareLabel}`
    : (compareMode === "range" ? "Total acumulado 2025" : "Mes cerrado 2025");
  const baseSubLoading = compareMode === "range" ? "Buscando acumulado 2025" : "Buscando cierre 2025";

  setText("pcBaseLbl", baseTitle);
  setText("pcMonth", currentLabel);
  setText("pcMonthSub", compareLabel ? `Comparando contra ${compareLabel}` : "Referencia histórica");
  setText("pcCompareBadge", compareLabel ? `Contra ${compareLabel}` : "Sin base 2025");
  setText("pcDeltaKgSub", compareLabel ? `vs ${compareLabel}` : "vs 2025");
  setText("pcDeltaPctSub", compareLabel ? `vs ${compareLabel}` : "vs 2025");
  setText("pcLatestLbl", latestLabel);
  setText("pkKSub", meta.ok ? `Total proyectado para ${currentLabel || "el período"}` : "Total proyectado del período");

  const currentKpis = getProjectionCurrentKpis();
  if (meta.ok && projectionCompareState.loading && hasProjectionGroupSelection() && !projectionCompareState.loaded) {
    setText("pkK", "...");
  } else if (meta.ok) {
    setText("pkK", fmt(projectValue(currentKpis.kilos || 0, meta)));
  } else {
    setText("pkK", "—");
  }

  if (projectionCompareState.loading && !projectionCompareState.loaded) {
    setText("pcBase", "...");
    setText("pcBaseSub", baseSubLoading);
    setText("pcLatest", "...");
    setText("pcLatestSub", "Buscando último día disponible");
  } else if (projectionCompareState.available) {
    setText("pcBase", fmt(projectionCompareState.kilos));
    setText("pcBaseSub", baseSubReady);
    setText("pcLatest", latestDate ? fmt(projectionCompareState.latestKilos) : "—");
    setText("pcLatestSub", latestDate ? "Kilos vendidos en la última fecha disponible" : "Sin ventas en el período filtrado");
  } else {
    setText("pcBase", "—");
    setText("pcBaseSub", projectionCompareState.message || context.message || "Sin base histórica");
    setText("pcLatest", latestDate ? fmt(projectionCompareState.latestKilos) : "—");
    setText("pcLatestSub", latestDate ? "Kilos vendidos en la última fecha disponible" : "Sin ventas en el período filtrado");
  }

  if (comparison.ready) {
    setText("pcDeltaKg", fmtSigned(comparison.deltaKg));
    setText("pcDeltaPct", comparison.deltaPctLabel);
    setTrendCardState("pcDeltaKgCard", comparison.trend);
    setTrendCardState("pcDeltaPctCard", comparison.trend);
    return;
  }

  setText("pcDeltaKg", "—");
  setText("pcDeltaPct", "—");
  setTrendCardState("pcDeltaKgCard", "neutral");
  setTrendCardState("pcDeltaPctCard", "neutral");
}

function updateProjectionSummary(meta) {
  const projectionCompareState = projectionController.getCompareState();
  const note = el("projNote");
  const badge = el("projBadge");
  const currentKpis = getProjectionCurrentKpis();
  const baseKilos = Number(currentKpis?.kilos || 0);
  const comparison = getProjectionComparison(meta);
  const latestDate = projectionCompareState.latestDate ? formatProjectionDateLabel(projectionCompareState.latestDate, { parseIsoDateParts, monthNameEs }) : "sin ventas cargadas";
  const latestKilos = projectionCompareState.latestDate ? fmt(projectionCompareState.latestKilos) : "0";
  const compareLabel = projectionCompareState.compareLabel || getProjectionCompareContext().compareLabel || "";
  const compareMode = projectionCompareState.compareMode || getProjectionCompareContext().mode || "month";
  const compareFallback = compareMode === "range" ? "el acumulado 2025" : "2025";

  if (badge) badge.textContent = meta.ok ? `${meta.transcurridos}/${meta.habiles} días · ${meta.porcentaje.toFixed(1)}%` : "Pendiente";
  if (!note) return;

  if (!meta.ok) {
    note.className = "proj-note err";
    note.textContent = meta.message;
    return;
  }

  if (comparison.ready) {
    note.className = `proj-note ${comparison.trend === "positive" ? "pos" : comparison.trend === "negative" ? "neg" : "neutral"}`;
    note.innerHTML = `${comparison.currentLabel}: <strong>${fmt(comparison.projectedKilos)}</strong> proyectados · ${comparison.compareLabel}: <strong>${fmt(comparison.baseKilos)}</strong> · Variación: <strong>${fmtSigned(comparison.deltaKg)}</strong> (<strong>${comparison.deltaPctLabel}</strong>) · Última venta cargada: <strong>${latestDate}</strong> con <strong>${latestKilos}</strong> kilos`;
    return;
  }

  if (projectionCompareState.loading && !projectionCompareState.loaded) {
    note.className = "proj-note info";
    note.innerHTML = `Coeficiente: <strong>${meta.coef.toFixed(3)}</strong> · Multiplicador: <strong>${meta.multiplier.toFixed(3)}</strong> · Kilos actuales: <strong>${fmt(baseKilos)}</strong> · Kilos proyectados: <strong>${fmt(projectValue(baseKilos, meta))}</strong> · Comparando con <strong>${compareLabel || compareFallback}</strong>...`;
    return;
  }

  note.className = "proj-note ok";
  note.innerHTML = `Coeficiente: <strong>${meta.coef.toFixed(3)}</strong> · Multiplicador: <strong>${meta.multiplier.toFixed(3)}</strong> · Kilos actuales: <strong>${fmt(baseKilos)}</strong> · Kilos proyectados: <strong>${fmt(projectValue(baseKilos, meta))}</strong> · Última venta cargada: <strong>${latestDate}</strong> con <strong>${latestKilos}</strong> kilos${projectionCompareState.message ? ` · ${escHtml(projectionCompareState.message)}` : ""}`;
}

function setProjectionKPIBlock(meta) {
  const projectionCompareState = projectionController.getCompareState();
  const sourceKpis = getProjectionCurrentKpis();
  if (projectionCompareState.loading && hasProjectionGroupSelection() && !projectionCompareState.loaded) {
    setText("pkC", "...");
    setText("pkA", "...");
    setText("pkR", "...");
    return;
  }

  if (!meta.ok) {
    setText("pkC", fmt(sourceKpis.clientes));
    renderAgentKpiValue("pkA", sourceKpis);
    setText("pkR", fmt(sourceKpis.registros));
    return;
  }

  setText("pkC", fmt(sourceKpis.clientes));
  renderAgentKpiValue("pkA", sourceKpis);
  setText("pkR", fmt(sourceKpis.registros));
}

function renderProjectionGroupHint() {
  const hint = el("pGroupHint");
  if (!hint) return;
  const selected = getProjectionSelectedGroups();
  if (!selected.length) {
    hint.textContent = "Hacé click en uno o más grupos para filtrar el comparativo y abrir el detalle completo. Volvé a hacer click para regresar al resumen por cliente.";
    return;
  }
  hint.textContent = `Filtro activo en comparativo y detalle para: ${selected.join(", ")}. Hacé click nuevamente sobre un grupo para ocultarlo.`;
}

function renderProjectionStrip(meta) {
  const cont = el("pGrupoStrip");
  if (!cont) return;
  bindMiddleButtonHorizontalPan(cont);
  renderProjectionGroupHint();

  if (!meta.ok) {
    cont.innerHTML = `<div class="gk"><div class="gk-name" style="color:var(--mut)">Proyección pendiente</div><div class="gk-val">—</div></div>`;
    return;
  }

  const entries = projectRankEntries(dashboardState.rankings.grupos || [], meta);
  const total = (entries || []).reduce((acc, item) => acc + Number(item.kilos || 0), 0) || 1;
  const maxK = Number(entries?.[0]?.kilos || 0) || 1;
  const selected = new Set(getProjectionSelectedGroups());

  if (!entries.length) {
    cont.innerHTML = `<div class="gk"><div class="gk-name" style="color:var(--mut)">Sin datos</div><div class="gk-val">—</div></div>`;
    return;
  }

  cont.innerHTML = entries.map((item, i) => {
    const col = PAL[i % PAL.length];
    const kg = Number(item.kilos || 0);
    const pct = ((kg / total) * 100).toFixed(1);
    const bw = ((kg / maxK) * 100).toFixed(1);
    const active = selected.has(String(item.name || ""));
    return `<button type="button" class="gk clickable${active ? ' active' : ''}" data-proj-group="${escHtml(item.name)}" aria-pressed="${active ? 'true' : 'false'}" title="${active ? 'Ocultar detalle de ' : 'Mostrar detalle de '}${escHtml(item.name)}" style="border-color:${active ? `${col}88` : `${col}22`};background:${active ? `${col}14` : `${col}08`}">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${col}"></div>
      <div class="gk-name" style="color:${col}aa">${escHtml(item.name)}</div>
      <div class="gk-val" style="color:${col}">${fmtK(kg)}</div>
      <div class="gk-pct" style="color:${col}88">${pct}%</div>
      <div class="gk-bar" style="width:${bw}%;background:${col}"></div>
    </button>`;
  }).join("");

  cont.querySelectorAll("[data-proj-group]").forEach(node => {
    node.addEventListener("click", () => toggleProjectionDetailGroup(node.getAttribute("data-proj-group")));
  });
}


function renderProjectionHierarchy(meta = getProjectionMeta()) {
  const state = getProjectionHierarchyState();
  const context = getProjectionCompareContext();
  const view = getProjectionHierarchyViewState();
  const presentation = buildProjectionHierarchyPresentation(meta);
  const body = el("projectionHierarchyBody");
  const tools = el("projectionHierarchyTools");
  const note = el("projectionHierarchyNote");
  const compareHead = el("projectionHierarchyHeadCompare");
  const projectedHead = el("projectionHierarchyHeadProjected");

  if (!body) return;

  const compareLabel = state.compareLabel || context.compareLabel || "2025";
  const currentLabel = state.currentLabel || context.currentLabel || "Período actual";
  const projectedLabel = `${currentLabel} Proy.`;
  if (compareHead) compareHead.textContent = compareLabel || "Base 2025";
  if (projectedHead) projectedHead.textContent = projectedLabel;
  if (tools) tools.innerHTML = "";

  if (!meta.ok) {
    setText("projectionHierarchyBadge", "Configurar");
    body.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🧮</div><p>${escHtml(meta.message)}</p></div></td></tr>`;
    if (note) {
      note.style.display = "block";
      note.textContent = "Esta vista replica la jerarquía Coordinador > Agente y usa la misma configuración de proyección del tablero.";
    }
    return;
  }

  if ((state.loading && !state.loaded) || (!state.loaded && !state.groups.length)) {
    setText("projectionHierarchyBadge", "Cargando");
    body.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">⏳</div><p>Cargando proyección por coordinador y agente...</p></div></td></tr>`;
    if (note) {
      note.style.display = "block";
      note.textContent = "Respeta los filtros actuales, la selección de grupos proyectados y la configuración de días hábiles.";
    }
    return;
  }

  const visibleSummary = presentation.summary || {};
  const visibleGroups = presentation.groups || [];
  setText("projectionHierarchyBadge", `${fmt(visibleSummary.coordinadores || 0)} coord. · ${fmt(visibleSummary.agentes || 0)} ag.`);

  if (tools && state.groups.length) {
    const deltaSummary = visibleSummary.delta || projectionDelta(0, 0, { fmtSignedPct });
    tools.innerHTML = `
      <div class="projection-hierarchy-toolbar__summary">
        <span class="projection-hierarchy-chip">${fmt(visibleSummary.coordinadores || 0)} coordinadores</span>
        <span class="projection-hierarchy-chip">${fmt(visibleSummary.agentes || 0)} agentes</span>
        <span class="projection-hierarchy-chip">${projectedLabel}: ${fmt(visibleSummary.kilosProyectados || 0)}</span>
        <span class="projection-hierarchy-chip ${deltaSummary.trend}">Var. total ${fmtSigned(deltaSummary.deltaKg)} · ${deltaSummary.deltaPctLabel}</span>
      </div>
      <div class="projection-hierarchy-toolbar__actions">
        <label class="projection-hierarchy-control">
          <span>Orden</span>
          <select data-proj-hierarchy-sort aria-label="Ordenar proyección jerárquica">
            ${PROJECTION_HIERARCHY_SORT_OPTIONS.map(option => `<option value="${option.value}" ${option.value === view.sort ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
        <label class="projection-hierarchy-control projection-hierarchy-control--toggle">
          <input type="checkbox" data-proj-hierarchy-only-changes ${view.onlyChanges ? "checked" : ""}>
          <span>Solo con variación</span>
        </label>
        <button type="button" class="btn-xs" data-proj-hierarchy-action="expand">Expandir</button>
        <button type="button" class="btn-xs" data-proj-hierarchy-action="collapse">Contraer</button>
        <button type="button" class="btn-xs" data-proj-hierarchy-action="export">Exportar CSV</button>
      </div>
    `;

    const sortSelect = tools.querySelector("[data-proj-hierarchy-sort]");
    if (sortSelect) {
      sortSelect.addEventListener("change", () => patchProjectionHierarchyView({ sort: sortSelect.value }));
    }

    const onlyChangesInput = tools.querySelector("[data-proj-hierarchy-only-changes]");
    if (onlyChangesInput) {
      onlyChangesInput.addEventListener("change", () => patchProjectionHierarchyView({ onlyChanges: onlyChangesInput.checked }));
    }

    tools.querySelectorAll("[data-proj-hierarchy-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-proj-hierarchy-action");
        if (action === "expand" || action === "collapse") {
          setProjectionHierarchyExpanded(action === "expand");
          return;
        }
        if (action === "export") {
          const exported = downloadProjectionHierarchyCsv(presentation, {
            compareLabel,
            projectedLabel
          });
          if (exported) setStatus("CSV jerárquico descargado", "ok");
        }
      });
    });
  }

  if (!state.groups.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🔍</div><p>Sin resultados para los filtros actuales.</p></div></td></tr>`;
    if (note) {
      note.style.display = "block";
      note.textContent = state.message || "Probá ampliando el período o quitando algún filtro para ver la jerarquía completa.";
    }
    return;
  }

  if (!visibleGroups.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="eico">🎯</div><p>No hay coordinadores visibles con la opción actual.</p></div></td></tr>`;
    if (note) {
      note.style.display = "block";
      note.textContent = view.onlyChanges
        ? `La opción “Solo con variación” ocultó ${fmt(presentation.hiddenCount || 0)} coordinadores sin diferencias.`
        : (state.message || "Probá cambiando el orden o revisando los filtros para ver resultados.");
    }
    return;
  }

  const rows = [];
  visibleGroups.forEach((group) => {
    const expanded = projectionHierarchyExpanded.has(String(group.coordinador || ""));
    rows.push(`
      <tr class="proj-hierarchy-row proj-hierarchy-row--group is-${group.trend}">
        <td data-label="Etiquetas de fila">
          <button type="button" class="proj-hierarchy-toggle" data-proj-hier-toggle="${escHtml(group.coordinador)}" aria-expanded="${expanded ? "true" : "false"}">
            <span class="proj-hierarchy-caret">${expanded ? "▾" : "▸"}</span>
            <span class="proj-hierarchy-name-wrap">
              <span class="proj-hierarchy-name">${escHtml(group.coordinador)}</span>
              <span class="proj-hierarchy-group-meta">
                <span class="proj-hierarchy-pill">Subtotal</span>
                <span class="proj-hierarchy-pill proj-hierarchy-pill--subtle">${fmt(group.agentes.length)} agentes</span>
                ${group.agentesPositivos ? `<span class="proj-hierarchy-pill proj-hierarchy-pill--positive">+${fmt(group.agentesPositivos)}</span>` : ""}
                ${group.agentesNegativos ? `<span class="proj-hierarchy-pill proj-hierarchy-pill--negative">−${fmt(group.agentesNegativos)}</span>` : ""}
              </span>
            </span>
          </button>
        </td>
        <td data-label="${escHtml(compareLabel)}" class="num r">${fmt(group.kilos2025)}</td>
        <td data-label="${escHtml(projectedLabel)}" class="num r">${fmt(group.projected)}</td>
        <td data-label="Var. Kg" class="num r"><span class="trend-chip ${group.trend}">${fmtSigned(group.deltaKg)}</span></td>
        <td data-label="Var. %" class="num r"><span class="trend-chip ${group.trend}">${group.deltaPctLabel}</span></td>
      </tr>
    `);

    if (!expanded) return;

    group.agentes.forEach((agent) => {
      const agentLabel = agent.agente || agent.sortLabel || "Sin agente";
      const showSub = agent.agenteNombre && agent.agenteNombre !== agentLabel;
      rows.push(`
        <tr class="proj-hierarchy-row proj-hierarchy-row--agent">
          <td data-label="Etiquetas de fila">
            <div class="proj-hierarchy-agent-cell" title="${escHtml(agent.agenteNombre || agentLabel)}">
              <span class="proj-hierarchy-agent-code">${escHtml(agentLabel)}</span>
              ${showSub ? `<span class="proj-hierarchy-agent-sub">${escHtml(agent.agenteNombre)}</span>` : ""}
            </div>
          </td>
          <td data-label="${escHtml(compareLabel)}" class="num r">${fmt(agent.kilos2025)}</td>
          <td data-label="${escHtml(projectedLabel)}" class="num r">${fmt(agent.projected)}</td>
          <td data-label="Var. Kg" class="num r">${fmtSigned(agent.deltaKg)}</td>
          <td data-label="Var. %" class="num r"><span class="trend-chip ${agent.trend}">${agent.deltaPctLabel}</span></td>
        </tr>
      `);
    });
  });

  rows.push(`
    <tr class="proj-hierarchy-row proj-hierarchy-row--total">
      <td data-label="Etiquetas de fila">Total general</td>
      <td data-label="${escHtml(compareLabel)}" class="num r">${fmt(visibleSummary.kilos2025 || 0)}</td>
      <td data-label="${escHtml(projectedLabel)}" class="num r">${fmt(visibleSummary.kilosProyectados || 0)}</td>
      <td data-label="Var. Kg" class="num r"><span class="trend-chip ${visibleSummary.delta?.trend || 'neutral'}">${fmtSigned(visibleSummary.delta?.deltaKg || 0)}</span></td>
      <td data-label="Var. %" class="num r"><span class="trend-chip ${visibleSummary.delta?.trend || 'neutral'}">${visibleSummary.delta?.deltaPctLabel || '0,0%'}</span></td>
    </tr>
  `);

  body.innerHTML = rows.join("");
  body.querySelectorAll("[data-proj-hier-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleProjectionHierarchyGroup(button.getAttribute("data-proj-hier-toggle")));
  });

  if (note) {
    note.style.display = "block";
    const sourceText = [state.currentSource, state.historicalSource].filter(Boolean).join(" · ");
    const hiddenText = presentation.hiddenCount > 0 ? ` · ocultos ${fmt(presentation.hiddenCount)} sin cambios` : "";
    note.textContent = state.message || `Vista jerárquica Coordinador > Agente. Orden actual: ${presentation.sortLabel}.${hiddenText}${sourceText ? ` Fuentes: ${sourceText}.` : ""}`;
  }
}

async function renderProjectionTable(meta = getProjectionMeta()) {
  const projectionDetailState = projectionController.getDetailState();
  const body = el("ptbody");
  if (!body) return;
  const title = el("pdetailTitle");
  const expanded = projectionTableIsExpanded();
  const colspan = projectionTableColspan(expanded);
  const totalKnown = projectionDetailState.totalKnown !== false;
  const totalLabel = projectionDetailState.total || projectionDetailState.summary?.totalRows || 0;
  const selectedGroups = getProjectionSelectedGroups();

  setProjectionTableHead(expanded);
  if (title) title.textContent = expanded
    ? `Detalle proyectado · ${selectedGroups.join(", ")}`
    : "Detalle proyectado · Resumen por cliente";
  setText("ptbadge", !meta.ok || !shouldShowProjectionSummaryTable() ? "Proyección" : `${fmt(totalLabel)}${totalKnown ? '' : '+'} filas base`);

  const tools = el("projectionTools");
  if (tools) tools.innerHTML = "";

  if (!meta.ok) {
    body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">🧮</div><p>${escHtml(meta.message)}</p></div></td></tr>`;
    const note = el("psnote"); if (note) note.style.display = "none";
    return;
  }

  if (!shouldShowProjectionSummaryTable()) {
    body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">🎯</div><p>Aplicá al menos fecha, un filtro de negocio o seleccioná uno o más grupos proyectados para ver el detalle.</p></div></td></tr>`;
    const note = el("psnote"); if (note) note.style.display = "none";
    return;
  }

  if ((!projectionDetailState.loaded && !projectionDetailState.rows.length) || (projectionDetailState.loading && !projectionDetailState.loaded)) {
    body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">⏳</div><p>${expanded ? 'Cargando detalle proyectado filtrado...' : 'Cargando resumen por cliente...'}</p></div></td></tr>`;
    const note = el("psnote"); if (note) note.style.display = "none";
    return;
  }

  if (!projectionDetailState.rows.length) {
    body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">🔍</div><p>${escHtml(projectionDetailState.message || "Sin resultados para los filtros actuales")}</p></div></td></tr>`;
    const note = el("psnote"); if (note) note.style.display = "none";
    return;
  }

  if (!lazyModuleState.explorerViews.loaded) {
    body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">⚙️</div><p>Preparando vista avanzada...</p></div></td></tr>`;
    const note = el("psnote"); if (note) note.style.display = "none";
  }

  try {
    const { renderProjectionExplorerTable } = await loadExplorerViewsModule();
    const latestState = projectionController.getDetailState();
    const latestMeta = getProjectionMeta();
    const latestTotalKnown = latestState.totalKnown !== false;
    const latestTotalLabel = latestState.total || latestState.summary?.totalRows || 0;

    renderProjectionExplorerTable({
      toolsNode: el("projectionTools"),
      headNode: el("pthead"),
      bodyNode: el("ptbody"),
      badgeNode: el("ptbadge"),
      noteNode: el("psnote"),
      rows: latestState.rows,
      total: latestTotalLabel,
      totalKnown: latestTotalKnown,
      loading: latestState.loading,
      meta: latestMeta,
      explorer: projectionExplorerState,
      onExplorerPatch: patchProjectionExplorer,
      onMore: () => { void revealMoreProjectionRows(projectionDetailPageSize()); },
      onAll: () => { void revealAllProjectionRows(); },
      hasMore: latestState.hasMore,
      pageSize: projectionDetailPageSize(),
      fmt,
      fmtSignedPct,
      escHtml
    });

    if (shouldShowProjectionSummaryTable() && latestState.hasMore && !latestState.loading) {
      projectionController.warmDetailContext?.();
    }
  } catch (error) {
    console.error("[renderProjectionTable]", error);
    body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">⚠️</div><p>No se pudo preparar la vista avanzada del detalle proyectado.</p></div></td></tr>`;
  }
}

function renderProjectionPage() {
  if (scheduledProjectionLoadTimer) {
    clearTimeout(scheduledProjectionLoadTimer);
    scheduledProjectionLoadTimer = 0;
  }

  const meta = getProjectionMeta();
  const compareContext = getProjectionCompareContext();
  const compareState = projectionController.getCompareState();
  const detailState = projectionController.getDetailState();
  const hierarchyState = getProjectionHierarchyState();
  const productHierarchyState = getProjectionProductHierarchyState();
  const needsCompareLoad = projectionController.needsCompareLoad(compareContext);
  const needsDetailLoad = projectionController.needsDetailLoad(compareContext);
  const needsHierarchyLoad = needsProjectionHierarchyLoad(compareContext);
  const needsProductHierarchyLoad = needsProjectionProductHierarchyLoad(compareContext);

  if (needsCompareLoad && !compareState.loading) {
    void ensureProjectionCompareLoaded().then(loaded => {
      if (loaded && activeTab === TAB_PROY) renderProjectionPage();
    });
  }

  if (needsDetailLoad && !detailState.loading) {
    void ensureProjectionDetailLoaded().then(loaded => {
      if (loaded && activeTab === TAB_PROY) renderProjectionPage();
    });
  }

  if (needsHierarchyLoad && !hierarchyState.loading) {
    void ensureProjectionHierarchyLoaded().then(loaded => {
      if (loaded && activeTab === TAB_PROY) renderProjectionPage();
    });
  }

  if (needsProductHierarchyLoad && !productHierarchyState.loading) {
    void ensureProjectionProductHierarchyLoaded().then(loaded => {
      if (loaded && activeTab === TAB_PROY) renderProjectionPage();
    });
  }

  renderProjectionPageStatic(meta);
}

// ── Acumulados y gráficos ─────────────────────────────────────────────────────
async function renderAcumuladosFromState() {
  renderAccumulatedTables({
    dashboardState,
    emptyDashboardState,
    setKPIBlock,
    setText,
    el,
    fmt,
    escHtml,
    palette: PAL
  });
  renderAccumulatedStories();

  const bodyNode = el("acumExplorerBody");
  if (bodyNode && !lazyModuleState.explorerViews.loaded) {
    bodyNode.innerHTML = '<tr><td colspan="4"><div class="empty"><div class="eico">⚙️</div><p>Preparando explorador...</p></div></td></tr>';
  }

  try {
    const { renderAccumulatedExplorer } = await loadExplorerViewsModule();
    renderAccumulatedExplorer({
      titleNode: el("acumExplorerTitle"),
      badgeNode: el("acumExplorerBadge"),
      toolsNode: el("acumExplorerTools"),
      headNode: el("acumExplorerHead"),
      bodyNode,
      noteNode: el("acumExplorerNote"),
      rankings: {
        coordinadores: dashboardState.rankings.coordinadores || [],
        agentes: dashboardState.rankings.agentes || [],
        grupos: dashboardState.rankings.grupos || [],
        marcas: dashboardState.rankings.marcas || [],
        clientes: dashboardState.rankings.clientes || []
      },
      totalKilos: Number(dashboardState?.kpis?.kilos || 0),
      explorer: accumExplorerState,
      onExplorerPatch: patchAccumExplorer,
      fmt,
      escHtml
    });
  } catch (error) {
    console.error("[renderAcumuladosFromState]", error);
    if (bodyNode) {
      bodyNode.innerHTML = '<tr><td colspan="4"><div class="empty"><div class="eico">⚠️</div><p>No se pudo preparar el explorador de acumulados.</p></div></td></tr>';
    }
  }
}

// v30: nueva pestaña Resumen Acumulado
let __resumenAcumController = null;
async function renderResumenAcumuladoPage() {
  try {
    const mod = await import("./js/accumulated-summary.js");
    if (!__resumenAcumController) {
      __resumenAcumController = mod.createAccumulatedSummaryController({
        apiBase: API_BASE,
        getFiltros: () => filtros,
        getPeriodo: () => periodo,
        fmt,
        fmtK: typeof fmtK === "function" ? fmtK : fmt,
        escHtml,
        palette: PAL,
        getAuthToken: () => {
          try { return sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY) || ""; }
          catch (_) { return ""; }
        }
      });
      __resumenAcumController.bindUI();
    }
    await __resumenAcumController.refresh();
  } catch (error) {
    console.error("[renderResumenAcumuladoPage]", error);
    const body = el("acsumBody");
    if (body) body.innerHTML = '<tr><td colspan="5"><div class="empty"><div class="eico">⚠️</div><p>No se pudo cargar el módulo Resumen Acumulado.</p></div></td></tr>';
  }
}

// v38: nueva pestaña Frecuencia de Compra
let __frecuenciaController = null;
async function renderFrecuenciaPage() {
  try {
    const mod = await import("./js/frequency-controller.js");
    if (!__frecuenciaController) {
      __frecuenciaController = mod.createFrequencyController({
        apiBase: API_BASE,
        getFiltros:   () => filtros,
        getPeriodo:   () => periodo,
        fmt,
        escHtml,
        getAuthToken: () => {
          try { return sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY) || ""; }
          catch (_) { return ""; }
        }
      });
      __frecuenciaController.bindUI();
    }
    // Poblar selector de familia desde el estado global (array de strings)
    const grupos = dashboardState?.options?.grupos || [];
    if (grupos.length && __frecuenciaController.populateGrupoFreqSelect) {
      __frecuenciaController.populateGrupoFreqSelect(grupos);
    }
    await __frecuenciaController.refresh();
  } catch (error) {
    console.error("[renderFrecuenciaPage]", error);
    const body = el("freqBody");
    if (body) body.innerHTML = '<tr><td colspan="8"><div class="empty"><div class="eico">⚠️</div><p>No se pudo cargar el módulo Frecuencia de Compra.</p></div></td></tr>';
  }
}

function renderDailyComparativeSection({ hostId, badgeId, contextId, noteId, renderDailyCompareChart } = {}) {
  const payload = dashboardState?.charts?.dailyComparative;
  const hasPayload = Array.isArray(payload?.series) && payload.series.some(item => Array.isArray(item?.values) && item.values.length);
  const rangeLabel = payload?.rangeLabel || 'Ventana diaria';
  setText(badgeId, hasPayload ? `${payload.series.length} series · ${rangeLabel}` : 'Sin comparativa');
  setText(contextId, hasPayload ? `${payload.referenceLabel || 'Mes de referencia'} · ${rangeLabel}` : 'Mes de referencia —');
  setText(noteId, hasPayload
    ? 'Comparativa diaria del mes de referencia contra sus dos meses previos, respetando los filtros actuales.'
    : 'Ajustá período o filtros para construir una comparativa diaria de meses consecutivos.');
  renderDailyCompareChart(hostId, payload, { el, fmt, fmtK, escHtml, palette: PAL });
}

function renderDetailInsights() {
  return;
}

async function renderChartsFromState() {
  renderGraphStories();
  const chartDeps = { el, escHtml, fmt, fmtK, palette: PAL };

  try {
    const {
      renderDailyCompareChart,
      renderDonut,
      renderHBars,
      renderLineChart
    } = await loadChartsModule();

    renderHBars("gGrupo", dashboardState.rankings.grupos || [], 0, chartDeps, {
      showShare: true,
      shareTotal: (dashboardState.rankings.grupos || []).reduce((acc, item) => acc + Number(item?.kilos || 0), 0)
    });
    renderDonut(dashboardState.rankings.grupos || [], chartDeps);
    renderHBars("gMarca", dashboardState.rankings.marcas || [], 3, chartDeps, {
      showShare: true,
      shareTotal: (dashboardState.rankings.marcas || []).reduce((acc, item) => acc + Number(item?.kilos || 0), 0)
    });
    renderHBars("gAgte", dashboardState.rankings.agentes || [], 6, chartDeps, {
      showShare: true,
      shareTotal: (dashboardState.rankings.agentes || []).reduce((acc, item) => acc + Number(item?.kilos || 0), 0)
    });
    renderHBars("gClie", dashboardState.rankings.clientes || [], 9, chartDeps);
    renderDailyComparativeSection({
      hostId: 'graphDailyChart',
      badgeId: 'graphDailyBadge',
      contextId: 'graphDailyContext',
      noteId: 'graphDailyNote',
      renderDailyCompareChart
    });
    renderLineChart(dashboardState.charts.lineMensual || [], chartDeps);
  } catch (error) {
    console.error("[renderChartsFromState]", error);
    showErr("No se pudieron renderizar los gráficos.");
    setStatus("Error de gráficos", "err");
  }
}

function renderActiveTab() {
  if (activeTab === TAB_DETALLE) {
    renderDetailInsights();
    return;
  }
  if (activeTab === TAB_PROY) {
    renderProjectionPage();
    return;
  }
  if (activeTab === TAB_ACUM) {
    renderAcumuladosFromState();
    return;
  }
  if (activeTab === TAB_RESUMEN_ACUM) {
    renderResumenAcumuladoPage();
    return;
  }
  if (activeTab === TAB_FREC) {
    renderFrecuenciaPage();
    return;
  }
  if (activeTab === TAB_GRAF) {
    renderChartsFromState();
  }
}

function renderAll() {
  // Completar barra de progreso
  const bar = document.getElementById("loadProgressBar");
  if (bar && bar.classList.contains("active")) {
    bar.className = "done";
    setTimeout(() => { if (bar.className === "done") bar.className = ""; }, 600);
  }
  setKPIBlock(dashboardState.kpis || emptyDashboardState().kpis, "");
  renderGrupoStrip(dashboardState.rankings.grupos || []);
  renderTable();
  rebuildSelects();
  updatePills();
  updateUxChrome();
  renderActiveTab();
  // Si el tab Resumen Acumulado está activo, refrescar con debounce
  if (activeTab === TAB_RESUMEN_ACUM && __resumenAcumController) {
    __resumenAcumController.refreshDebounced(300);
  }
  // Si el tab Frecuencia está activo, refrescar con debounce
  if (activeTab === TAB_FREC && __frecuenciaController) {
    __frecuenciaController.refreshDebounced(300);
  }
}

// ── Carga principal ───────────────────────────────────────────────────────────
async function cargarEstado() {
  const mySeq = ++loadSeq;
  const ctrl = new AbortController();
  cancelScheduledLoads();
  abortInflightWork();
  currentLoadCtrl = ctrl;
  resetViewControllers({ preserveProjectionGroups: true });

  const shouldBlockUi = loadSeq <= 1 && !stateCache.size;
  showOverlay(shouldBlockUi);
  setStatus("Cargando...", "spin");
  hideErr();

  try {
    await ensureRuntimeVersion();
    if (scheduledProjectionLoadTimer) {
      clearTimeout(scheduledProjectionLoadTimer);
      scheduledProjectionLoadTimer = 0;
    }

    const needDetail = shouldShowDetailSummaryTable();
    const qs = stateQueryString({ includeDetail: needDetail });
    activeStateKey = qs;

    const payload = await fetchStatePayload(qs, ctrl.signal);
    if (currentLoadCtrl !== ctrl || mySeq !== loadSeq) return;

    dashboardState = payload || emptyDashboardState();
    if (payload?.options?.clientes?.length) mergeCatalogItems("clientes", payload.options.clientes);
    if (payload?.options?.productos?.length) mergeCatalogItems("productos", payload.options.productos);
    pruneProjectionGroupSelection();
    detailController.hydrateFromStatePayload(payload?.detail || {});

    await yieldToUI();
    renderAll();
    warmModulesForTab(activeTab);
    maybeWarmNonCriticalModules();

    if (detailExplorerState.view === "detalle" && hasActiveDetailColumnFilters()) {
      await reloadDetailSummaryFromBackend({ preserveStatus: true });
    }

    if (needsInsightsForTab(activeTab)) {
      setStatus("Cargando analitica...", "spin");
      const loaded = await ensureInsightsLoaded(true);
      if (loaded && currentLoadCtrl === ctrl && mySeq === loadSeq) {
        renderActiveTab();
      }
    }

    setFiltersCollapsed(filtersCollapsed, false);
    if (filterController.getKeepProductDropdownOpenState?.()) {
      const currentTerm = el("iProd")?.value || "";
      renderProductDropdown(filterProductOptions(currentTerm));
      scheduleProductDropdownLoad(currentTerm, true);
      el("iProd")?.focus();
    }
    setStatus(readyStatusLabel(), "ok");
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (/Autenticacion requerida/i.test(String(err?.message || ""))) return;

    console.error("[cargarEstado]", err);
    dashboardState = emptyDashboardState();
    resetViewControllers({ preserveProjectionGroups: true });

    setStatus("Error de carga", "err");
    showErr(err?.message || "Error inesperado");
    ["kK", "kC", "kA", "kR", "akK", "akC", "akA", "akR"].forEach(id => setText(id, "—"));
    renderAll();
    setFiltersCollapsed(filtersCollapsed, false);
  } finally {
    if (currentLoadCtrl === ctrl) {
      currentLoadCtrl = null;
      showOverlay(false);
    }
  }
}

// ── Listeners ─────────────────────────────────────────────────────────────────
function onFilterChange(kind, value) {
  if (kind !== "detailGroup") clearDetailQuickGroups({ silent: true });
  if (kind === "coordinador") {
    filtros.coordinador = value;
    filtros.agente = filtros.cliente = filtros.grupo = filtros.marca = "";
    filtros.codProd = [];
    clearProductInputSilent();
    clearClientSelection(true);
  } else if (kind === "agente") {
    filtros.agente = value;
    filtros.cliente = filtros.grupo = filtros.marca = "";
    filtros.codProd = [];
    clearProductInputSilent();
    clearClientSelection(true);
  } else if (kind === "cliente") {
    filtros.cliente = value;
    filtros.grupo = filtros.marca = "";
    filtros.codProd = [];
    clearProductInputSilent();
  } else if (kind === "grupo") {
    filtros.grupo = value;
    filtros.marca = "";
    filtros.codProd = [];
    clearProductInputSilent();
  } else if (kind === "marca") {
    filtros.marca = value;
    filtros.codProd = [];
    clearProductInputSilent();
  } else if (kind === "region") {
    filtros.region = value;
  } else if (kind === "codProd") {
    filtros.codProd = Array.isArray(value) ? value : (value ? [value] : []);
  }
  scheduleStateLoad();
}

el("btnDetailClearGroup")?.addEventListener("click", () => {
  if (!clearDetailQuickGroups({ silent: true })) return;
  renderGrupoStrip(dashboardState.rankings.grupos || []);
  scheduleStateLoad();
});

el("btnRetryLoad")?.addEventListener("click", () => {
  hideErr();
  void cargarEstado();
});

function setupListeners() {
  const listeners = setupAppListeners({
    el,
    activeTab,
    onTabChange: async (tabName) => {
      setActiveTab(tabName);
      updateUxChrome();
      warmModulesForTab(tabName);
      renderActiveTab();

      if (!needsInsightsForTab(tabName)) return;

      setStatus("Cargando analitica...", "spin");
      const loaded = await ensureInsightsLoaded();
      if (loaded && activeTab === normalizeTabName(tabName)) renderActiveTab();
      setStatus(readyStatusLabel(), "ok");
    },
    filterController,
    onFilterChange,
    scheduleStateLoad,
    setProjectionConfig: value => {
      projectionConfig = {
        habiles: normalizeProjectionValue(value?.habiles),
        transcurridos: normalizeProjectionValue(value?.transcurridos)
      };
    },
    getProjectionConfig: () => projectionConfig,
    persistProjectionConfig,
    renderProjectionPage: () => {
      syncProjectionInputs();
      renderProjectionPage();
    },
    setTabsController: value => { tabsController = value; },
    setClientCombobox: value => { clientCombobox = value; },
    setProductCombobox: value => { productCombobox = value; },
    getFiltersCollapsed: () => filtersCollapsed,
    setFiltersCollapsed,
    syncTabsTop,
    onClearAll: () => {
      clearDetailQuickGroups({ silent: true });
      renderGrupoStrip(dashboardState.rankings.grupos || []);
    },
    setKeepProductDropdownOpen: value => { filterController.setKeepProductDropdownOpenState?.(value); },
    getKeepProductDropdownOpen: () => filterController.getKeepProductDropdownOpenState?.()
  });
  tabsController = listeners.tabsController || tabsController;
  clientCombobox = listeners.clientCombobox || clientCombobox;
  productCombobox = listeners.productCombobox || productCombobox;

  document.querySelectorAll('.tab[data-tab]').forEach(tab => {
    const warm = () => warmModulesForTab(tab.dataset.tab || '');
    tab.addEventListener('mouseenter', warm, { once: true, passive: true });
    tab.addEventListener('focus', warm, { once: true });
  });

  bindGlobalKeyboardShortcuts();

  // v40: tabs-bar overflow detection → muestra gradient fade en el borde derecho
  (function initTabsOverflow() {
    const bar = el("tabsBar");
    if (!bar) return;
    const check = () => bar.classList.toggle("has-overflow", bar.scrollWidth > bar.clientWidth + 4);
    check();
    new ResizeObserver(check).observe(bar);
    bar.addEventListener("scroll", check, { passive: true });
  })();

  // v41: table horizontal overflow detection → muestra scroll hint dorado
  (function initTableOverflow() {
    document.querySelectorAll(".tw").forEach(wrapper => {
      const check = () => wrapper.classList.toggle(
        "has-h-overflow",
        wrapper.scrollWidth > wrapper.clientWidth + 4
      );
      check();
      new ResizeObserver(check).observe(wrapper);
      wrapper.addEventListener("scroll", check, { passive: true });
    });
  })();
}

function ensureAppUpdateToast() {
  let toast = el(APP_UPDATE_TOAST_ID);
  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = APP_UPDATE_TOAST_ID;
  toast.className = "app-update-toast";
  toast.hidden = true;
  toast.innerHTML = `
    <div class="app-update-toast__body">
      <div class="app-update-toast__title">Nueva versión disponible</div>
      <div class="app-update-toast__text">Se detectó un app shell más reciente (<span data-role="version"></span>). Aplicá la actualización para evitar mezclar assets viejos.</div>
    </div>
    <div class="app-update-toast__actions">
      <button type="button" class="table-action-btn table-action-btn--accent" data-action="reload">Actualizar</button>
      <button type="button" class="table-action-btn" data-action="dismiss">Más tarde</button>
    </div>`;
  document.body.appendChild(toast);

  toast.querySelector('[data-action="dismiss"]')?.addEventListener("click", () => {
    toast.hidden = true;
  });

  toast.querySelector('[data-action="reload"]')?.addEventListener("click", () => {
    const registration = serviceWorkerState.registration;
    const waiting = registration?.waiting;
    if (!waiting) {
      toast.hidden = true;
      return;
    }
    serviceWorkerState.activationRequested = true;
    toast.hidden = true;
    setStatus("Actualizando interfaz...", "spin");
    waiting.postMessage({ type: "SKIP_WAITING" });
  });

  return toast;
}

function showAppUpdateToast() {
  const toast = ensureAppUpdateToast();
  const versionNode = toast.querySelector('[data-role="version"]');
  if (versionNode) versionNode.textContent = APP_VERSION;
  toast.hidden = false;
}

function watchServiceWorkerRegistration(registration) {
  serviceWorkerState.registration = registration;

  const surfaceWaitingWorker = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      showAppUpdateToast();
    }
  };

  registration.addEventListener("updatefound", () => {
    const nextWorker = registration.installing;
    if (!nextWorker) return;
    nextWorker.addEventListener("statechange", () => {
      if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
        surfaceWaitingWorker();
      }
    });
  });

  surfaceWaitingWorker();
}

async function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (!serviceWorkerState.listenersReady) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!serviceWorkerState.activationRequested) return;
      serviceWorkerState.activationRequested = false;
      window.location.reload();
    });
    serviceWorkerState.listenersReady = true;
  }

  try {
    const registration = await navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(APP_VERSION)}`);
    watchServiceWorkerRegistration(registration);
    registration.update?.().catch(() => {});
  } catch (error) {
    console.warn("[serviceWorker.register]", error);
  }
}

function initializeApp() {
  // v30: theme toggle se inicializa primero para evitar flash of wrong theme
  void initThemeAndWidgets();

  authUi.ensureShell();
  setActiveTab(loadStoredActiveTab(), { persist: false });
  setupListeners();
  setupUxChromeListeners();
  applyPeriod("mes");
  const btn = document.querySelector('.pbtn[data-p="mes"]');
  if (btn) btn.classList.add("on");
  try {
    const storedCollapse = localStorage.getItem(FILTERS_PREF_KEY);
    filtersCollapsed = storedCollapse == null
      ? window.matchMedia(`(max-width:${MOBILE_FILTER_BREAKPOINT}px)`).matches
      : storedCollapse === "1";
  } catch (_) {
    filtersCollapsed = window.matchMedia(`(max-width:${MOBILE_FILTER_BREAKPOINT}px)`).matches;
  }
  setFiltersCollapsed(filtersCollapsed, false);
  updateUxChrome();
  syncClientSearchUI();
  syncProjectionInputs();
  renderProjectionPage();

  const token = getStoredAuthToken();
  if (token) {
    authUi.updateUserBadge(decodeBasicUser(token));
    authUi.hideOverlay();
    setStatus("Conectando...", "spin");
    void cargarEstado();
    return;
  }

  showOverlay(false);
  setStatus("Ingreso requerido", "err");
  authUi.showOverlay();
}

// v30: lazy-load theme y BCRA widget. Theme primero (sincrónico-ish), luego BCRA.
async function initThemeAndWidgets() {
  try {
    const [{ initThemeToggle }, { initBcraWidget }] = await Promise.all([
      import("./js/theme-toggle.js"),
      import("./js/bcra-widget.js")
    ]);
    initThemeToggle();
    initBcraWidget({
      apiBase: API_BASE,
      getAuthToken: () => {
        try { return sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY) || ""; }
        catch (_) { return ""; }
      }
    });
  } catch (err) {
    console.warn("[initThemeAndWidgets]", err);
  }
}

function scheduleServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator) || serviceWorkerState.scheduled) return;
  serviceWorkerState.scheduled = true;
  serviceWorkerRegistrationHandle = scheduleBrowserIdleTask(() => {
    serviceWorkerRegistrationHandle = null;
    serviceWorkerState.scheduled = false;
    void registerAppServiceWorker();
  }, SERVICE_WORKER_IDLE_DELAY_MS);
}

function bootApp() {
  installRuntimeGuards();
  try {
    initializeApp();
    scheduleServiceWorkerRegistration();
  } catch (error) {
    reportRuntimeError("boot", error);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", bootApp, { once: true });
