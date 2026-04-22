export function createEmptyDashboardState() {
  return {
    options: {
      coordinadores: [],
      agentes: [],
      clientes: [],
      grupos: [],
      marcas: [],
      productos: []
    },
    kpis: { kilos: 0, clientes: 0, agentes: 0, registros: 0 },
    rankings: {
      coordinadores: [],
      agentes: [],
      grupos: [],
      marcas: [],
      clientes: []
    },
    charts: { lineMensual: [], dailyComparative: null },
    detail: createEmptyDetailState(),
    meta: {
      stateMode: "phase-3-runtime-aligned",
      insightsDeferred: false,
      detailDeferred: false,
      dataVersion: "bootstrap"
    }
  };
}

export function createEmptyDetailState() {
  return {
    rows: [],
    total: 0,
    nextOffset: 0,
    hasMore: false,
    loading: false
  };
}

export function createEmptyInsightsState() {
  return {
    loadedFor: "",
    seq: 0
  };
}

export function createEmptyProjectionCompareState() {
  return {
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
  };
}

export function createEmptyProjectionDetailState() {
  return {
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
  };
}

export function projectionDetailTotalKnown(payload) {
  if (!payload || typeof payload !== "object") return true;
  if (typeof payload.totalKnown === "boolean") return payload.totalKnown;
  const total = Number(payload.total);
  return Number.isFinite(total) && total >= 0;
}

export function createCatalogState() {
  return {
    clientes: { scopeKey: "", items: [], loaded: false, loading: false, lastTerm: "", requestSeq: 0 },
    productos: { scopeKey: "", items: [], loaded: false, loading: false, lastTerm: "", requestSeq: 0 }
  };
}

export function cacheGet(map, key, ttlMs) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > ttlMs) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(map, key, value, maxSize) {
  if (Number.isFinite(maxSize) && map.size >= maxSize) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
  map.set(key, { time: Date.now(), value });
}
