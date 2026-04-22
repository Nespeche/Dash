#!/usr/bin/env python3
"""SQL compartido para runtime/materializados de Ventas Dash.

Mantiene una sola fuente de verdad para:
- catalogos runtime del dataset vigente
- scope_catalogo
- snapshots globales
- materializados mensuales de estado e insights
- compactacion mensual del dataset vigente para rangos cerrados con filtros
- soporte historico 2025 usado por proyeccion/comparativo
"""


def sql_list(values):
    return ", ".join(f"'{str(v).replace("'", "''")}'" for v in values)


PRODUCTO_SEARCH_EXPR = """
lower(trim(
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    MIN(Producto_Desc),
    'Á','A'),'É','E'),'Í','I'),'Ó','O'),'Ú','U'),'Ü','U'),
    'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),'ü','u')
))
""".strip()


def build_runtime_refresh_sql_full():
    return f"""
DROP TABLE IF EXISTS clientes_catalogo;
DROP TABLE IF EXISTS productos_catalogo;
DROP TABLE IF EXISTS agentes_catalogo;
DROP TABLE IF EXISTS scope_catalogo;
DROP TABLE IF EXISTS state_snapshot_global;
DROP TABLE IF EXISTS ranking_grupos_global;
DROP TABLE IF EXISTS ventas_scope_dim;
DROP TABLE IF EXISTS ventas_dia_scope;
DROP TABLE IF EXISTS ventas_mes_scope;
DROP TABLE IF EXISTS state_options_month_global;
DROP TABLE IF EXISTS state_snapshot_month;
DROP TABLE IF EXISTS ranking_grupos_month;
DROP TABLE IF EXISTS insights_rankings_month;

CREATE TABLE clientes_catalogo AS
SELECT
  Cod_Cliente,
  MIN(Cliente) AS Cliente,
  MIN(Cliente_Search) AS Cliente_Search
FROM ventas
WHERE NULLIF(Cod_Cliente, '') IS NOT NULL
GROUP BY Cod_Cliente;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_codigo ON clientes_catalogo(Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_cc_search ON clientes_catalogo(Cliente_Search);

CREATE TABLE productos_catalogo AS
SELECT
  Cod_Producto,
  MIN(Producto_Desc) AS Producto_Desc,
  {PRODUCTO_SEARCH_EXPR} AS Producto_Search
FROM ventas
WHERE NULLIF(Cod_Producto, '') IS NOT NULL
GROUP BY Cod_Producto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_codigo ON productos_catalogo(Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_pc_search ON productos_catalogo(Producto_Search);

CREATE TABLE agentes_catalogo AS
WITH agent_codes AS (
  SELECT DISTINCT Cod_Agente
  FROM ventas
  WHERE NULLIF(Cod_Agente, '') IS NOT NULL
),
exact_names AS (
  SELECT
    Cod_Agente,
    Agente_Original AS Agente,
    ROW_NUMBER() OVER (
      PARTITION BY Cod_Agente
      ORDER BY COUNT(*) DESC, Agente_Original COLLATE NOCASE ASC
    ) AS rn
  FROM ventas
  WHERE
    NULLIF(Cod_Agente, '') IS NOT NULL
    AND NULLIF(Agente_Original, '') IS NOT NULL
    AND Cod_Agente = COALESCE(NULLIF(Cod_Agente_Original, ''), Cod_Agente)
  GROUP BY Cod_Agente, Agente_Original
),
fallback_names AS (
  SELECT
    Cod_Agente,
    Agente_Original AS Agente,
    ROW_NUMBER() OVER (
      PARTITION BY Cod_Agente
      ORDER BY COUNT(*) DESC, Agente_Original COLLATE NOCASE ASC
    ) AS rn
  FROM ventas
  WHERE NULLIF(Cod_Agente, '') IS NOT NULL AND NULLIF(Agente_Original, '') IS NOT NULL
  GROUP BY Cod_Agente, Agente_Original
)
SELECT
  c.Cod_Agente,
  COALESCE(e.Agente, f.Agente, c.Cod_Agente) AS Agente
FROM agent_codes c
LEFT JOIN exact_names e ON e.Cod_Agente = c.Cod_Agente AND e.rn = 1
LEFT JOIN fallback_names f ON f.Cod_Agente = c.Cod_Agente AND f.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ac_codigo ON agentes_catalogo(Cod_Agente);
CREATE INDEX IF NOT EXISTS idx_ac_nombre ON agentes_catalogo(Agente);

CREATE TABLE scope_catalogo AS
SELECT DISTINCT
  Coordinador,
  Cod_Agente,
  Cod_Cliente,
  Grupo_Familia,
  Marca,
  Cod_Producto
FROM ventas
WHERE
  NULLIF(Coordinador, '') IS NOT NULL
  OR NULLIF(Cod_Agente, '') IS NOT NULL
  OR NULLIF(Cod_Cliente, '') IS NOT NULL
  OR NULLIF(Grupo_Familia, '') IS NOT NULL
  OR NULLIF(Marca, '') IS NOT NULL
  OR NULLIF(Cod_Producto, '') IS NOT NULL;

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

CREATE TABLE state_snapshot_global AS
SELECT
  1 AS singleton,
  COALESCE(SUM(Kilos), 0) AS kilos,
  COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
  COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
  COUNT(*) AS registros
FROM ventas;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ssg_singleton ON state_snapshot_global(singleton);

CREATE TABLE ranking_grupos_global AS
SELECT
  ROW_NUMBER() OVER (ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion,
  name,
  kilos
FROM (
  SELECT
    Grupo_Familia AS name,
    COALESCE(SUM(Kilos), 0) AS kilos
  FROM ventas
  WHERE NULLIF(Grupo_Familia, '') IS NOT NULL
  GROUP BY Grupo_Familia
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rgg_posicion ON ranking_grupos_global(posicion);

CREATE TABLE state_options_month_global AS
SELECT
  YearMonth,
  sort_group,
  kind,
  value,
  codigo,
  nombre
FROM (
  SELECT substr(Fecha, 1, 7) AS YearMonth, 1 AS sort_group, 'coordinador' AS kind, Coordinador AS value, NULL AS codigo, NULL AS nombre
  FROM ventas
  WHERE Fecha IS NOT NULL AND NULLIF(Coordinador, '') IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Coordinador

  UNION ALL

  SELECT substr(v.Fecha, 1, 7) AS YearMonth, 2 AS sort_group, 'agente' AS kind, NULL AS value, v.Cod_Agente AS codigo, MIN(COALESCE(a.Agente, v.Cod_Agente)) AS nombre
  FROM ventas v
  LEFT JOIN agentes_catalogo a ON a.Cod_Agente = v.Cod_Agente
  WHERE v.Fecha IS NOT NULL AND NULLIF(v.Cod_Agente, '') IS NOT NULL
  GROUP BY substr(v.Fecha, 1, 7), v.Cod_Agente

  UNION ALL

  SELECT substr(Fecha, 1, 7) AS YearMonth, 3 AS sort_group, 'grupo' AS kind, Grupo_Familia AS value, NULL AS codigo, NULL AS nombre
  FROM ventas
  WHERE Fecha IS NOT NULL AND NULLIF(Grupo_Familia, '') IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Grupo_Familia

  UNION ALL

  SELECT substr(Fecha, 1, 7) AS YearMonth, 4 AS sort_group, 'marca' AS kind, Marca AS value, NULL AS codigo, NULL AS nombre
  FROM ventas
  WHERE Fecha IS NOT NULL AND NULLIF(Marca, '') IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Marca
);

CREATE INDEX IF NOT EXISTS idx_somg_month_sort ON state_options_month_global(YearMonth, sort_group);
CREATE INDEX IF NOT EXISTS idx_somg_month_kind_value ON state_options_month_global(YearMonth, kind, value, codigo);

CREATE TABLE state_snapshot_month AS
SELECT
  substr(Fecha, 1, 7) AS YearMonth,
  COALESCE(SUM(Kilos), 0) AS kilos,
  COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
  COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
  COUNT(*) AS registros
FROM ventas
WHERE Fecha IS NOT NULL
GROUP BY substr(Fecha, 1, 7);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ssm_month ON state_snapshot_month(YearMonth);

CREATE TABLE ranking_grupos_month AS
SELECT
  YearMonth,
  ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion,
  name,
  kilos
FROM (
  SELECT
    substr(Fecha, 1, 7) AS YearMonth,
    Grupo_Familia AS name,
    COALESCE(SUM(Kilos), 0) AS kilos
  FROM ventas
  WHERE Fecha IS NOT NULL AND NULLIF(Grupo_Familia, '') IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Grupo_Familia
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rgm_month_pos ON ranking_grupos_month(YearMonth, posicion);
CREATE INDEX IF NOT EXISTS idx_rgm_month_name ON ranking_grupos_month(YearMonth, name);

CREATE TABLE insights_rankings_month AS
SELECT YearMonth, kind, posicion, codigo, name, coordinador, agente, kilos
FROM (
  SELECT YearMonth, 'coordinador' AS kind, posicion, NULL AS codigo, name, NULL AS coordinador, NULL AS agente, kilos
  FROM (
    SELECT YearMonth, name, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(Fecha, 1, 7) AS YearMonth, Coordinador AS name, COALESCE(SUM(Kilos), 0) AS kilos
      FROM ventas
      WHERE Fecha IS NOT NULL AND NULLIF(Coordinador, '') IS NOT NULL
      GROUP BY substr(Fecha, 1, 7), Coordinador
    )
  )

  UNION ALL

  SELECT YearMonth, 'agente' AS kind, posicion, NULL AS codigo, name, NULL AS coordinador, NULL AS agente, kilos
  FROM (
    SELECT YearMonth, name, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(v.Fecha, 1, 7) AS YearMonth, MIN(COALESCE(a.Agente, v.Cod_Agente)) AS name, COALESCE(SUM(v.Kilos), 0) AS kilos
      FROM ventas v
      LEFT JOIN agentes_catalogo a ON a.Cod_Agente = v.Cod_Agente
      WHERE v.Fecha IS NOT NULL AND NULLIF(v.Cod_Agente, '') IS NOT NULL
      GROUP BY substr(v.Fecha, 1, 7), v.Cod_Agente
    )
  )

  UNION ALL

  SELECT YearMonth, 'grupo' AS kind, posicion, NULL AS codigo, name, NULL AS coordinador, NULL AS agente, kilos
  FROM (
    SELECT YearMonth, name, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(Fecha, 1, 7) AS YearMonth, Grupo_Familia AS name, COALESCE(SUM(Kilos), 0) AS kilos
      FROM ventas
      WHERE Fecha IS NOT NULL AND NULLIF(Grupo_Familia, '') IS NOT NULL
      GROUP BY substr(Fecha, 1, 7), Grupo_Familia
    )
  )

  UNION ALL

  SELECT YearMonth, 'marca' AS kind, posicion, NULL AS codigo, name, NULL AS coordinador, NULL AS agente, kilos
  FROM (
    SELECT YearMonth, name, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(Fecha, 1, 7) AS YearMonth, Marca AS name, COALESCE(SUM(Kilos), 0) AS kilos
      FROM ventas
      WHERE Fecha IS NOT NULL AND NULLIF(Marca, '') IS NOT NULL
      GROUP BY substr(Fecha, 1, 7), Marca
    )
  )

  UNION ALL

  SELECT YearMonth, 'cliente' AS kind, posicion, codigo, name, coordinador, agente, kilos
  FROM (
    SELECT YearMonth, codigo, name, coordinador, agente, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(Fecha, 1, 7) AS YearMonth, Cod_Cliente AS codigo, MIN(Cliente) AS name, MIN(Coordinador) AS coordinador, MIN(Agente) AS agente, COALESCE(SUM(Kilos), 0) AS kilos
      FROM ventas
      WHERE Fecha IS NOT NULL AND NULLIF(Cod_Cliente, '') IS NOT NULL
      GROUP BY substr(Fecha, 1, 7), Cod_Cliente
    )
  )
  WHERE posicion <= 20
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_irm_month_kind_pos ON insights_rankings_month(YearMonth, kind, posicion);
CREATE INDEX IF NOT EXISTS idx_irm_month_kind_name ON insights_rankings_month(YearMonth, kind, name);
CREATE INDEX IF NOT EXISTS idx_irm_month_kind_code ON insights_rankings_month(YearMonth, kind, codigo);

CREATE TABLE ventas_scope_dim AS
SELECT
  ROW_NUMBER() OVER (
    ORDER BY
      Coordinador COLLATE NOCASE ASC,
      Cod_Agente COLLATE NOCASE ASC,
      Cod_Cliente COLLATE NOCASE ASC,
      Marca COLLATE NOCASE ASC,
      Grupo_Familia COLLATE NOCASE ASC,
      Cod_Producto COLLATE NOCASE ASC
  ) AS scope_id,
  Coordinador,
  Cod_Agente,
  Cod_Cliente,
  Marca,
  Grupo_Familia,
  Cod_Producto
FROM (
  SELECT DISTINCT
    Coordinador,
    Cod_Agente,
    Cod_Cliente,
    Marca,
    Grupo_Familia,
    Cod_Producto
  FROM ventas
  WHERE Fecha IS NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vsd_scope_id ON ventas_scope_dim(scope_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vsd_scope_key ON ventas_scope_dim(Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_vsd_group ON ventas_scope_dim(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_vsd_client_group_prod ON ventas_scope_dim(Cod_Cliente, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_vsd_coord_client ON ventas_scope_dim(Coordinador, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_vsd_coord_agent ON ventas_scope_dim(Coordinador, Cod_Agente);

CREATE TABLE ventas_dia_scope AS
WITH daily_scope_base AS (
  SELECT
    Fecha,
    substr(Fecha, 1, 7) AS YearMonth,
    Coordinador,
    Cod_Agente,
    Cod_Cliente,
    Marca,
    Grupo_Familia,
    Cod_Producto,
    COALESCE(SUM(Kilos), 0) AS Kilos,
    COUNT(*) AS Registros
  FROM ventas
  WHERE Fecha IS NOT NULL
  GROUP BY Fecha, Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto
)
SELECT
  base.Fecha,
  base.YearMonth,
  dim.scope_id,
  base.Kilos,
  base.Registros
FROM daily_scope_base base
JOIN ventas_scope_dim dim
  ON dim.Coordinador IS base.Coordinador
 AND dim.Cod_Agente IS base.Cod_Agente
 AND dim.Cod_Cliente IS base.Cod_Cliente
 AND dim.Marca IS base.Marca
 AND dim.Grupo_Familia IS base.Grupo_Familia
 AND dim.Cod_Producto IS base.Cod_Producto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vds_date_scope_id ON ventas_dia_scope(Fecha, scope_id);
CREATE INDEX IF NOT EXISTS idx_vds_scope_id ON ventas_dia_scope(scope_id);
CREATE INDEX IF NOT EXISTS idx_vds_yearmonth ON ventas_dia_scope(YearMonth);
CREATE INDEX IF NOT EXISTS idx_vds_fecha ON ventas_dia_scope(Fecha);

CREATE TABLE ventas_mes_scope AS
WITH monthly_scope_base AS (
  SELECT
    substr(Fecha, 1, 7) AS YearMonth,
    Coordinador,
    Cod_Agente,
    Cod_Cliente,
    Marca,
    Grupo_Familia,
    Cod_Producto,
    COALESCE(SUM(Kilos), 0) AS Kilos,
    COUNT(*) AS Registros
  FROM ventas
  WHERE Fecha IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto
)
SELECT
  base.YearMonth,
  dim.scope_id,
  base.Kilos,
  base.Registros
FROM monthly_scope_base base
JOIN ventas_scope_dim dim
  ON dim.Coordinador IS base.Coordinador
 AND dim.Cod_Agente IS base.Cod_Agente
 AND dim.Cod_Cliente IS base.Cod_Cliente
 AND dim.Marca IS base.Marca
 AND dim.Grupo_Familia IS base.Grupo_Familia
 AND dim.Cod_Producto IS base.Cod_Producto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vms_month_scope_id ON ventas_mes_scope(YearMonth, scope_id);
CREATE INDEX IF NOT EXISTS idx_vms_scope_id ON ventas_mes_scope(scope_id);
CREATE INDEX IF NOT EXISTS idx_vms_month ON ventas_mes_scope(YearMonth);
"""


def build_historical_support_sql_full():
    return f"""
DROP TABLE IF EXISTS ventas_2025_clientes_catalogo;
DROP TABLE IF EXISTS ventas_2025_productos_catalogo;
DROP TABLE IF EXISTS ventas_2025_snapshot_month;
DROP TABLE IF EXISTS ventas_2025_scope_dim;
DROP TABLE IF EXISTS ventas_2025_mes_scope;

CREATE TABLE ventas_2025_clientes_catalogo AS
SELECT
  Cod_Cliente,
  MIN(Cliente) AS Cliente,
  MIN(Cliente_Search) AS Cliente_Search
FROM ventas_2025
WHERE NULLIF(Cod_Cliente, '') IS NOT NULL
GROUP BY Cod_Cliente;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hcc_codigo ON ventas_2025_clientes_catalogo(Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_hcc_search ON ventas_2025_clientes_catalogo(Cliente_Search);

CREATE TABLE ventas_2025_productos_catalogo AS
SELECT
  Cod_Producto,
  MIN(Producto_Desc) AS Producto_Desc,
  {PRODUCTO_SEARCH_EXPR} AS Producto_Search
FROM ventas_2025
WHERE NULLIF(Cod_Producto, '') IS NOT NULL
GROUP BY Cod_Producto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hpc_codigo ON ventas_2025_productos_catalogo(Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_hpc_search ON ventas_2025_productos_catalogo(Producto_Search);

CREATE TABLE ventas_2025_snapshot_month AS
SELECT
  substr(Fecha, 1, 7) AS YearMonth,
  COALESCE(SUM(Kilos), 0) AS kilos,
  COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
  COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
  COUNT(*) AS registros
FROM ventas_2025
WHERE Fecha IS NOT NULL
GROUP BY substr(Fecha, 1, 7);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v25sm_month ON ventas_2025_snapshot_month(YearMonth);

CREATE TABLE ventas_2025_scope_dim AS
SELECT
  ROW_NUMBER() OVER (
    ORDER BY
      Coordinador COLLATE NOCASE ASC,
      Cod_Agente COLLATE NOCASE ASC,
      Cod_Cliente COLLATE NOCASE ASC,
      Marca COLLATE NOCASE ASC,
      Grupo_Familia COLLATE NOCASE ASC,
      Cod_Producto COLLATE NOCASE ASC
  ) AS scope_id,
  Coordinador,
  Cod_Agente,
  Cod_Cliente,
  Marca,
  Grupo_Familia,
  Cod_Producto
FROM (
  SELECT DISTINCT
    Coordinador,
    Cod_Agente,
    Cod_Cliente,
    Marca,
    Grupo_Familia,
    Cod_Producto
  FROM ventas_2025
  WHERE Fecha IS NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v25sd_scope_id ON ventas_2025_scope_dim(scope_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v25sd_scope_key ON ventas_2025_scope_dim(Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_v25sd_group ON ventas_2025_scope_dim(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_v25sd_client_group_prod ON ventas_2025_scope_dim(Cod_Cliente, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_v25sd_coord_client ON ventas_2025_scope_dim(Coordinador, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_v25sd_coord_agent ON ventas_2025_scope_dim(Coordinador, Cod_Agente);

CREATE TABLE ventas_2025_mes_scope AS
WITH monthly_scope_base AS (
  SELECT
    substr(Fecha, 1, 7) AS YearMonth,
    Coordinador,
    Cod_Agente,
    Cod_Cliente,
    Marca,
    Grupo_Familia,
    Cod_Producto,
    COALESCE(SUM(Kilos), 0) AS Kilos
  FROM ventas_2025
  WHERE Fecha IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto
)
SELECT
  base.YearMonth,
  dim.scope_id,
  base.Kilos
FROM monthly_scope_base base
JOIN ventas_2025_scope_dim dim
  ON dim.Coordinador IS base.Coordinador
 AND dim.Cod_Agente IS base.Cod_Agente
 AND dim.Cod_Cliente IS base.Cod_Cliente
 AND dim.Marca IS base.Marca
 AND dim.Grupo_Familia IS base.Grupo_Familia
 AND dim.Cod_Producto IS base.Cod_Producto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v25ms_month_scope_id ON ventas_2025_mes_scope(YearMonth, scope_id);
CREATE INDEX IF NOT EXISTS idx_v25ms_scope_id ON ventas_2025_mes_scope(scope_id);
"""


def build_runtime_refresh_sql_incremental(affected_months):
    if not affected_months:
        raise ValueError("affected_months no puede estar vacio")
    months_in = sql_list(sorted(set(affected_months)))
    return f"""
DROP TABLE IF EXISTS clientes_catalogo;
DROP TABLE IF EXISTS productos_catalogo;
DROP TABLE IF EXISTS agentes_catalogo;
DROP TABLE IF EXISTS scope_catalogo;
DROP TABLE IF EXISTS state_snapshot_global;
DROP TABLE IF EXISTS ranking_grupos_global;

CREATE TABLE clientes_catalogo AS
SELECT
  Cod_Cliente,
  MIN(Cliente) AS Cliente,
  MIN(Cliente_Search) AS Cliente_Search
FROM ventas
WHERE NULLIF(Cod_Cliente, '') IS NOT NULL
GROUP BY Cod_Cliente;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_codigo ON clientes_catalogo(Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_cc_search ON clientes_catalogo(Cliente_Search);

CREATE TABLE productos_catalogo AS
SELECT
  Cod_Producto,
  MIN(Producto_Desc) AS Producto_Desc,
  {PRODUCTO_SEARCH_EXPR} AS Producto_Search
FROM ventas
WHERE NULLIF(Cod_Producto, '') IS NOT NULL
GROUP BY Cod_Producto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_codigo ON productos_catalogo(Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_pc_search ON productos_catalogo(Producto_Search);

CREATE TABLE agentes_catalogo AS
WITH agent_codes AS (
  SELECT DISTINCT Cod_Agente
  FROM ventas
  WHERE NULLIF(Cod_Agente, '') IS NOT NULL
),
exact_names AS (
  SELECT
    Cod_Agente,
    Agente_Original AS Agente,
    ROW_NUMBER() OVER (
      PARTITION BY Cod_Agente
      ORDER BY COUNT(*) DESC, Agente_Original COLLATE NOCASE ASC
    ) AS rn
  FROM ventas
  WHERE
    NULLIF(Cod_Agente, '') IS NOT NULL
    AND NULLIF(Agente_Original, '') IS NOT NULL
    AND Cod_Agente = COALESCE(NULLIF(Cod_Agente_Original, ''), Cod_Agente)
  GROUP BY Cod_Agente, Agente_Original
),
fallback_names AS (
  SELECT
    Cod_Agente,
    Agente_Original AS Agente,
    ROW_NUMBER() OVER (
      PARTITION BY Cod_Agente
      ORDER BY COUNT(*) DESC, Agente_Original COLLATE NOCASE ASC
    ) AS rn
  FROM ventas
  WHERE NULLIF(Cod_Agente, '') IS NOT NULL AND NULLIF(Agente_Original, '') IS NOT NULL
  GROUP BY Cod_Agente, Agente_Original
)
SELECT
  c.Cod_Agente,
  COALESCE(e.Agente, f.Agente, c.Cod_Agente) AS Agente
FROM agent_codes c
LEFT JOIN exact_names e ON e.Cod_Agente = c.Cod_Agente AND e.rn = 1
LEFT JOIN fallback_names f ON f.Cod_Agente = c.Cod_Agente AND f.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ac_codigo ON agentes_catalogo(Cod_Agente);
CREATE INDEX IF NOT EXISTS idx_ac_nombre ON agentes_catalogo(Agente);

CREATE TABLE scope_catalogo AS
SELECT DISTINCT
  Coordinador,
  Cod_Agente,
  Cod_Cliente,
  Grupo_Familia,
  Marca,
  Cod_Producto
FROM ventas
WHERE
  NULLIF(Coordinador, '') IS NOT NULL
  OR NULLIF(Cod_Agente, '') IS NOT NULL
  OR NULLIF(Cod_Cliente, '') IS NOT NULL
  OR NULLIF(Grupo_Familia, '') IS NOT NULL
  OR NULLIF(Marca, '') IS NOT NULL
  OR NULLIF(Cod_Producto, '') IS NOT NULL;

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

CREATE TABLE state_snapshot_global AS
SELECT
  1 AS singleton,
  COALESCE(SUM(Kilos), 0) AS kilos,
  COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
  COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
  COUNT(*) AS registros
FROM ventas;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ssg_singleton ON state_snapshot_global(singleton);

CREATE TABLE ranking_grupos_global AS
SELECT
  ROW_NUMBER() OVER (ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion,
  name,
  kilos
FROM (
  SELECT
    Grupo_Familia AS name,
    COALESCE(SUM(Kilos), 0) AS kilos
  FROM ventas
  WHERE NULLIF(Grupo_Familia, '') IS NOT NULL
  GROUP BY Grupo_Familia
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rgg_posicion ON ranking_grupos_global(posicion);

CREATE TABLE IF NOT EXISTS state_options_month_global (
  YearMonth TEXT NOT NULL,
  sort_group INTEGER NOT NULL,
  kind TEXT NOT NULL,
  value TEXT,
  codigo TEXT,
  nombre TEXT
);
CREATE INDEX IF NOT EXISTS idx_somg_month_sort ON state_options_month_global(YearMonth, sort_group);
CREATE INDEX IF NOT EXISTS idx_somg_month_kind_value ON state_options_month_global(YearMonth, kind, value, codigo);
DELETE FROM state_options_month_global WHERE YearMonth IN ({months_in});
INSERT INTO state_options_month_global (YearMonth, sort_group, kind, value, codigo, nombre)
SELECT YearMonth, sort_group, kind, value, codigo, nombre
FROM (
  SELECT substr(Fecha, 1, 7) AS YearMonth, 1 AS sort_group, 'coordinador' AS kind, Coordinador AS value, NULL AS codigo, NULL AS nombre
  FROM ventas
  WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in}) AND NULLIF(Coordinador, '') IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Coordinador

  UNION ALL

  SELECT substr(v.Fecha, 1, 7) AS YearMonth, 2 AS sort_group, 'agente' AS kind, NULL AS value, v.Cod_Agente AS codigo, MIN(COALESCE(a.Agente, v.Cod_Agente)) AS nombre
  FROM ventas v
  LEFT JOIN agentes_catalogo a ON a.Cod_Agente = v.Cod_Agente
  WHERE v.Fecha IS NOT NULL AND substr(v.Fecha, 1, 7) IN ({months_in}) AND NULLIF(v.Cod_Agente, '') IS NOT NULL
  GROUP BY substr(v.Fecha, 1, 7), v.Cod_Agente

  UNION ALL

  SELECT substr(Fecha, 1, 7) AS YearMonth, 3 AS sort_group, 'grupo' AS kind, Grupo_Familia AS value, NULL AS codigo, NULL AS nombre
  FROM ventas
  WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in}) AND NULLIF(Grupo_Familia, '') IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Grupo_Familia

  UNION ALL

  SELECT substr(Fecha, 1, 7) AS YearMonth, 4 AS sort_group, 'marca' AS kind, Marca AS value, NULL AS codigo, NULL AS nombre
  FROM ventas
  WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in}) AND NULLIF(Marca, '') IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Marca
);

CREATE TABLE IF NOT EXISTS state_snapshot_month (
  YearMonth TEXT PRIMARY KEY,
  kilos REAL NOT NULL,
  clientes INTEGER NOT NULL,
  agentes INTEGER NOT NULL,
  registros INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ssm_month ON state_snapshot_month(YearMonth);
DELETE FROM state_snapshot_month WHERE YearMonth IN ({months_in});
INSERT INTO state_snapshot_month (YearMonth, kilos, clientes, agentes, registros)
SELECT
  substr(Fecha, 1, 7) AS YearMonth,
  COALESCE(SUM(Kilos), 0) AS kilos,
  COUNT(DISTINCT NULLIF(Cod_Cliente, '')) AS clientes,
  COUNT(DISTINCT NULLIF(Cod_Agente, '')) AS agentes,
  COUNT(*) AS registros
FROM ventas
WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in})
GROUP BY substr(Fecha, 1, 7);

CREATE TABLE IF NOT EXISTS ranking_grupos_month (
  YearMonth TEXT NOT NULL,
  posicion INTEGER NOT NULL,
  name TEXT,
  kilos REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rgm_month_pos ON ranking_grupos_month(YearMonth, posicion);
CREATE INDEX IF NOT EXISTS idx_rgm_month_name ON ranking_grupos_month(YearMonth, name);
DELETE FROM ranking_grupos_month WHERE YearMonth IN ({months_in});
INSERT INTO ranking_grupos_month (YearMonth, posicion, name, kilos)
SELECT
  YearMonth,
  ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion,
  name,
  kilos
FROM (
  SELECT
    substr(Fecha, 1, 7) AS YearMonth,
    Grupo_Familia AS name,
    COALESCE(SUM(Kilos), 0) AS kilos
  FROM ventas
  WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in}) AND NULLIF(Grupo_Familia, '') IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Grupo_Familia
);

CREATE TABLE IF NOT EXISTS insights_rankings_month (
  YearMonth TEXT NOT NULL,
  kind TEXT NOT NULL,
  posicion INTEGER NOT NULL,
  codigo TEXT,
  name TEXT,
  coordinador TEXT,
  agente TEXT,
  kilos REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_irm_month_kind_pos ON insights_rankings_month(YearMonth, kind, posicion);
CREATE INDEX IF NOT EXISTS idx_irm_month_kind_name ON insights_rankings_month(YearMonth, kind, name);
CREATE INDEX IF NOT EXISTS idx_irm_month_kind_code ON insights_rankings_month(YearMonth, kind, codigo);
DELETE FROM insights_rankings_month WHERE YearMonth IN ({months_in});
INSERT INTO insights_rankings_month (YearMonth, kind, posicion, codigo, name, coordinador, agente, kilos)
SELECT YearMonth, kind, posicion, codigo, name, coordinador, agente, kilos
FROM (
  SELECT YearMonth, 'coordinador' AS kind, posicion, NULL AS codigo, name, NULL AS coordinador, NULL AS agente, kilos
  FROM (
    SELECT YearMonth, name, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(Fecha, 1, 7) AS YearMonth, Coordinador AS name, COALESCE(SUM(Kilos), 0) AS kilos
      FROM ventas
      WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in}) AND NULLIF(Coordinador, '') IS NOT NULL
      GROUP BY substr(Fecha, 1, 7), Coordinador
    )
  )

  UNION ALL

  SELECT YearMonth, 'agente' AS kind, posicion, NULL AS codigo, name, NULL AS coordinador, NULL AS agente, kilos
  FROM (
    SELECT YearMonth, name, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(v.Fecha, 1, 7) AS YearMonth, MIN(COALESCE(a.Agente, v.Cod_Agente)) AS name, COALESCE(SUM(v.Kilos), 0) AS kilos
      FROM ventas v
      LEFT JOIN agentes_catalogo a ON a.Cod_Agente = v.Cod_Agente
      WHERE v.Fecha IS NOT NULL AND substr(v.Fecha, 1, 7) IN ({months_in}) AND NULLIF(v.Cod_Agente, '') IS NOT NULL
      GROUP BY substr(v.Fecha, 1, 7), v.Cod_Agente
    )
  )

  UNION ALL

  SELECT YearMonth, 'grupo' AS kind, posicion, NULL AS codigo, name, NULL AS coordinador, NULL AS agente, kilos
  FROM (
    SELECT YearMonth, name, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(Fecha, 1, 7) AS YearMonth, Grupo_Familia AS name, COALESCE(SUM(Kilos), 0) AS kilos
      FROM ventas
      WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in}) AND NULLIF(Grupo_Familia, '') IS NOT NULL
      GROUP BY substr(Fecha, 1, 7), Grupo_Familia
    )
  )

  UNION ALL

  SELECT YearMonth, 'marca' AS kind, posicion, NULL AS codigo, name, NULL AS coordinador, NULL AS agente, kilos
  FROM (
    SELECT YearMonth, name, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(Fecha, 1, 7) AS YearMonth, Marca AS name, COALESCE(SUM(Kilos), 0) AS kilos
      FROM ventas
      WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in}) AND NULLIF(Marca, '') IS NOT NULL
      GROUP BY substr(Fecha, 1, 7), Marca
    )
  )

  UNION ALL

  SELECT YearMonth, 'cliente' AS kind, posicion, codigo, name, coordinador, agente, kilos
  FROM (
    SELECT YearMonth, codigo, name, coordinador, agente, kilos, ROW_NUMBER() OVER (PARTITION BY YearMonth ORDER BY kilos DESC, name COLLATE NOCASE ASC) AS posicion
    FROM (
      SELECT substr(Fecha, 1, 7) AS YearMonth, Cod_Cliente AS codigo, MIN(Cliente) AS name, MIN(Coordinador) AS coordinador, MIN(Agente) AS agente, COALESCE(SUM(Kilos), 0) AS kilos
      FROM ventas
      WHERE Fecha IS NOT NULL AND substr(Fecha, 1, 7) IN ({months_in}) AND NULLIF(Cod_Cliente, '') IS NOT NULL
      GROUP BY substr(Fecha, 1, 7), Cod_Cliente
    )
  )
  WHERE posicion <= 20
);

DROP TABLE IF EXISTS ventas_scope_dim;
DROP TABLE IF EXISTS ventas_dia_scope;
DROP TABLE IF EXISTS ventas_mes_scope;

CREATE TABLE ventas_scope_dim AS
SELECT
  ROW_NUMBER() OVER (
    ORDER BY
      Coordinador COLLATE NOCASE ASC,
      Cod_Agente COLLATE NOCASE ASC,
      Cod_Cliente COLLATE NOCASE ASC,
      Marca COLLATE NOCASE ASC,
      Grupo_Familia COLLATE NOCASE ASC,
      Cod_Producto COLLATE NOCASE ASC
  ) AS scope_id,
  Coordinador,
  Cod_Agente,
  Cod_Cliente,
  Marca,
  Grupo_Familia,
  Cod_Producto
FROM (
  SELECT DISTINCT
    Coordinador,
    Cod_Agente,
    Cod_Cliente,
    Marca,
    Grupo_Familia,
    Cod_Producto
  FROM ventas
  WHERE Fecha IS NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vsd_scope_id ON ventas_scope_dim(scope_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vsd_scope_key ON ventas_scope_dim(Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_vsd_group ON ventas_scope_dim(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_vsd_client_group_prod ON ventas_scope_dim(Cod_Cliente, Grupo_Familia, Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_vsd_coord_client ON ventas_scope_dim(Coordinador, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_vsd_coord_agent ON ventas_scope_dim(Coordinador, Cod_Agente);

CREATE TABLE ventas_dia_scope AS
WITH daily_scope_base AS (
  SELECT
    Fecha,
    substr(Fecha, 1, 7) AS YearMonth,
    Coordinador,
    Cod_Agente,
    Cod_Cliente,
    Marca,
    Grupo_Familia,
    Cod_Producto,
    COALESCE(SUM(Kilos), 0) AS Kilos,
    COUNT(*) AS Registros
  FROM ventas
  WHERE Fecha IS NOT NULL
  GROUP BY Fecha, Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto
)
SELECT
  base.Fecha,
  base.YearMonth,
  dim.scope_id,
  base.Kilos,
  base.Registros
FROM daily_scope_base base
JOIN ventas_scope_dim dim
  ON dim.Coordinador IS base.Coordinador
 AND dim.Cod_Agente IS base.Cod_Agente
 AND dim.Cod_Cliente IS base.Cod_Cliente
 AND dim.Marca IS base.Marca
 AND dim.Grupo_Familia IS base.Grupo_Familia
 AND dim.Cod_Producto IS base.Cod_Producto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vds_date_scope_id ON ventas_dia_scope(Fecha, scope_id);
CREATE INDEX IF NOT EXISTS idx_vds_scope_id ON ventas_dia_scope(scope_id);
CREATE INDEX IF NOT EXISTS idx_vds_yearmonth ON ventas_dia_scope(YearMonth);
CREATE INDEX IF NOT EXISTS idx_vds_fecha ON ventas_dia_scope(Fecha);

CREATE TABLE ventas_mes_scope AS
WITH monthly_scope_base AS (
  SELECT
    substr(Fecha, 1, 7) AS YearMonth,
    Coordinador,
    Cod_Agente,
    Cod_Cliente,
    Marca,
    Grupo_Familia,
    Cod_Producto,
    COALESCE(SUM(Kilos), 0) AS Kilos,
    COUNT(*) AS Registros
  FROM ventas
  WHERE Fecha IS NOT NULL
  GROUP BY substr(Fecha, 1, 7), Coordinador, Cod_Agente, Cod_Cliente, Marca, Grupo_Familia, Cod_Producto
)
SELECT
  base.YearMonth,
  dim.scope_id,
  base.Kilos,
  base.Registros
FROM monthly_scope_base base
JOIN ventas_scope_dim dim
  ON dim.Coordinador IS base.Coordinador
 AND dim.Cod_Agente IS base.Cod_Agente
 AND dim.Cod_Cliente IS base.Cod_Cliente
 AND dim.Marca IS base.Marca
 AND dim.Grupo_Familia IS base.Grupo_Familia
 AND dim.Cod_Producto IS base.Cod_Producto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vms_month_scope_id ON ventas_mes_scope(YearMonth, scope_id);
CREATE INDEX IF NOT EXISTS idx_vms_scope_id ON ventas_mes_scope(scope_id);
CREATE INDEX IF NOT EXISTS idx_vms_month ON ventas_mes_scope(YearMonth);
"""
