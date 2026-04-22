export function defaultDatasetMeta() {
  return {
    dataVersion: "legacy-no-metadata",
    generatedAt: null,
    sourceFile: null,
    rowsTotal: null,
    rowsSkipped: null,
    minFecha: null,
    maxFecha: null,
    clientesTotal: null,
    productosTotal: null,
  };
}

export function normalizeDatasetMeta(row) {
  return {
    dataVersion: String(row?.data_version || "legacy-no-metadata"),
    generatedAt: row?.generated_at_utc ? String(row.generated_at_utc) : null,
    sourceFile: row?.source_file ? String(row.source_file) : null,
    rowsTotal: toNullableNumber(row?.rows_total),
    rowsSkipped: toNullableNumber(row?.rows_skipped),
    minFecha: row?.min_fecha ? String(row.min_fecha) : null,
    maxFecha: row?.max_fecha ? String(row.max_fecha) : null,
    clientesTotal: toNullableNumber(row?.clientes_total),
    productosTotal: toNullableNumber(row?.productos_total),
  };
}

export function summarizeDatasetMeta(meta) {
  return {
    generatedAt: meta.generatedAt,
    sourceFile: meta.sourceFile,
    rowsTotal: meta.rowsTotal,
    rowsSkipped: meta.rowsSkipped,
    minFecha: meta.minFecha,
    maxFecha: meta.maxFecha,
    clientesTotal: meta.clientesTotal,
    productosTotal: meta.productosTotal,
  };
}

export function toNullableNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}



const RUNTIME_FLAG_KEYS = [
  "hasClientesCatalogo",
  "hasProductosCatalogo",
  "hasAgentesCatalogo",
  "hasScopeCatalogo",
  "hasStateSnapshotGlobal",
  "hasRankingGruposGlobal",
  "hasStateOptionsMonthGlobal",
  "hasStateSnapshotMonth",
  "hasRankingGruposMonth",
  "hasInsightsRankingsMonth",
  "hasVentas",
  "hasVentasScopeDim",
  "hasVentasDiaScope",
  "hasVentasMesScope",
  "hasVentas2025",
  "hasVentas2025MesScope",
  "hasVentas2025ScopeDim",
  "hasVentas2025SnapshotMonth",
  "hasVentas2025ClientesCatalogo",
  "hasVentas2025ProductosCatalogo"
];

export function normalizeRuntimeContext(runtime = {}) {
  const meta = runtime?.meta ? { ...defaultDatasetMeta(), ...runtime.meta } : defaultDatasetMeta();
  const normalized = {
    meta,
    ...runtime
  };
  for (const key of RUNTIME_FLAG_KEYS) {
    normalized[key] = Boolean(runtime?.[key]);
  }
  return normalized;
}

export function createRuntimeContextResolver({ queryAll, queryFirst, ttlMs = 15000 }) {
  const cache = {
    value: null,
    expiresAt: 0,
    pending: null
  };

  return async function resolveRuntimeContext(env, { force = false } = {}) {
    const now = Date.now();
    if (!force && cache.value && cache.expiresAt > now) return cache.value;
    if (cache.pending) return cache.pending;

    cache.pending = (async () => {
      const tables = await queryAll(env, `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'clientes_catalogo',
            'productos_catalogo',
            'agentes_catalogo',
            'scope_catalogo',
            'state_snapshot_global',
            'ranking_grupos_global',
            'state_options_month_global',
            'state_snapshot_month',
            'ranking_grupos_month',
            'insights_rankings_month',
            'dataset_metadata',
            'ventas',
            'ventas_scope_dim',
            'ventas_dia_scope',
            'ventas_mes_scope',
            'ventas_2025',
            'ventas_2025_mes_scope',
            'ventas_2025_scope_dim',
            'ventas_2025_snapshot_month',
            'ventas_2025_clientes_catalogo',
            'ventas_2025_productos_catalogo'
          )
      `);
      const names = new Set((tables || []).map(r => String(r.name || "")));

      let meta = defaultDatasetMeta();
      if (names.has("dataset_metadata")) {
        try {
          const row = await queryFirst(env, `
            SELECT
              data_version,
              generated_at_utc,
              source_file,
              rows_total,
              rows_skipped,
              min_fecha,
              max_fecha,
              clientes_total,
              productos_total
            FROM dataset_metadata
            LIMIT 1
          `);
          if (row) meta = normalizeDatasetMeta(row);
        } catch (err) {
          console.warn("[dataset_metadata] fallback", err);
        }
      }

      const value = {
        meta,
        hasClientesCatalogo: names.has("clientes_catalogo"),
        hasProductosCatalogo: names.has("productos_catalogo"),
        hasAgentesCatalogo: names.has("agentes_catalogo"),
        hasScopeCatalogo: names.has("scope_catalogo"),
        hasStateSnapshotGlobal: names.has("state_snapshot_global"),
        hasRankingGruposGlobal: names.has("ranking_grupos_global"),
        hasStateOptionsMonthGlobal: names.has("state_options_month_global"),
        hasStateSnapshotMonth: names.has("state_snapshot_month"),
        hasRankingGruposMonth: names.has("ranking_grupos_month"),
        hasInsightsRankingsMonth: names.has("insights_rankings_month"),
        hasVentas: names.has("ventas"),
        hasVentasScopeDim: names.has("ventas_scope_dim"),
        hasVentasDiaScope: names.has("ventas_dia_scope"),
        hasVentasMesScope: names.has("ventas_mes_scope"),
        hasVentas2025: names.has("ventas_2025"),
        hasVentas2025MesScope: names.has("ventas_2025_mes_scope"),
        hasVentas2025ScopeDim: names.has("ventas_2025_scope_dim"),
        hasVentas2025SnapshotMonth: names.has("ventas_2025_snapshot_month"),
        hasVentas2025ClientesCatalogo: names.has("ventas_2025_clientes_catalogo"),
        hasVentas2025ProductosCatalogo: names.has("ventas_2025_productos_catalogo")
      };

      cache.value = normalizeRuntimeContext(value);
      cache.expiresAt = Date.now() + ttlMs;
      cache.pending = null;
      return cache.value;
    })();

    try {
      return await cache.pending;
    } catch (err) {
      cache.pending = null;
      throw err;
    }
  };
}
