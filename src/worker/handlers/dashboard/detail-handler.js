import { DETAIL_PAGE_DEFAULT, DETAIL_PAGE_MAX, DETAIL_TTL, SUMMARY_COLS } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { clamp } from "../../lib/db.js";
import { hasBusinessFilter, hasDateFilter, hasDetailGroupFilter, parseFilters } from "../../lib/filters.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { missingVentasMessage } from "../../lib/payloads.js";
import { queryDetailPageData } from "../../services/state-queries.js";

export async function handleDetail(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);
  const limit = clamp(parseInt(url.searchParams.get("limit") || ""), DETAIL_PAGE_DEFAULT, 1, DETAIL_PAGE_MAX);
  const offset = clamp(parseInt(url.searchParams.get("offset") || ""), 0, 0, 1_000_000_000);

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      if (!runtime.hasVentas) {
        return jsonNoStore({
          ok: true,
          headers: SUMMARY_COLS,
          rows: [],
          total: 0,
          offset,
          nextOffset: offset,
          limit,
          hasMore: false,
          meta: {
            dataVersion: runtime.meta.dataVersion,
            warning: missingVentasMessage()
          }
        });
      }

      if (!hasBusinessFilter(f) && !hasDateFilter(f) && !hasDetailGroupFilter(f)) {
        return jsonPublic({
          ok: true,
          headers: SUMMARY_COLS,
          rows: [],
          total: 0,
          offset,
          nextOffset: offset,
          limit,
          hasMore: false,
          meta: { dataVersion: runtime.meta.dataVersion }
        }, DETAIL_TTL);
      }

      const detail = await queryDetailPageData(env, runtime, f, limit, offset);
      return jsonPublic({
        ok: true,
        ...detail,
        meta: {
          dataVersion: runtime.meta.dataVersion,
          detailMode: detail.sourceMode || "phase-5-runtime-aligned"
        }
      }, DETAIL_TTL);
    }
  });
}
