export function createExplorerState(defaults = {}) {
  const view = String(defaults.view || "detalle");
  return {
    view,
    sort: String(defaults.sort || "default"),
    direction: defaults.direction === "asc" ? "asc" : "desc",
    search: String(defaults.search || ""),
    sortStack: Array.isArray(defaults.sortStack) ? defaults.sortStack.map(item => ({
      key: String(item?.key || ""),
      direction: item?.direction === "asc" ? "asc" : "desc"
    })).filter(item => item.key) : [],
    columnFilters: defaults.columnFilters && typeof defaults.columnFilters === "object"
      ? Object.fromEntries(Object.entries(defaults.columnFilters).map(([key, values]) => [
          String(key || ""),
          Array.isArray(values) ? [...new Set(values.map(value => String(value ?? "")).filter(value => value !== ""))] : []
        ]).filter(([key, values]) => key && values.length))
      : {},
    openColumnMenu: String(defaults.openColumnMenu || ""),
    metric: String(defaults.metric || "Kilos"),
    topN: String(defaults.topN || "50"),
    groupOthers: Object.prototype.hasOwnProperty.call(defaults, "groupOthers") ? Boolean(defaults.groupOthers) : true,
    showAdvanced: Boolean(defaults.showAdvanced),
    currentPreset: String(defaults.currentPreset || "custom"),
    favoriteId: String(defaults.favoriteId || "")
  };
}

export function patchExplorerState(current = {}, patch = {}, defaults = {}) {
  const base = createExplorerState({ ...defaults, ...current });
  const nextSortStack = Object.prototype.hasOwnProperty.call(patch, "sortStack")
    ? (Array.isArray(patch.sortStack) ? patch.sortStack.map(item => ({
        key: String(item?.key || ""),
        direction: item?.direction === "asc" ? "asc" : "desc"
      })).filter(item => item.key) : [])
    : base.sortStack;

  const nextColumnFilters = Object.prototype.hasOwnProperty.call(patch, "columnFilters")
    ? Object.fromEntries(Object.entries(patch.columnFilters || {}).map(([key, values]) => [
        String(key || ""),
        Array.isArray(values) ? [...new Set(values.map(value => String(value ?? "")).filter(value => value !== ""))] : []
      ]).filter(([key, values]) => key && values.length))
    : base.columnFilters;

  return {
    ...base,
    ...patch,
    view: Object.prototype.hasOwnProperty.call(patch, "view") ? String(patch.view || defaults.view || base.view) : base.view,
    sort: Object.prototype.hasOwnProperty.call(patch, "sort") ? String(patch.sort || defaults.sort || base.sort) : base.sort,
    direction: Object.prototype.hasOwnProperty.call(patch, "direction")
      ? (patch.direction === "asc" ? "asc" : "desc")
      : base.direction,
    search: Object.prototype.hasOwnProperty.call(patch, "search") ? String(patch.search || "") : base.search,
    sortStack: nextSortStack,
    columnFilters: nextColumnFilters,
    openColumnMenu: Object.prototype.hasOwnProperty.call(patch, "openColumnMenu") ? String(patch.openColumnMenu || "") : base.openColumnMenu,
    metric: Object.prototype.hasOwnProperty.call(patch, "metric") ? String(patch.metric || base.metric || "Kilos") : base.metric,
    topN: Object.prototype.hasOwnProperty.call(patch, "topN") ? String(patch.topN || base.topN || "50") : base.topN,
    groupOthers: Object.prototype.hasOwnProperty.call(patch, "groupOthers") ? Boolean(patch.groupOthers) : base.groupOthers,
    showAdvanced: Object.prototype.hasOwnProperty.call(patch, "showAdvanced") ? Boolean(patch.showAdvanced) : base.showAdvanced,
    currentPreset: Object.prototype.hasOwnProperty.call(patch, "currentPreset") ? String(patch.currentPreset || "custom") : base.currentPreset,
    favoriteId: Object.prototype.hasOwnProperty.call(patch, "favoriteId") ? String(patch.favoriteId || "") : base.favoriteId
  };
}
