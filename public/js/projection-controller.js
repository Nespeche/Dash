export function createProjectionController({
  fetchProjectionCompare,
  fetchProjectionDetailPage,
  createEmptyProjectionCompareState,
  createEmptyProjectionDetailState,
  projectionDetailTotalKnown,
  toProjectionDetailObjects,
  normalizeProjectionGroupSelection,
  getProjectionCompareContext,
  buildProjectionCompareQueryString,
  buildProjectionDetailBaseQueryString,
  buildProjectionDetailQueryString,
  getCurrentKpis,
  getDashboardState,
  shouldShowProjectionSummaryTable,
  getProjectionMeta,
  projectValue,
  yieldToUI,
  pageSize,
  bulkPageSize,
  callbacks = {}
} = {}) {
  const { setStatus, showError } = callbacks;

  let compareState = createEmptyProjectionCompareState();
  let compareLoadedFor = "";
  let compareSeq = 0;

  let detailState = createEmptyProjectionDetailState();
  let detailLoadedFor = "";
  let detailSeq = 0;
  let detailContextHydrationStarted = false;

  let selectedGroups = [];

  function getSelectedGroups() {
    return normalizeProjectionGroupSelection(selectedGroups);
  }

  function hasGroupSelection() {
    return getSelectedGroups().length > 0;
  }

  function getCompareState() {
    return { ...compareState };
  }

  function getDetailState() {
    return {
      ...detailState,
      rows: detailState.rows.slice(),
      selectedGroups: detailState.selectedGroups.slice(),
      summary: { ...(detailState.summary || {}) }
    };
  }

  function getCompareKey(context = getProjectionCompareContext()) {
    if (!context?.valid) return "";
    return buildProjectionCompareQueryString(context, getSelectedGroups());
  }

  function getDetailKey(context = getProjectionCompareContext()) {
    if (!context?.valid) return "";
    return buildProjectionDetailBaseQueryString(context, getSelectedGroups());
  }

  function reset({ preserveGroups = true } = {}) {
    compareState = createEmptyProjectionCompareState();
    compareLoadedFor = "";
    compareSeq = 0;
    detailState = createEmptyProjectionDetailState();
    detailLoadedFor = "";
    detailSeq = 0;
    detailContextHydrationStarted = false;
    if (!preserveGroups) selectedGroups = [];
  }

  function needsCompareLoad(context = getProjectionCompareContext()) {
    if (!context?.valid) {
      return !compareState.loaded || compareState.reason !== context?.reason || compareState.message !== context?.message;
    }
    const key = getCompareKey(context);
    return compareLoadedFor !== key || !compareState.loaded;
  }

  function needsDetailLoad(context = getProjectionCompareContext()) {
    const groups = getSelectedGroups();
    const expectedMode = groups.length ? "detail" : "summary";

    if (!context?.valid) {
      return !detailState.loaded || detailState.reason !== context?.reason || detailState.viewMode !== expectedMode;
    }

    if (!shouldShowProjectionSummaryTable()) {
      return !detailState.loaded || detailState.reason !== "filters" || detailState.viewMode !== expectedMode;
    }

    const key = getDetailKey(context);
    return detailLoadedFor !== key || !detailState.loaded;
  }

  async function ensureCompareLoaded(force = false) {
    const context = getProjectionCompareContext();

    if (!context.valid) {
      compareState = {
        ...createEmptyProjectionCompareState(),
        loaded: true,
        reason: context.reason,
        message: context.message,
        currentLabel: context.currentLabel,
        compareLabel: context.compareLabel,
        currentMode: context.mode,
        compareMode: context.mode
      };
      compareLoadedFor = "";
      return false;
    }

    const qs = getCompareKey(context);
    if (!force && compareLoadedFor === qs && compareState.loaded) return true;

    const previousCurrent = getCurrentKpis();
    const mySeq = ++compareSeq;
    compareState = {
      ...createEmptyProjectionCompareState(),
      loading: true,
      currentLabel: context.currentLabel,
      compareLabel: context.compareLabel,
      currentMode: context.mode,
      compareMode: context.mode,
      compareYear: context.compareYear,
      compareMonth: context.compareMonth,
      currentKilos: Number(previousCurrent.kilos || 0),
      currentClientes: Number(previousCurrent.clientes || 0),
      currentAgentes: Number(previousCurrent.agentes || 0),
      currentRegistros: Number(previousCurrent.registros || 0),
      message: ""
    };

    try {
      const payload = await fetchProjectionCompare(qs, { abortPrevious: true });
      if (mySeq !== compareSeq) return false;

      compareState = {
        loaded: true,
        loading: false,
        available: Boolean(payload?.available),
        currentLabel: context.currentLabel,
        compareLabel: String(payload?.compare?.label || context.compareLabel),
        currentMode: context.mode,
        compareMode: String(payload?.compare?.mode || context.mode || "month"),
        compareYear: Number(payload?.compare?.year || context.compareYear),
        compareMonth: Number(payload?.compare?.month || context.compareMonth),
        kilos: Number(payload?.compare?.kilos || 0),
        clientes: Number(payload?.compare?.clientes || 0),
        agentes: Number(payload?.compare?.agentes || 0),
        registros: Number(payload?.compare?.registros || 0),
        currentKilos: Number(payload?.current?.kilos || 0),
        currentClientes: Number(payload?.current?.clientes || 0),
        currentAgentes: Number(payload?.current?.agentes || 0),
        currentRegistros: Number(payload?.current?.registros || 0),
        latestDate: String(payload?.compare?.latestDate || ""),
        latestKilos: Number(payload?.compare?.latestKilos || 0),
        reason: payload?.available ? "ok" : "missing",
        message: String(payload?.meta?.message || "")
      };
      compareLoadedFor = qs;
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.warn("[projectionController.ensureCompareLoaded]", error);
      compareState = {
        ...createEmptyProjectionCompareState(),
        loaded: true,
        currentLabel: context.currentLabel,
        compareLabel: context.compareLabel,
        currentMode: context.mode,
        compareMode: context.mode,
        reason: "error",
        message: error?.message || "No se pudo cargar la base 2025."
      };
      compareLoadedFor = qs;
      return false;
    }
  }

  async function ensureDetailLoaded(force = false) {
    const context = getProjectionCompareContext();
    const groups = getSelectedGroups();
    const expectedMode = groups.length ? "detail" : "summary";

    if (!context.valid) {
      detailState = {
        ...createEmptyProjectionDetailState(),
        loaded: true,
        reason: context.reason,
        message: context.message,
        viewMode: expectedMode,
        selectedGroups: groups
      };
      detailLoadedFor = "";
      return false;
    }

    if (!shouldShowProjectionSummaryTable()) {
      detailState = {
        ...createEmptyProjectionDetailState(),
        loaded: true,
        reason: "filters",
        message: "Aplicá al menos un filtro de negocio o seleccioná uno o más grupos proyectados para ver el detalle proyectado.",
        viewMode: expectedMode,
        selectedGroups: groups
      };
      detailLoadedFor = "";
      return false;
    }

    const key = getDetailKey(context);
    if (!force && detailLoadedFor === key && detailState.loaded) return true;

    const mySeq = ++detailSeq;
    detailState = {
      ...createEmptyProjectionDetailState(),
      loading: true,
      projectedDate: detailState.projectedDate,
      viewMode: expectedMode,
      selectedGroups: groups
    };

    try {
      const qs = buildProjectionDetailQueryString(context, 0, pageSize(), groups);
      const payload = await fetchProjectionDetailPage(qs, { abortPrevious: true });
      if (mySeq !== detailSeq) return false;

      detailState = {
        loaded: true,
        loading: false,
        rows: toProjectionDetailObjects(payload.headers || [], payload.rows || []),
        total: projectionDetailTotalKnown(payload) ? Number(payload.total || 0) : Number(payload.nextOffset || 0),
        totalKnown: projectionDetailTotalKnown(payload),
        nextOffset: Number(payload.nextOffset || 0),
        hasMore: Boolean(payload.hasMore),
        projectedDate: String(payload?.summary?.projectedDate || ""),
        viewMode: String(payload?.meta?.viewMode || expectedMode),
        selectedGroups: normalizeProjectionGroupSelection(payload?.meta?.selectedGroups || groups),
        summary: {
          totalRows: projectionDetailTotalKnown(payload) ? Number(payload?.summary?.totalRows || payload?.total || 0) : Number(payload?.nextOffset || 0),
          kilosActuales: Number(payload?.summary?.kilosActuales || 0),
          kilos2025: Number(payload?.summary?.kilos2025 || 0)
        },
        reason: "ok",
        message: String(payload?.meta?.message || "")
      };
      detailLoadedFor = key;
      detailContextHydrationStarted = !detailState.hasMore;
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.warn("[projectionController.ensureDetailLoaded]", error);
      detailState = {
        ...createEmptyProjectionDetailState(),
        loaded: true,
        reason: "error",
        message: error?.message || "No se pudo cargar el detalle proyectado.",
        viewMode: expectedMode,
        selectedGroups: groups
      };
      detailLoadedFor = key;
      detailContextHydrationStarted = false;
      return false;
    }
  }

  async function loadMoreDetail(limit = pageSize()) {
    if (detailState.loading || !detailState.hasMore) return false;
    const context = getProjectionCompareContext();
    const mySeq = ++detailSeq;
    detailState = { ...detailState, loading: true };

    try {
      setStatus?.("Cargando detalle proyectado...", "spin");
      const qs = buildProjectionDetailQueryString(context, detailState.nextOffset, limit, getSelectedGroups());
      const payload = await fetchProjectionDetailPage(qs, { abortPrevious: false });
      if (mySeq !== detailSeq) return false;

      const moreRows = toProjectionDetailObjects(payload.headers || [], payload.rows || []);
      detailState = {
        ...detailState,
        loading: false,
        rows: detailState.rows.concat(moreRows),
        total: projectionDetailTotalKnown(payload) ? Number(payload.total || detailState.total) : Number(payload.nextOffset || detailState.rows.length + moreRows.length),
        totalKnown: projectionDetailTotalKnown(payload),
        nextOffset: Number(payload.nextOffset || detailState.rows.length + moreRows.length),
        hasMore: Boolean(payload.hasMore),
        projectedDate: String(payload?.summary?.projectedDate || detailState.projectedDate),
        viewMode: String(payload?.meta?.viewMode || detailState.viewMode || "summary"),
        selectedGroups: normalizeProjectionGroupSelection(payload?.meta?.selectedGroups || detailState.selectedGroups || []),
        summary: {
          totalRows: projectionDetailTotalKnown(payload) ? Number(payload?.summary?.totalRows || detailState.summary?.totalRows || 0) : Number(payload?.nextOffset || detailState.summary?.totalRows || 0),
          kilosActuales: Number(payload?.summary?.kilosActuales || detailState.summary?.kilosActuales || 0),
          kilos2025: Number(payload?.summary?.kilos2025 || detailState.summary?.kilos2025 || 0)
        }
      };
      setStatus?.("Detalle proyectado actualizado", "ok");
      return true;
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error("[projectionController.loadMoreDetail]", error);
        showError?.(error?.message || "Error cargando detalle proyectado");
      }
      return false;
    } finally {
      if (mySeq === detailSeq) {
        detailState = { ...detailState, loading: false };
      }
    }
  }

  async function loadAllDetail() {
    if (detailState.loading || !detailState.hasMore) return false;
    while (detailState.hasMore) {
      const remaining = detailState.totalKnown ? (detailState.total - detailState.rows.length) : bulkPageSize();
      const nextLimit = detailState.totalKnown
        ? Math.min(bulkPageSize(), Math.max(pageSize(), remaining))
        : bulkPageSize();
      const loaded = await loadMoreDetail(nextLimit);
      await yieldToUI?.();
      if (!loaded || detailState.loading) break;
    }
    return true;
  }

  function warmDetailContext() {
    if (detailContextHydrationStarted || detailState.loading || !detailState.hasMore) return false;
    detailContextHydrationStarted = true;
    window.setTimeout(() => {
      void loadAllDetail();
    }, 0);
    return true;
  }

  function getComparison(meta = getProjectionMeta()) {
    const currentKpis = getCurrentKpis();
    const projectedKilos = meta.ok ? projectValue(currentKpis.kilos || 0, meta) : 0;
    const baseKilos = Number(compareState?.kilos || 0);
    const deltaKg = projectedKilos - baseKilos;
    let deltaPct = null;
    let deltaPctLabel = "—";

    if (baseKilos > 0) {
      deltaPct = (deltaKg / baseKilos) * 100;
      deltaPctLabel = `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`;
    }

    return {
      ready: meta.ok && compareState.available,
      currentKilos: Number(currentKpis.kilos || 0),
      projectedKilos,
      baseKilos,
      deltaKg,
      deltaPct,
      deltaPctLabel,
      latestDate: compareState.latestDate || "",
      latestKilos: Number(compareState.latestKilos || 0),
      currentLabel: compareState.currentLabel || getProjectionCompareContext().currentLabel || "",
      compareLabel: compareState.compareLabel || getProjectionCompareContext().compareLabel || ""
    };
  }

  function toggleGroup(groupName) {
    const target = String(groupName || "").trim();
    if (!target) return getSelectedGroups();
    const next = new Set(getSelectedGroups());
    if (next.has(target)) next.delete(target);
    else next.add(target);
    selectedGroups = normalizeProjectionGroupSelection([...next]);
    compareLoadedFor = "";
    detailLoadedFor = "";

    const context = getProjectionCompareContext();
    compareState = {
      ...createEmptyProjectionCompareState(),
      currentLabel: context.currentLabel,
      compareLabel: context.compareLabel,
      currentMode: context.mode,
      compareMode: context.mode
    };
    detailState = {
      ...createEmptyProjectionDetailState(),
      loaded: false,
      loading: false,
      viewMode: selectedGroups.length ? "detail" : "summary",
      selectedGroups: selectedGroups.slice()
    };
    return getSelectedGroups();
  }

  function pruneSelectedGroups() {
    const available = new Set((getDashboardState()?.rankings?.grupos || []).map(item => String(item?.name || "").trim()).filter(Boolean));
    const current = getSelectedGroups();
    const next = current.filter(name => available.has(name));
    const changed = next.length !== current.length;
    selectedGroups = next;
    if (changed) {
      detailLoadedFor = "";
      detailState = {
        ...createEmptyProjectionDetailState(),
        viewMode: next.length ? "detail" : "summary",
        selectedGroups: next.slice()
      };
    }
    return changed;
  }

  return {
    reset,
    getCompareState,
    getDetailState,
    getSelectedGroups,
    hasGroupSelection,
    needsCompareLoad,
    needsDetailLoad,
    ensureCompareLoaded,
    ensureDetailLoaded,
    loadMoreDetail,
    loadAllDetail,
    getComparison,
    toggleGroup,
    pruneSelectedGroups,
    getCompareKey,
    getDetailKey
  };
}
