import { APP_VERSION } from "../../shared/version.js";
import { DETAIL_PAGE_DEFAULT, SUMMARY_COLS } from "../config.js";
import { summarizeDatasetMeta } from "./runtime.js";
import { hasBusinessFilter } from "./filters.js";

export function missingVentasMessage() {
  return "La tabla ventas no existe en la D1 activa. Si estas probando en local, ejecuta 'npx wrangler dev --remote' o importa la base local antes de validar la app.";
}

export function buildEmptyStatePayload(runtime, f, extra = {}) {
  return {
    ok: true,
    period: { desde: f.desde, hasta: f.hasta },
    filters: {
      coordinador: f.coordinador,
      agente: f.agente,
      cliente: f.cliente,
      grupo: f.grupo,
      marca: f.marca,
      codProd: f.codProd
    },
    options: {
      coordinadores: [],
      agentes: [],
      clientes: [],
      grupos: [],
      marcas: [],
      productos: []
    },
    optionsMeta: {
      clientes: {
        lazy: true,
        included: Boolean(f.cliente),
        total: runtime.meta.clientesTotal
      },
      productos: {
        lazy: true,
        included: Array.isArray(f.codProd) && f.codProd.length > 0,
        total: runtime.meta.productosTotal
      }
    },
    kpis: {
      kilos: 0,
      clientes: 0,
      agentes: 0,
      registros: 0
    },
    rankings: {
      coordinadores: [],
      agentes: [],
      grupos: [],
      marcas: [],
      clientes: []
    },
    charts: {
      lineMensual: []
    },
    detail: {
      headers: SUMMARY_COLS,
      rows: [],
      total: 0,
      offset: 0,
      nextOffset: 0,
      limit: DETAIL_PAGE_DEFAULT,
      hasMore: false
    },
    meta: {
      stateMode: extra.stateMode || "phase-6-missing-base-table",
      insightsDeferred: true,
      detailDeferred: hasBusinessFilter(f),
      detailEmbedded: false,
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
        insightsRankingsMonth: runtime.hasInsightsRankingsMonth
      },
      warning: extra.warning || missingVentasMessage()
    }
  };
}
