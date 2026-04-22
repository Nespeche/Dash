-- =============================================================
-- ENTREGA 4 — Delta de schema: índices de Region
-- =============================================================
-- Aplicar con:  wrangler d1 execute <DB_NAME> --file=schema_region_indexes_delta.sql
--
-- La vista "region" en accum-summary siempre usa ventas/ventas_2025
-- porque las tablas scope no tienen columna Region.
-- Estos índices aceleran los GROUP BY y WHERE Region queries.
-- =============================================================

-- Tabla ventas (año actual)
CREATE INDEX IF NOT EXISTS idx_region_ventas
  ON ventas(Region);

CREATE INDEX IF NOT EXISTS idx_region_fecha_ventas
  ON ventas(Region, Fecha);

CREATE INDEX IF NOT EXISTS idx_region_coord_ventas
  ON ventas(Region, Coordinador);

-- Tabla ventas_2025 (histórico comparativo)
CREATE INDEX IF NOT EXISTS idx_region_v2025
  ON ventas_2025(Region);

CREATE INDEX IF NOT EXISTS idx_region_fecha_v2025
  ON ventas_2025(Region, Fecha);

CREATE INDEX IF NOT EXISTS idx_region_coord_v2025
  ON ventas_2025(Region, Coordinador);
