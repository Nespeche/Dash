-- =============================================================
-- schema.sql
-- Usar para instalaciones nuevas o para reconstruir la base desde cero.
-- Incluye runtime alineado con Fase 8 + soporte incremental + fast path mensual + insights mensual:
-- - ventas (dataset vigente)
-- - ventas_2025 para comparativo historico mensual
-- - catalogos runtime (clientes, productos, agentes)
-- - scope_catalogo materializado para filtros sin fecha
-- - Cod_Agente operativo poblado desde NUEVO_AGENTE (fallback AGTVE)
-- - state_snapshot_global + ranking_grupos_global para fast path global
-- - state_options_month_global + state_snapshot_month + ranking_grupos_month para fast path mensual
-- - insights_rankings_month para evitar agregaciones pesadas en insights mensuales
-- - ventas_2025_clientes_catalogo + ventas_2025_productos_catalogo para desduplicar historico
-- - ventas_2025_mes_scope reducido para comparativo proyectado
-- - dataset_metadata ampliado
-- - dataset_load_log para trazabilidad de cargas
-- - indices auxiliares para auditoria liviana de full/incremental
-- =============================================================

DROP TABLE IF EXISTS ventas;
DROP TABLE IF EXISTS ventas_2025;
DROP TABLE IF EXISTS ventas_scope_dim;
DROP TABLE IF EXISTS ventas_dia_scope;
DROP TABLE IF EXISTS ventas_mes_scope;
DROP TABLE IF EXISTS clientes_catalogo;
DROP TABLE IF EXISTS productos_catalogo;
DROP TABLE IF EXISTS agentes_catalogo;
DROP TABLE IF EXISTS scope_catalogo;
DROP TABLE IF EXISTS state_snapshot_global;
DROP TABLE IF EXISTS ranking_grupos_global;
DROP TABLE IF EXISTS state_options_month_global;
DROP TABLE IF EXISTS state_snapshot_month;
DROP TABLE IF EXISTS ranking_grupos_month;
DROP TABLE IF EXISTS insights_rankings_month;
DROP TABLE IF EXISTS ventas_2025_clientes_catalogo;
DROP TABLE IF EXISTS ventas_2025_productos_catalogo;
DROP TABLE IF EXISTS ventas_2025_mes_scope;
DROP TABLE IF EXISTS dataset_metadata;
DROP TABLE IF EXISTS dataset_load_log;

CREATE TABLE ventas (
  Fecha               TEXT,
  Cod_Cliente         TEXT,
  Cliente             TEXT,
  Cliente_Search      TEXT,
  Cod_Agente          TEXT,
  Cod_Agente_Original TEXT,
  Nuevo_Agente        TEXT,
  Agente              TEXT,
  Agente_Original     TEXT,
  Coordinador         TEXT,
  Marca               TEXT,
  Kilos               REAL,
  Grupo_Familia       TEXT,
  Region              TEXT,
  Producto_Desc       TEXT,
  Cod_Producto        TEXT
);

CREATE TABLE ventas_2025 (
  Fecha               TEXT,
  Cod_Cliente         TEXT,
  Cliente             TEXT,
  Cliente_Search      TEXT,
  Cod_Agente          TEXT,
  Cod_Agente_Original TEXT,
  Nuevo_Agente        TEXT,
  Agente              TEXT,
  Agente_Original     TEXT,
  Coordinador         TEXT,
  Marca               TEXT,
  Kilos               REAL,
  Grupo_Familia       TEXT,
  Region              TEXT,
  Producto_Desc       TEXT,
  Cod_Producto        TEXT
);

