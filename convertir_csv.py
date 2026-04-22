#!/usr/bin/env python3
# =============================================================
# convertir_csv.py
# Convierte VENTAS_DIARIAS.csv y BBDD_2025.csv a ventas_import.sql para D1.
#
# Fase 8:
# - recrea ventas (dataset vigente)
# - incorpora ventas_2025 para comparativo historico mensual
# - reconstruye catalogos runtime (clientes, productos, agentes)
# - materializa scope_catalogo para filtros sin fecha
# - genera state_snapshot_global y ranking_grupos_global para fast path global
# - genera state_options_month_global, state_snapshot_month y ranking_grupos_month para fast path mensual
# - genera insights_rankings_month para evitar agregaciones mensuales pesadas en /api/insights
# - compacta el scope historico 2025 en una dimension reutilizable + snapshot mensual
# - mantiene dataset_metadata ampliado y dataset_load_log para trazabilidad
# =============================================================

import csv
import hashlib
import os
import re
from datetime import datetime, timezone
import unicodedata

from runtime_sql import build_historical_support_sql_full, build_runtime_refresh_sql_full

CURRENT_INPUT_FILE = "VENTAS_DIARIAS.csv"
HISTORICAL_INPUT_FILE = "BBDD_2025.csv"
OUTPUT_FILE = "ventas_import.sql"
BATCH_SIZE = 100

SALES_COLUMNS = [
    "Fecha",
    "Cod_Cliente",
    "Cliente",
    "Cliente_Search",
    "Cod_Agente",
    "Cod_Agente_Original",
    "Nuevo_Agente",
    "Agente",
    "Agente_Original",
    "Coordinador",
    "Marca",
    "Kilos",
    "Grupo_Familia",
    "Producto_Desc",
    "Cod_Producto",
]


def parse_fecha(valor):
    try:
        return datetime.strptime(str(valor).strip(), "%Y%m%d").strftime("%Y-%m-%d")
    except Exception:
        return None



def parse_kilos(valor):
    try:
        return float(str(valor).strip().replace(",", "."))
    except Exception:
        return None


def normalize_agent_code(valor):
    s = str(valor or "").strip()
    if not s:
        return ""
    if re.fullmatch(r"[+-]?\d+\.0+", s):
        s = s.split(".", 1)[0]
    return s


def resolve_operational_agent_code(row):
    nuevo = normalize_agent_code(row.get("NUEVO_AGENTE", ""))
    original = normalize_agent_code(row.get("AGTVE", ""))
    return nuevo or original, original, nuevo


def resolve_agent_name_raw(row):
    return str(row.get("NOMBRE AGTVE", row.get("NOMBRE_AGTVE", ""))).strip()


def apply_canonical_agent_names(rows):
    canonical_exact = {}
    canonical_fallback = {}

    from collections import Counter, defaultdict

    exact_counters = defaultdict(Counter)
    fallback_counters = defaultdict(Counter)

    for row in rows:
        operative = str(row.get("Cod_Agente", "")).strip()
        original = str(row.get("Cod_Agente_Original", "")).strip()
        raw_name = str(row.get("Agente_Original", "")).strip()
        if not operative or not raw_name:
            continue
        fallback_counters[operative][raw_name] += 1
        if operative == original:
            exact_counters[operative][raw_name] += 1

    for code, counter in exact_counters.items():
        if counter:
            canonical_exact[code] = counter.most_common(1)[0][0]
    for code, counter in fallback_counters.items():
        if counter:
            canonical_fallback[code] = counter.most_common(1)[0][0]

    for row in rows:
        operative = str(row.get("Cod_Agente", "")).strip()
        row["Agente"] = canonical_exact.get(operative) or canonical_fallback.get(operative) or operative

    return rows

def normalize_search(valor: str) -> str:
    s = str(valor or "").strip().lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"\s+", " ", s).strip()
    return s



def escape_sql(valor):
    if valor is None or str(valor).strip() == "":
        return "NULL"
    return "'" + str(valor).replace("'", "''").strip() + "'"



