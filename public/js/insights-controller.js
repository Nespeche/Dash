import { createEmptyInsightsState } from "./runtime-state.js";

export function createInsightsController({
  fetchInsights,
  emptyDashboardState,
  getDashboardState,
  setDashboardState,
  getActiveStateKey
} = {}) {
  let state = createEmptyInsightsState();

  function reset() {
    state = createEmptyInsightsState();
  }

  function mergePayload(payload) {
    if (!payload) return;
    const base = getDashboardState() || emptyDashboardState();
    setDashboardState({
      ...base,
      rankings: {
        ...(base.rankings || {}),
        ...(payload.rankings || {})
      },
      charts: {
        ...(base.charts || {}),
        ...(payload.charts || {})
      },
      meta: {
        ...(base.meta || {}),
        insightsDeferred: false
      }
    });
  }

  async function ensureLoaded(qs = getActiveStateKey?.() || "", force = false) {
    const targetKey = String(qs || "");
    if (!force && state.loadedFor === targetKey) return true;

    const mySeq = ++state.seq;
    try {
      const payload = await fetchInsights(targetKey, { abortPrevious: true });
      if (mySeq !== state.seq || (getActiveStateKey?.() || "") !== targetKey) return false;
      mergePayload(payload);
      state.loadedFor = targetKey;
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.warn("[insightsController.ensureLoaded]", error);
      return false;
    }
  }

  function getState() {
    return { ...state };
  }

  return {
    reset,
    mergePayload,
    ensureLoaded,
    getState
  };
}
