export {
  normalizeRankList,
  summaryTo2D,
  buildCatalogSearchClause
} from "./state-queries/common.js";

export {
  queryDetailPageData,
  queryDetailFilterOptions
} from "./state-queries/detail-queries.js";

export {
  queryCurrentMonthStateOptionsBundle,
  queryCurrentMonthClientOptionsLazy,
  queryCurrentMonthProductOptionsLazy,
  queryCurrentMonthSelectedProductRows,
  queryStateOptionsBundle,
  queryStateSimpleOptions,
  queryCoordinatorOptions,
  queryAgentOptions,
  querySelectedClientOptions,
  querySelectedProductOptions,
  queryClientOptionsLazy,
  queryProductOptionsLazy,
  queryClientOptions,
  queryGroupOptions,
  queryBrandOptions,
  queryProductOptions,
  queryMonthStateOptionsFastPath,
  queryRegionOptions
} from "./state-queries/options-queries.js";

export {
  queryMonthInsightsRowsFastPath,
  queryMonthInsightsPayload,
  queryCurrentMonthScopeInsightsPayload,
  queryDailyComparativeChartPayload
} from "./state-queries/insights-queries.js";

export {
  queryCurrentMonthScopeKpis,
  queryCurrentDayScopeKpis,
  queryCurrentMonthScopeGroupRanking,
  queryGlobalKpisFastPath,
  queryMonthKpisFastPath,
  queryGlobalGroupRankingFastPath,
  queryMonthGroupRankingFastPath
} from "./state-queries/fast-path-queries.js";
