import { APP_VERSION } from "../../../shared/version.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { jsonNoStore } from "../../lib/endpoint-cache.js";
import { summarizeDatasetMeta } from "../../lib/runtime.js";

export async function handleHealth(env) {
  const runtime = await resolveRuntimeContext(env);
  return jsonNoStore({
    ok: true,
    db: "D1",
    mode: "phase-7-insights-fast-path",
    time: new Date().toISOString(),
    appVersion: APP_VERSION,
    dataVersion: runtime.meta.dataVersion,
    dataset: summarizeDatasetMeta(runtime.meta),
    catalogs: {
      clientes: runtime.hasClientesCatalogo,
      productos: runtime.hasProductosCatalogo,
      agentes: runtime.hasAgentesCatalogo
    },
    materialized: {
      scopeCatalog: runtime.hasScopeCatalogo,
      stateSnapshot: runtime.hasStateSnapshotGlobal,
      rankingGrupos: runtime.hasRankingGruposGlobal,
      stateSnapshotMonth: runtime.hasStateSnapshotMonth,
      rankingGruposMonth: runtime.hasRankingGruposMonth,
      insightsRankingsMonth: runtime.hasInsightsRankingsMonth,
      ventasScopeDim: runtime.hasVentasScopeDim,
      ventasDiaScope: runtime.hasVentasDiaScope,
      ventasMesScope: runtime.hasVentasMesScope
    },
    historical: {
      ventas2025: runtime.hasVentas2025,
      ventas2025MesScope: runtime.hasVentas2025MesScope,
      ventas2025ScopeDim: runtime.hasVentas2025ScopeDim,
      ventas2025SnapshotMonth: runtime.hasVentas2025SnapshotMonth
    },
    current: {
      ventas: runtime.hasVentas
    },
    status: {
      ready: runtime.hasVentas,
      message: runtime.hasVentas ? "" : "La tabla ventas no esta cargada en D1. En local usa 'wrangler dev --remote' o importa la base local antes de probar la app."
    }
  });
}
