import { createEmptyDetailState } from "./runtime-state.js";

export function createDetailController({
  fetchDetailPage,
  buildDetailQueryString,
  renderDetailTable,
  constants = {},
  helpers = {},
  callbacks = {}
} = {}) {
  const {
    pageSize = 200,
    bulkPageSize = 1000,
    projectionTab = "proyeccion"
  } = constants;

  const { el, fmt, escHtml, toNum, yieldToUI } = helpers;
  const {
    showError,
    setStatus,
    shouldShowSummaryTable,
    getActiveTab,
    onProjectionNeedsRefresh,
    getDetailRenderContext,
    onRequestRevealMore,
    onRequestRevealAll
  } = callbacks;

  let state = createEmptyDetailState();
  let detailSeq = 0;

  function toDetailObjects(headers, rows) {
    const idx = Object.fromEntries((headers || []).map((header, index) => [header, index]));
    return (rows || []).map(row => ({
      Fecha: String(row[idx.Fecha] ?? ""),
      Cliente: String(row[idx.Cliente] ?? ""),
      Grupo_Familia: String(row[idx.Grupo_Familia] ?? ""),
      Cod_Producto: String(row[idx.Cod_Producto] ?? ""),
      Producto_Desc: String(row[idx.Producto_Desc] ?? ""),
      Kilos: toNum(row[idx.Kilos])
    }));
  }

  function getState() {
    return {
      ...state,
      rows: state.rows.slice()
    };
  }

  function reset() {
    state = createEmptyDetailState();
    detailSeq = 0;
  }

  function hydrateFromStatePayload(detailPayload = {}) {
    const rows = toDetailObjects(detailPayload.headers || [], detailPayload.rows || []);
    let nextOffset = Number(detailPayload.nextOffset);
    if (!Number.isFinite(nextOffset)) nextOffset = rows.length;

    state = {
      rows,
      total: Number(detailPayload.total) || 0,
      nextOffset,
      hasMore: Boolean(detailPayload.hasMore),
      loading: false
    };
    return getState();
  }

  function render() {
    const renderContext = getDetailRenderContext?.() || {};
    renderDetailTable({
      headNode: el("detailHead"),
      bodyNode: el("tbody"),
      toolsNode: el("detailTools"),
      titleNode: el("detailTitle"),
      badgeNode: el("tbadge"),
      noteNode: el("snote"),
      rows: state.rows,
      total: state.total,
      showSummary: shouldShowSummaryTable(),
      detailLoading: state.loading,
      pageSize,
      onMore: () => {
        const handler = typeof onRequestRevealMore === "function"
          ? onRequestRevealMore
          : async () => {
              await loadMore(pageSize);
            };
        void handler(pageSize).then(() => render());
      },
      onAll: () => {
        const handler = typeof onRequestRevealAll === "function"
          ? onRequestRevealAll
          : async () => {
              await loadAll();
            };
        void handler().then(() => render());
      },
      explorer: renderContext.explorer,
      onExplorerPatch: renderContext.onExplorerPatch,
      toolbarActions: renderContext.toolbarActions,
      onRowDrill: renderContext.onRowDrill,
      columnOptionsOverride: renderContext.columnOptionsOverride,
      columnOptionsLoadingKey: renderContext.columnOptionsLoadingKey,
      getExplorerState: renderContext.getExplorerState,
      fmt,
      escHtml
    });
  }

  async function loadMore(limit = pageSize) {
    if (state.loading || !state.hasMore) return false;
    state = { ...state, loading: true };
    render();

    const mySeq = ++detailSeq;

    try {
      setStatus?.("Cargando detalle...", "spin");
      const qs = buildDetailQueryString(state.nextOffset, limit);
      const payload = await fetchDetailPage(qs, { abortPrevious: false });
      if (mySeq !== detailSeq) return false;

      const moreRows = toDetailObjects(payload.headers || [], payload.rows || []);
      state = {
        rows: state.rows.concat(moreRows),
        total: Number(payload.total) || state.total,
        nextOffset: Number(payload.nextOffset) || state.rows.length + moreRows.length,
        hasMore: Boolean(payload.hasMore),
        loading: false
      };

      if (getActiveTab?.() === projectionTab) onProjectionNeedsRefresh?.();
      setStatus?.(`${fmt(state.total)} registros`, "ok");
      return true;
    } catch (error) {
      if (error?.name !== "AbortError") {
        if (/Autenticacion requerida/i.test(String(error?.message || ""))) return false;
        console.error("[detailController.loadMore]", error);
        showError?.(error?.message || "Error cargando detalle");
        setStatus?.("Error de carga", "err");
      }
      return false;
    } finally {
      if (mySeq === detailSeq) {
        state = { ...state, loading: false };
        render();
        if (getActiveTab?.() === projectionTab) onProjectionNeedsRefresh?.();
      }
    }
  }

  async function loadAll() {
    if (state.loading || !state.hasMore) return false;
    while (state.hasMore) {
      const remaining = Math.max(state.total - state.rows.length, 0);
      const nextLimit = Math.min(bulkPageSize, Math.max(pageSize, remaining || pageSize));
      const loaded = await loadMore(nextLimit);
      await yieldToUI?.();
      if (!loaded || state.loading) break;
    }
    return true;
  }

  async function reloadFirstPage(limit = pageSize) {
    const mySeq = ++detailSeq;
    state = { ...state, loading: true, rows: [], total: 0, nextOffset: 0, hasMore: false };
    render();

    try {
      setStatus?.("Actualizando resumen filtrado...", "spin");
      const payload = await fetchDetailPage(buildDetailQueryString(0, limit), { abortPrevious: true });
      if (mySeq !== detailSeq) return false;

      const rows = toDetailObjects(payload.headers || [], payload.rows || []);
      state = {
        rows,
        total: Number(payload.total) || 0,
        nextOffset: Number(payload.nextOffset) || rows.length,
        hasMore: Boolean(payload.hasMore),
        loading: false
      };
      setStatus?.(`${fmt(state.total)} registros`, "ok");
      if (getActiveTab?.() === projectionTab) onProjectionNeedsRefresh?.();
      return true;
    } catch (error) {
      if (error?.name !== "AbortError") {
        if (/Autenticacion requerida/i.test(String(error?.message || ""))) return false;
        console.error("[detailController.reloadFirstPage]", error);
        showError?.(error?.message || "Error actualizando detalle");
        setStatus?.("Error de carga", "err");
      }
      return false;
    } finally {
      if (mySeq === detailSeq) {
        state = { ...state, loading: false };
        render();
        if (getActiveTab?.() === projectionTab) onProjectionNeedsRefresh?.();
      }
    }
  }

  async function reloadContext({ limit = pageSize, hydrateAll = false } = {}) {
    const ok = await reloadFirstPage(limit);
    if (!ok || !hydrateAll || !state.hasMore) return ok;
    await yieldToUI?.();
    await loadAll();
    return true;
  }

  return {
    reset,
    hydrateFromStatePayload,
    getState,
    loadMore,
    loadAll,
    reloadFirstPage,
    reloadContext,
    render
  };
}
