import { DETAIL_PAGE_DEFAULT, DETAIL_PAGE_MAX } from "../../config.js";
import { clamp } from "../../lib/db.js";
import { monthRange, formatProjectionRangeLabel } from "../../lib/dates.js";
import { hasBusinessFilter, hasProjectionGroupFilter, normalizeStringList, parseProjectionDetailGroups } from "../../lib/filters.js";
import {
  canUseCurrentDayScope,
  canUseCurrentMonthScope,
  canUseHistoricalMonthScope,
  hasCompactVentas2025MesScope,
  hasNormalizedVentas2025MesScope,
  hasHistoricalSnapshotMonth,
  hasSingleCurrentMonthSnapshot
} from "../../lib/scope.js";

export const PROJECTION_COMPARE_DIMS = ["coordinador", "agente", "cliente", "grupo", "projGroups", "detailGroups", "marca", "codProd"];
export const PROJECTION_DETAIL_DIMS = ["coordinador", "agente", "cliente", "grupo", "marca", "codProd"];

export function resolveProjectionCurrentSource(runtime, f) {
  const useCurrentSnapshotMonth = hasSingleCurrentMonthSnapshot(runtime, f);
  const useCurrentMonthScope = !useCurrentSnapshotMonth && canUseCurrentMonthScope(runtime, f);
  const useCurrentDayScope = !useCurrentSnapshotMonth && !useCurrentMonthScope && canUseCurrentDayScope(runtime, f);
  const currentSourceLabel = useCurrentSnapshotMonth
    ? "state_snapshot_month"
    : useCurrentMonthScope
      ? "ventas_mes_scope+ventas_scope_dim"
      : useCurrentDayScope
        ? "ventas_dia_scope+ventas_scope_dim"
        : "ventas";

  return {
    useCurrentSnapshotMonth,
    useCurrentMonthScope,
    useCurrentDayScope,
    currentSourceLabel
  };
}

export function resolveProjectionHistoricalSource(runtime, f, compare) {
  const useHistoricalClosedMonth = Boolean(compare?.historicalClosedMonth && compare?.compareYearMonthKey);
  const useHistoricalMonthScope = canUseHistoricalMonthScope(runtime, compare);
  const historicalTable = useHistoricalMonthScope ? "ventas_2025_mes_scope" : "ventas_2025";
  const useHistoricalSnapshotMonth = Boolean(
    runtime.hasVentas2025 &&
    useHistoricalMonthScope &&
    useHistoricalClosedMonth &&
    hasHistoricalSnapshotMonth(runtime) &&
    !hasBusinessFilter(f) &&
    !hasProjectionGroupFilter(f)
  );
  const historicalSourceLabel = useHistoricalSnapshotMonth
    ? "ventas_2025_snapshot_month"
    : (useHistoricalMonthScope && hasCompactVentas2025MesScope(runtime)
        ? "ventas_2025_mes_scope+ventas_2025_scope_dim"
        : historicalTable);
  const compareResponseMode = useHistoricalClosedMonth ? "month" : String(compare?.mode || "range");
  const compareResponseLabel = useHistoricalClosedMonth
    ? formatProjectionRangeLabel(compare.historicalClosedMonthDesde, compare.historicalClosedMonthHasta)
    : String(compare?.label || "");

  return {
    useHistoricalClosedMonth,
    useHistoricalMonthScope,
    useHistoricalSnapshotMonth,
    historicalTable,
    historicalSourceLabel,
    compareResponseMode,
    compareResponseLabel
  };
}

export function resolveProjectionCompareSources(runtime, f, compare) {
  const current = resolveProjectionCurrentSource(runtime, f);
  const historical = resolveProjectionHistoricalSource(runtime, f, compare);

  return {
    ...current,
    ...historical
  };
}

export function resolveProjectionDetailContext(url, runtime, f, compare) {
  const detailGroups = normalizeStringList([...(f.projGroups || []), ...parseProjectionDetailGroups(url)], 20);
  const detailView = detailGroups.length ? "detail" : "summary";
  const headers = detailView === "detail"
    ? ["Fecha", "Cliente", "Grupo_Familia", "Cod_Producto", "Producto_Desc", "KilosActuales", "Kilos2025"]
    : ["Fecha", "Cliente", "KilosActuales", "Kilos2025"];
  const requestedLimit = clamp(parseInt(url.searchParams.get("limit") || "", 10), DETAIL_PAGE_DEFAULT, 1, DETAIL_PAGE_MAX);
  const offset = clamp(parseInt(url.searchParams.get("offset") || "", 10), 0, 0, 1_000_000_000);
  const projectedDate = String(compare.currentHasta || monthRange(compare.baseYear, compare.baseMonth).hasta);
  const useHistoricalMonthScope = canUseHistoricalMonthScope(runtime, compare);
  const useCompactHistoricalMonthScope = hasCompactVentas2025MesScope(runtime);
  const useNormalizedHistoricalMonthScope = Boolean(
    useHistoricalMonthScope &&
    useCompactHistoricalMonthScope &&
    hasNormalizedVentas2025MesScope(runtime)
  );

  return {
    detailGroups,
    detailView,
    headers,
    requestedLimit,
    offset,
    projectedDate,
    useHistoricalMonthScope,
    useCompactHistoricalMonthScope,
    useNormalizedHistoricalMonthScope
  };
}