CREATE INDEX IF NOT EXISTS idx_fecha_v               ON ventas(Fecha);
CREATE INDEX IF NOT EXISTS idx_coord_v               ON ventas(Coordinador);
CREATE INDEX IF NOT EXISTS idx_agente_v              ON ventas(Cod_Agente);
CREATE INDEX IF NOT EXISTS idx_agente_original_v     ON ventas(Cod_Agente_Original);
CREATE INDEX IF NOT EXISTS idx_nuevo_agente_v        ON ventas(Nuevo_Agente);
CREATE INDEX IF NOT EXISTS idx_cliente_v             ON ventas(Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_grupo_v               ON ventas(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_marca_v               ON ventas(Marca);
CREATE INDEX IF NOT EXISTS idx_codprod_v             ON ventas(Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_cliente_search_v      ON ventas(Cliente_Search);
CREATE INDEX IF NOT EXISTS idx_coord_fecha_v         ON ventas(Coordinador, Fecha);
CREATE INDEX IF NOT EXISTS idx_agente_fecha_v        ON ventas(Cod_Agente, Fecha);
CREATE INDEX IF NOT EXISTS idx_cliente_fecha_v       ON ventas(Cod_Cliente, Fecha);
CREATE INDEX IF NOT EXISTS idx_grupo_fecha_v         ON ventas(Grupo_Familia, Fecha);
CREATE INDEX IF NOT EXISTS idx_marca_fecha_v         ON ventas(Marca, Fecha);
CREATE INDEX IF NOT EXISTS idx_codprod_fecha_v       ON ventas(Cod_Producto, Fecha);
CREATE INDEX IF NOT EXISTS idx_cliente_search_code_v ON ventas(Cliente_Search, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_coord_fecha_cliente_v ON ventas(Coordinador, Fecha, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_agente_fecha_cliente_v ON ventas(Cod_Agente, Fecha, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_proj_grupo_fecha_cliente_prod_v ON ventas(Grupo_Familia, Fecha, Cod_Cliente, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_proj_cliente_fecha_grupo_prod_v ON ventas(Cod_Cliente, Fecha, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_detail_core_v         ON ventas(Fecha DESC, Cod_Cliente, Grupo_Familia, Cod_Producto, Kilos);
CREATE INDEX IF NOT EXISTS idx_insights_coord_fecha_v ON ventas(Coordinador, Fecha, Grupo_Familia, Kilos);
CREATE INDEX IF NOT EXISTS idx_insights_agente_fecha_v ON ventas(Cod_Agente, Fecha, Grupo_Familia, Kilos);

CREATE INDEX IF NOT EXISTS idx_fecha_v2025               ON ventas_2025(Fecha);
CREATE INDEX IF NOT EXISTS idx_coord_v2025               ON ventas_2025(Coordinador);
CREATE INDEX IF NOT EXISTS idx_agente_v2025              ON ventas_2025(Cod_Agente);
CREATE INDEX IF NOT EXISTS idx_agente_original_v2025     ON ventas_2025(Cod_Agente_Original);
CREATE INDEX IF NOT EXISTS idx_nuevo_agente_v2025        ON ventas_2025(Nuevo_Agente);
CREATE INDEX IF NOT EXISTS idx_cliente_v2025             ON ventas_2025(Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_grupo_v2025               ON ventas_2025(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_marca_v2025               ON ventas_2025(Marca);
CREATE INDEX IF NOT EXISTS idx_codprod_v2025             ON ventas_2025(Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_cliente_search_v2025      ON ventas_2025(Cliente_Search);
CREATE INDEX IF NOT EXISTS idx_coord_fecha_v2025         ON ventas_2025(Coordinador, Fecha);
CREATE INDEX IF NOT EXISTS idx_agente_fecha_v2025        ON ventas_2025(Cod_Agente, Fecha);
CREATE INDEX IF NOT EXISTS idx_cliente_fecha_v2025       ON ventas_2025(Cod_Cliente, Fecha);
CREATE INDEX IF NOT EXISTS idx_grupo_fecha_v2025         ON ventas_2025(Grupo_Familia, Fecha);
CREATE INDEX IF NOT EXISTS idx_marca_fecha_v2025         ON ventas_2025(Marca, Fecha);
CREATE INDEX IF NOT EXISTS idx_codprod_fecha_v2025       ON ventas_2025(Cod_Producto, Fecha);
CREATE INDEX IF NOT EXISTS idx_cliente_search_code_v2025 ON ventas_2025(Cliente_Search, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_coord_fecha_cliente_v2025 ON ventas_2025(Coordinador, Fecha, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_agente_fecha_cliente_v2025 ON ventas_2025(Cod_Agente, Fecha, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_proj_grupo_fecha_cliente_prod_v2025 ON ventas_2025(Grupo_Familia, Fecha, Cod_Cliente, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_proj_cliente_fecha_grupo_prod_v2025 ON ventas_2025(Cod_Cliente, Fecha, Grupo_Familia, Cod_Producto);

CREATE TABLE clientes_catalogo (
  Cod_Cliente    TEXT PRIMARY KEY,
  Cliente        TEXT,
  Cliente_Search TEXT
);

CREATE INDEX IF NOT EXISTS idx_cc_search ON clientes_catalogo(Cliente_Search);

CREATE TABLE productos_catalogo (
  Cod_Producto    TEXT PRIMARY KEY,
  Producto_Desc   TEXT,
  Producto_Search TEXT
);

CREATE INDEX IF NOT EXISTS idx_pc_search ON productos_catalogo(Producto_Search);

CREATE TABLE ventas_2025_clientes_catalogo (
  Cod_Cliente    TEXT PRIMARY KEY,
  Cliente        TEXT,
  Cliente_Search TEXT
);

CREATE INDEX IF NOT EXISTS idx_hcc_search ON ventas_2025_clientes_catalogo(Cliente_Search);

CREATE TABLE ventas_2025_productos_catalogo (
  Cod_Producto    TEXT PRIMARY KEY,
  Producto_Desc   TEXT,
  Producto_Search TEXT
);

CREATE INDEX IF NOT EXISTS idx_hpc_search ON ventas_2025_productos_catalogo(Producto_Search);

CREATE TABLE agentes_catalogo (
  Cod_Agente TEXT PRIMARY KEY,
  Agente     TEXT
);

CREATE INDEX IF NOT EXISTS idx_ac_nombre ON agentes_catalogo(Agente);

CREATE TABLE scope_catalogo (
  Coordinador   TEXT,
  Cod_Agente    TEXT,
  Cod_Cliente   TEXT,
  Grupo_Familia TEXT,
  Marca         TEXT,
  Cod_Producto  TEXT
);

CREATE INDEX IF NOT EXISTS idx_sc_coord ON scope_catalogo(Coordinador);
CREATE INDEX IF NOT EXISTS idx_sc_agente ON scope_catalogo(Cod_Agente);
CREATE INDEX IF NOT EXISTS idx_sc_cliente ON scope_catalogo(Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_sc_grupo ON scope_catalogo(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_sc_marca ON scope_catalogo(Marca);
CREATE INDEX IF NOT EXISTS idx_sc_codprod ON scope_catalogo(Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_sc_coord_agente ON scope_catalogo(Coordinador, Cod_Agente);
CREATE INDEX IF NOT EXISTS idx_sc_coord_agente_cliente ON scope_catalogo(Coordinador, Cod_Agente, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_sc_scope_grupo ON scope_catalogo(Coordinador, Cod_Agente, Cod_Cliente, Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_sc_scope_marca ON scope_catalogo(Coordinador, Cod_Agente, Cod_Cliente, Grupo_Familia, Marca);

CREATE TABLE state_snapshot_global (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  kilos     REAL NOT NULL,
  clientes  INTEGER NOT NULL,
  agentes   INTEGER NOT NULL,
  registros INTEGER NOT NULL
);

CREATE TABLE ranking_grupos_global (
  posicion INTEGER PRIMARY KEY,
  name     TEXT,
  kilos    REAL NOT NULL
);


CREATE TABLE state_options_month_global (
  YearMonth  TEXT NOT NULL,
  sort_group INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  value      TEXT,
  codigo     TEXT,
  nombre     TEXT
);

CREATE INDEX IF NOT EXISTS idx_somg_month_sort ON state_options_month_global(YearMonth, sort_group);
CREATE INDEX IF NOT EXISTS idx_somg_month_kind_value ON state_options_month_global(YearMonth, kind, value, codigo);

CREATE TABLE state_snapshot_month (
  YearMonth TEXT PRIMARY KEY,
  kilos     REAL NOT NULL,
  clientes  INTEGER NOT NULL,
  agentes   INTEGER NOT NULL,
  registros INTEGER NOT NULL
);

CREATE TABLE ranking_grupos_month (
  YearMonth TEXT NOT NULL,
  posicion  INTEGER NOT NULL,
  name      TEXT,
  kilos     REAL NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rgm_month_pos ON ranking_grupos_month(YearMonth, posicion);
CREATE INDEX IF NOT EXISTS idx_rgm_month_name ON ranking_grupos_month(YearMonth, name);

CREATE TABLE insights_rankings_month (
  YearMonth    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  posicion     INTEGER NOT NULL,
  codigo       TEXT,
  name         TEXT,
  coordinador  TEXT,
  agente       TEXT,
  kilos        REAL NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_irm_month_kind_pos ON insights_rankings_month(YearMonth, kind, posicion);
CREATE INDEX IF NOT EXISTS idx_irm_month_kind_name ON insights_rankings_month(YearMonth, kind, name);
CREATE INDEX IF NOT EXISTS idx_irm_month_kind_code ON insights_rankings_month(YearMonth, kind, codigo);

CREATE TABLE ventas_scope_dim (
  scope_id       INTEGER NOT NULL,
  Coordinador    TEXT,
  Cod_Agente     TEXT,
  Cod_Cliente    TEXT,
  Marca          TEXT,
  Grupo_Familia  TEXT,
  Cod_Producto   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vsd_scope_id ON ventas_scope_dim(scope_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vsd_scope_key ON ventas_scope_dim(Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_vsd_group ON ventas_scope_dim(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_vsd_client_group_prod ON ventas_scope_dim(Cod_Cliente, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_vsd_coord_client ON ventas_scope_dim(Coordinador, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_vsd_coord_agent ON ventas_scope_dim(Coordinador, Cod_Agente);

CREATE TABLE ventas_dia_scope (
  Fecha     TEXT NOT NULL,
  YearMonth TEXT NOT NULL,
  scope_id  INTEGER NOT NULL,
  Kilos     REAL NOT NULL,
  Registros INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vds_date_scope_id ON ventas_dia_scope(Fecha, scope_id);
CREATE INDEX IF NOT EXISTS idx_vds_scope_id ON ventas_dia_scope(scope_id);
CREATE INDEX IF NOT EXISTS idx_vds_yearmonth ON ventas_dia_scope(YearMonth);
CREATE INDEX IF NOT EXISTS idx_vds_fecha ON ventas_dia_scope(Fecha);

CREATE TABLE ventas_mes_scope (
  YearMonth TEXT NOT NULL,
  scope_id  INTEGER NOT NULL,
  Kilos     REAL NOT NULL,
  Registros INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vms_month_scope_id ON ventas_mes_scope(YearMonth, scope_id);
CREATE INDEX IF NOT EXISTS idx_vms_scope_id ON ventas_mes_scope(scope_id);
CREATE INDEX IF NOT EXISTS idx_vms_month ON ventas_mes_scope(YearMonth);

CREATE TABLE ventas_2025_snapshot_month (
  YearMonth TEXT PRIMARY KEY,
  kilos     REAL NOT NULL,
  clientes  INTEGER NOT NULL,
  agentes   INTEGER NOT NULL,
  registros INTEGER NOT NULL
);

CREATE TABLE ventas_2025_scope_dim (
  scope_id       INTEGER NOT NULL,
  Coordinador    TEXT,
  Cod_Agente     TEXT,
  Cod_Cliente    TEXT,
  Marca          TEXT,
  Grupo_Familia  TEXT,
  Cod_Producto   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v25sd_scope_id ON ventas_2025_scope_dim(scope_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v25sd_scope_key ON ventas_2025_scope_dim(Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_v25sd_group ON ventas_2025_scope_dim(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_v25sd_client_group_prod ON ventas_2025_scope_dim(Cod_Cliente, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_v25sd_coord_client ON ventas_2025_scope_dim(Coordinador, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_v25sd_coord_agent ON ventas_2025_scope_dim(Coordinador, Cod_Agente);

CREATE TABLE ventas_2025_mes_scope (
  YearMonth TEXT NOT NULL,
  scope_id  INTEGER NOT NULL,
  Kilos     REAL NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v25ms_month_scope_id ON ventas_2025_mes_scope(YearMonth, scope_id);
CREATE INDEX IF NOT EXISTS idx_v25ms_scope_id ON ventas_2025_mes_scope(scope_id);

CREATE TABLE dataset_metadata (
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

CREATE TABLE dataset_load_log (
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
CREATE INDEX IF NOT EXISTS idx_dll_notes ON dataset_load_log(notes);
CREATE INDEX IF NOT EXISTS idx_dll_data_version ON dataset_load_log(data_version);
CREATE INDEX IF NOT EXISTS idx_dll_source_mode_time ON dataset_load_log(source_file, load_mode, executed_at_utc DESC);

PRAGMA optimize;

SELECT 'Schema nueva alineada con fast path mensual, insights mensuales y scope historico normalizado creada correctamente' AS resultado;
