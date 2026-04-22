-- migracion_v22.sql
-- Índices de soporte para detalle paginado e insights filtrados

CREATE INDEX IF NOT EXISTS idx_detail_core_v
ON ventas(Fecha DESC, Cod_Cliente, Grupo_Familia, Cod_Producto, Kilos);

CREATE INDEX IF NOT EXISTS idx_insights_coord_fecha_v
ON ventas(Coordinador, Fecha, Grupo_Familia, Kilos);

CREATE INDEX IF NOT EXISTS idx_insights_agente_fecha_v
ON ventas(Cod_Agente, Fecha, Grupo_Familia, Kilos);
