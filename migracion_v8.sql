-- =============================================================
-- migracion_v8.sql
-- Fase 8: soporte seguro para actualizacion incremental.
--
-- Objetivos:
-- - ampliar dataset_metadata sin romper el worker actual
-- - agregar dataset_load_log para trazabilidad de cargas
-- - dejar la base lista para sumar deltas 2026 sin rebuild completo
-- =============================================================

-- Nota D1: no usar BEGIN/COMMIT explicitos en ejecucion remota via wrangler d1 execute.

CREATE TABLE IF NOT EXISTS dataset_load_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  load_mode        TEXT NOT NULL,
  executed_at_utc  TEXT NOT NULL,
  source_file      TEXT,
  rows_in_file     INTEGER,
  rows_inserted    INTEGER,
  rows_skipped     INTEGER,
  delta_min_fecha  TEXT,
  delta_max_fecha  TEXT,
  affected_dates   TEXT,
  data_version     TEXT,
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_dll_executed_at ON dataset_load_log(executed_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_dll_mode_time ON dataset_load_log(load_mode, executed_at_utc DESC);

DROP TABLE IF EXISTS dataset_metadata_v8;

CREATE TABLE dataset_metadata_v8 (
  singleton              INTEGER PRIMARY KEY CHECK (singleton = 1),
  data_version           TEXT NOT NULL,
  generated_at_utc       TEXT NOT NULL,
  source_file            TEXT,
  rows_total             INTEGER NOT NULL,
  rows_skipped           INTEGER NOT NULL,
  min_fecha              TEXT,
  max_fecha              TEXT,
  clientes_total         INTEGER NOT NULL,
  productos_total        INTEGER NOT NULL,
  load_mode              TEXT,
  last_source_file       TEXT,
  last_rows_in_file      INTEGER,
  last_rows_inserted     INTEGER,
  last_rows_skipped      INTEGER,
  last_delta_min_fecha   TEXT,
  last_delta_max_fecha   TEXT,
  historical_source_file TEXT,
  historical_rows_total  INTEGER
);

INSERT INTO dataset_metadata_v8 (
  singleton,
  data_version,
  generated_at_utc,
  source_file,
  rows_total,
  rows_skipped,
  min_fecha,
  max_fecha,
  clientes_total,
  productos_total,
  load_mode,
  last_source_file,
  last_rows_in_file,
  last_rows_inserted,
  last_rows_skipped,
  last_delta_min_fecha,
  last_delta_max_fecha,
  historical_source_file,
  historical_rows_total
)
SELECT
  singleton,
  data_version,
  generated_at_utc,
  source_file,
  rows_total,
  rows_skipped,
  min_fecha,
  max_fecha,
  clientes_total,
  productos_total,
  'full' AS load_mode,
  source_file AS last_source_file,
  rows_total + rows_skipped AS last_rows_in_file,
  rows_total AS last_rows_inserted,
  rows_skipped AS last_rows_skipped,
  NULL AS last_delta_min_fecha,
  NULL AS last_delta_max_fecha,
  'BBDD_2025.csv' AS historical_source_file,
  (SELECT COUNT(*) FROM ventas_2025) AS historical_rows_total
FROM dataset_metadata;

DROP TABLE dataset_metadata;
ALTER TABLE dataset_metadata_v8 RENAME TO dataset_metadata;

INSERT INTO dataset_load_log (
  load_mode,
  executed_at_utc,
  source_file,
  rows_in_file,
  rows_inserted,
  rows_skipped,
  delta_min_fecha,
  delta_max_fecha,
  affected_dates,
  data_version,
  notes
)
SELECT
  'full',
  generated_at_utc,
  source_file,
  rows_total + rows_skipped,
  rows_total,
  rows_skipped,
  min_fecha,
  max_fecha,
  NULL,
  data_version,
  'Migracion v8: base marcada como carga completa inicial'
FROM dataset_metadata
WHERE NOT EXISTS (SELECT 1 FROM dataset_load_log WHERE load_mode = 'full');


SELECT
  (SELECT COUNT(*) FROM ventas) AS ventas_rows,
  (SELECT COUNT(*) FROM ventas_2025) AS ventas_2025_rows,
  (SELECT COUNT(*) FROM dataset_load_log) AS dataset_load_log_rows,
  (SELECT load_mode FROM dataset_metadata LIMIT 1) AS current_load_mode,
  (SELECT historical_rows_total FROM dataset_metadata LIMIT 1) AS historical_rows_total;