def file_md5(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()



def resolve_cod_cliente(row):
    return (
        row.get("NºCLIE")
        or row.get("N_CLIE")
        or row.get("NùCLIE")
        or row.get("NúCLIE")
        or ""
    )



def resolve_nombre_cliente(row):
    return (
        row.get("NOMBRE CLIE.")
        or row.get("NOMBRE_CLIE")
        or row.get("NOMBRE_CLIE_")
        or ""
    )



def resolve_cod_producto(row):
    return (
        row.get("COD.PROD.")
        or row.get("COD_PROD")
        or row.get("COD_PROD_")
        or ""
    )



def load_dataset(path, dataset_name):
    if not os.path.exists(path):
        print(f"ERROR: No se encontro el archivo '{path}'")
        raise SystemExit(1)

    print(f"Leyendo {path} ({dataset_name})...")

    rows = []
    filas_error = 0
    clientes_unicos = set()
    productos_unicos = set()
    fechas_validas = []

    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")

        for row in reader:
            fecha = parse_fecha(row.get("HASTA", ""))
            if not fecha:
                filas_error += 1
                continue

            kilos = parse_kilos(row.get("IMPOR", "0"))
            if kilos is None:
                filas_error += 1
                continue

            cod_cliente = str(resolve_cod_cliente(row)).strip()
            cliente = str(resolve_nombre_cliente(row)).strip()
            cod_prod = str(resolve_cod_producto(row)).strip()
            producto_desc = str(row.get("PRODUCTO", "")).strip()

            cod_agente_operativo, cod_agente_original, nuevo_agente = resolve_operational_agent_code(row)
            agente_original = resolve_agent_name_raw(row)

            rows.append(
                {
                    "Fecha": fecha,
                    "Cod_Cliente": cod_cliente,
                    "Cliente": cliente,
                    "Cliente_Search": normalize_search(cliente),
                    "Cod_Agente": cod_agente_operativo,
                    "Cod_Agente_Original": cod_agente_original,
                    "Nuevo_Agente": nuevo_agente,
                    "Agente": agente_original,
                    "Agente_Original": agente_original,
                    "Coordinador": str(row.get("COORDINADOR", "")).strip(),
                    "Marca": str(row.get("MARCA", "")).strip(),
                    "Kilos": kilos,
                    "Grupo_Familia": str(row.get("GRUPO DE FAMILIA", row.get("GRUPO_DE_FAMILIA", ""))).strip(),
                    "Region": str(row.get("REGION", row.get("REGION_", ""))).strip(),
                    "Producto_Desc": producto_desc,
                    "Cod_Producto": cod_prod,
                }
            )

            fechas_validas.append(fecha)
            if cod_cliente:
                clientes_unicos.add(cod_cliente)
            if cod_prod:
                productos_unicos.add(cod_prod)

    rows = apply_canonical_agent_names(rows)

    total = len(rows)
    print(f"  -> {total:,} filas validas procesadas")
    if filas_error > 0:
        print(f"  -> {filas_error:,} filas omitidas (fecha o kilos invalidos)")

    if total == 0:
        print(f"ERROR: No se procesaron filas para {dataset_name}.")
        raise SystemExit(1)

    min_fecha = min(fechas_validas) if fechas_validas else None
    max_fecha = max(fechas_validas) if fechas_validas else None
    clientes_total = len(clientes_unicos)
    productos_total = len(productos_unicos)

    print(f"  -> clientes unicos:  {clientes_total:,}")
    print(f"  -> productos unicos: {productos_total:,}")
    print(f"  -> rango fechas:     {min_fecha} a {max_fecha}")

    return {
        "name": dataset_name,
        "path": path,
        "rows": rows,
        "rows_total": total,
        "rows_skipped": filas_error,
        "min_fecha": min_fecha,
        "max_fecha": max_fecha,
        "clientes_total": clientes_total,
        "productos_total": productos_total,
    }



def write_sales_table_schema(fh, table_name):
    fh.write(
        f"""CREATE TABLE {table_name} (
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

"""
    )



def write_sales_rows(fh, table_name, rows):
    total = len(rows)
    lotes_escritos = 0

    for i in range(0, total, BATCH_SIZE):
        lote = rows[i : i + BATCH_SIZE]
        valores = []

        for r in lote:
            valores.append(
                f"  ({escape_sql(r['Fecha'])}, "
                f"{escape_sql(r['Cod_Cliente'])}, "
                f"{escape_sql(r['Cliente'])}, "
                f"{escape_sql(r['Cliente_Search'])}, "
                f"{escape_sql(r['Cod_Agente'])}, "
                f"{escape_sql(r['Cod_Agente_Original'])}, "
                f"{escape_sql(r['Nuevo_Agente'])}, "
                f"{escape_sql(r['Agente'])}, "
                f"{escape_sql(r['Agente_Original'])}, "
                f"{escape_sql(r['Coordinador'])}, "
                f"{escape_sql(r['Marca'])}, "
                f"{r['Kilos']}, "
                f"{escape_sql(r['Grupo_Familia'])}, "
                f"{escape_sql(r.get('Region',''))}, "
                f"{escape_sql(r['Producto_Desc'])}, "
                f"{escape_sql(r['Cod_Producto'])})"
            )

        fh.write(
            f"INSERT INTO {table_name} "
            "(Fecha, Cod_Cliente, Cliente, Cliente_Search, Cod_Agente, Cod_Agente_Original, Nuevo_Agente, Agente, Agente_Original, "
            "Coordinador, Marca, Kilos, Grupo_Familia, Region, Producto_Desc, Cod_Producto) "
            "VALUES\n"
        )
        fh.write(",\n".join(valores))
        fh.write(";\n\n")
        lotes_escritos += 1

        if lotes_escritos % 10 == 0:
            procesadas = min(i + BATCH_SIZE, total)
            print(f"  {table_name}: {procesadas:,} / {total:,} filas escritas...")



def write_sales_indexes(fh, table_name, suffix):
    fh.write(
        f"""
CREATE INDEX IF NOT EXISTS idx_fecha_{suffix}               ON {table_name}(Fecha);
CREATE INDEX IF NOT EXISTS idx_coord_{suffix}               ON {table_name}(Coordinador);
CREATE INDEX IF NOT EXISTS idx_agente_{suffix}              ON {table_name}(Cod_Agente);
CREATE INDEX IF NOT EXISTS idx_agente_original_{suffix}     ON {table_name}(Cod_Agente_Original);
CREATE INDEX IF NOT EXISTS idx_nuevo_agente_{suffix}        ON {table_name}(Nuevo_Agente);
CREATE INDEX IF NOT EXISTS idx_cliente_{suffix}             ON {table_name}(Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_grupo_{suffix}               ON {table_name}(Grupo_Familia);
CREATE INDEX IF NOT EXISTS idx_marca_{suffix}               ON {table_name}(Marca);
CREATE INDEX IF NOT EXISTS idx_codprod_{suffix}             ON {table_name}(Cod_Producto);
CREATE INDEX IF NOT EXISTS idx_cliente_search_{suffix}      ON {table_name}(Cliente_Search);
CREATE INDEX IF NOT EXISTS idx_coord_fecha_{suffix}         ON {table_name}(Coordinador, Fecha);
CREATE INDEX IF NOT EXISTS idx_agente_fecha_{suffix}        ON {table_name}(Cod_Agente, Fecha);
CREATE INDEX IF NOT EXISTS idx_cliente_fecha_{suffix}       ON {table_name}(Cod_Cliente, Fecha);
CREATE INDEX IF NOT EXISTS idx_grupo_fecha_{suffix}         ON {table_name}(Grupo_Familia, Fecha);
CREATE INDEX IF NOT EXISTS idx_marca_fecha_{suffix}         ON {table_name}(Marca, Fecha);
CREATE INDEX IF NOT EXISTS idx_region_{suffix}               ON {table_name}(Region);
CREATE INDEX IF NOT EXISTS idx_codprod_fecha_{suffix}       ON {table_name}(Cod_Producto, Fecha);
CREATE INDEX IF NOT EXISTS idx_cliente_search_code_{suffix} ON {table_name}(Cliente_Search, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_coord_fecha_cliente_{suffix} ON {table_name}(Coordinador, Fecha, Cod_Cliente);
CREATE INDEX IF NOT EXISTS idx_agente_fecha_cliente_{suffix} ON {table_name}(Cod_Agente, Fecha, Cod_Cliente);

"""
    )



def main():
    current = load_dataset(CURRENT_INPUT_FILE, "dataset vigente")
    historical = load_dataset(HISTORICAL_INPUT_FILE, "historico 2025")

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data_version = (
        f"{file_md5(CURRENT_INPUT_FILE)[:8]}-"
        f"{file_md5(HISTORICAL_INPUT_FILE)[:8]}-"
        f"{generated_at.replace('-', '').replace(':', '')}"
    )

    print(f"  -> data version combinada: {data_version}")
    print(f"\nGenerando {OUTPUT_FILE}...")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        fh.write(
            f"""-- ============================================================
-- ventas_import.sql
-- Generado por convertir_csv.py
-- Dataset vigente: {current['rows_total']:,} filas ({CURRENT_INPUT_FILE})
-- Historico 2025:  {historical['rows_total']:,} filas ({HISTORICAL_INPUT_FILE})
-- Data version: {data_version}
-- ============================================================

DROP TABLE IF EXISTS ventas;
DROP TABLE IF EXISTS ventas_2025;
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

"""
        )

        write_sales_table_schema(fh, "ventas")
        write_sales_rows(fh, "ventas", current["rows"])
        write_sales_table_schema(fh, "ventas_2025")
        write_sales_rows(fh, "ventas_2025", historical["rows"])

        write_sales_indexes(fh, "ventas", "v")
        write_sales_indexes(fh, "ventas_2025", "v2025")

        fh.write(build_runtime_refresh_sql_full())
        fh.write(build_historical_support_sql_full())

        fh.write(
            f"""
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

INSERT INTO dataset_metadata (
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
) VALUES (
  1,
  {escape_sql(data_version)},
  {escape_sql(generated_at)},
  {escape_sql(f"{CURRENT_INPUT_FILE} + {HISTORICAL_INPUT_FILE}")},
  {current['rows_total']},
  {current['rows_skipped']},
  {escape_sql(current['min_fecha'])},
  {escape_sql(current['max_fecha'])},
  {current['clientes_total']},
  {current['productos_total']},
  'full',
  {escape_sql(CURRENT_INPUT_FILE)},
  {current['rows_total'] + current['rows_skipped']},
  {current['rows_total']},
  {current['rows_skipped']},
  NULL,
  NULL,
  {escape_sql(HISTORICAL_INPUT_FILE)},
  {historical['rows_total']}
);

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
) VALUES (
  'full',
  {escape_sql(generated_at)},
  {escape_sql(f"{CURRENT_INPUT_FILE} + {HISTORICAL_INPUT_FILE}")},
  {current['rows_total'] + current['rows_skipped']},
  {current['rows_total']},
  {current['rows_skipped']},
  {escape_sql(current['min_fecha'])},
  {escape_sql(current['max_fecha'])},
  NULL,
  {escape_sql(data_version)},
  'Rebuild completo vigente + historico 2025'
);

PRAGMA optimize;
"""
        )

    size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print("\n" + "=" * 56)
    print("LISTO")
    print("=" * 56)
    print(f"Archivo generado: {OUTPUT_FILE}")
    print(f"Tamano:           {size_mb:.1f} MB")
    print(f"Ventas vigentes:  {current['rows_total']:,}")
    print(f"Historico 2025:   {historical['rows_total']:,}")
    print(f"Clientes vigentes:{current['clientes_total']:,}")
    print(f"Productos vigentes:{current['productos_total']:,}")
    print(f"Data version:     {data_version}")
    print("=" * 56)


if __name__ == "__main__":
    main()
