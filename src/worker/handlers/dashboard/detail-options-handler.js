import { DETAIL_TTL } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { hasBusinessFilter, hasDateFilter, hasDetailGroupFilter, parseFilters } from "../../lib/filters.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { missingVentasMessage } from "../../lib/payloads.js";
import { queryDetailFilterOptions } from "../../services/state-queries.js";

const ALLOWED_COLUMNS = new Set(["Fecha", "Cliente", "Grupo_Familia", "Cod_Producto", "Producto_Desc", "Kilos"]);

export async function handleDetailOptions(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);
  const column = String(url.searchParams.get("column") || "").trim();

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      if (!runtime.hasVentas) {
        return jsonNoStore({
          ok: true,
          column,
          values: [],
          total: 0,
          meta: {
            dataVersion: runtime.meta.dataVersion,
            warning: missingVentasMessage()
          }
        });
      }

      if (!ALLOWED_COLUMNS.has(column)) {
        return jsonNoStore({ ok: false, error: true, mensaje: "Columna no valida." }, 400);
      }

      if (!hasBusinessFilter(f) && !hasDateFilter(f) && !hasDetailGroupFilter(f)) {
        return jsonPublic({
          ok: true,
          column,
          values: [],
          total: 0,
          meta: { dataVersion: runtime.meta.dataVersion }
        }, DETAIL_TTL);
      }

      const values = await queryDetailFilterOptions(env, runtime, f, column);
      return jsonPublic({
        ok: true,
        column,
        values,
        total: values.length,
        meta: {
          dataVersion: runtime.meta.dataVersion,
          sourceMode: "phase-11-detail-options-context"
        }
      }, DETAIL_TTL);
    }
  });
}
