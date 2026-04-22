import { APP_VERSION } from "../../../shared/version.js";
import { CATALOG_TTL } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { parseCatalogKind, parseCatalogLimit, parseCatalogSearch, parseFilters } from "../../lib/filters.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { missingVentasMessage } from "../../lib/payloads.js";
import { queryClientOptionsLazy, queryProductOptionsLazy } from "../../services/state-queries.js";

export async function handleCatalog(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);
  const kind = parseCatalogKind(url);
  const search = parseCatalogSearch(url);
  const limit = parseCatalogLimit(url);

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      if (!kind) {
        return jsonNoStore({ error: true, mensaje: "Catalogo no soportado" }, 400);
      }

      if (!runtime.hasVentas) {
        return jsonNoStore({
          ok: true,
          kind,
          q: search,
          limit,
          items: [],
          meta: {
            appVersion: APP_VERSION,
            dataVersion: runtime.meta.dataVersion,
            lazy: true,
            warning: missingVentasMessage()
          }
        });
      }

      let items = [];
      if (kind === "clientes") {
        items = await queryClientOptionsLazy(env, runtime, f, search, limit);
      } else if (kind === "productos") {
        items = await queryProductOptionsLazy(env, runtime, f, search, limit);
      } else {
        return jsonNoStore({ error: true, mensaje: "Catalogo no soportado" }, 400);
      }

      return jsonPublic({
        ok: true,
        kind,
        q: search,
        limit,
        items: (items || []).map(r => ({
          codigo: String(r.codigo || ""),
          nombre: String(r.nombre || r.codigo || "")
        })).filter(x => x.codigo),
        meta: {
          appVersion: APP_VERSION,
          dataVersion: runtime.meta.dataVersion,
          lazy: true
        }
      }, CATALOG_TTL);
    }
  });
}
