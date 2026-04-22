-- =============================================================
-- migracion_v9.sql
-- Endurecimiento operativo para incremental y auditoria ligera.
-- Seguro e idempotente: solo agrega indices auxiliares.
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_dll_notes ON dataset_load_log(notes);
CREATE INDEX IF NOT EXISTS idx_dll_data_version ON dataset_load_log(data_version);
CREATE INDEX IF NOT EXISTS idx_dll_source_mode_time ON dataset_load_log(source_file, load_mode, executed_at_utc DESC);

SELECT
  (SELECT COUNT(*) FROM dataset_load_log) AS dataset_load_log_rows,
  'ok' AS migracion_v9;
