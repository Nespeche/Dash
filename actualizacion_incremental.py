# =============================================================
# actualizacion_incremental.py
# Genera ventas_incremental.sql para aplicar deltas 2026 sobre D1.
#
# Seguridad / idempotencia:
# - el CSV incremental contiene una o varias fechas completas del dataset vigente
# - esas fechas reemplazan por completo lo que exista en D1 para esos dias
# - si se intenta ejecutar dos veces el mismo incremental, NO duplica datos
#   porque primero borra por fecha y luego inserta
# - ademas genera una firma deterministica para que el .bat pueda saltear
#   una segunda ejecucion identica antes de tocar D1
# - el propio SQL evita duplicar la fila en dataset_load_log
#
# Nota de compatibilidad D1:
# - no usar BEGIN/COMMIT explicitos en wrangler d1 execute --remote
# - no usar CREATE TEMP TABLE en el SQL incremental remoto
# =============================================================

import hashlib
import os
from datetime import datetime, timezone

from convertir_csv import escape_sql, file_md5, load_dataset, write_sales_rows
from runtime_sql import build_runtime_refresh_sql_incremental

INCREMENTAL_INPUT_FILE = "VENTAS_DIARIAS_INCREMENTAL.csv"
OUTPUT_FILE = "ventas_incremental.sql"
FINGERPRINT_FILE = "ventas_incremental_fingerprint.txt"
NOTE_FILE = "ventas_incremental_note.txt"
EXPECTED_YEAR = "2026"


def sql_list(values):
    return ", ".join(escape_sql(v) for v in values)



def ensure_incremental_scope(rows):
    fechas = sorted({str(r["Fecha"]) for r in rows if r.get("Fecha")})
    if not fechas:
        print("ERROR: El incremental no contiene fechas validas.")
        raise SystemExit(1)

    invalid = [f for f in fechas if not f.startswith(f"{EXPECTED_YEAR}-")]
    if invalid:
        print("ERROR: El incremental contiene fechas fuera de 2026:")
        for f in invalid[:10]:
            print(f"  - {f}")
        raise SystemExit(1)

    return fechas



def compute_execution_fingerprint(csv_path, fechas, rows_total, rows_skipped):
    base = "|".join(
        [
            file_md5(csv_path),
            ",".join(fechas),
            str(rows_total),
            str(rows_skipped),
        ]
    )
    return hashlib.md5(base.encode("utf-8")).hexdigest()[:16]



def build_execution_note(fingerprint, min_fecha, max_fecha, rows_total, months):
    months_text = ",".join(months)
    return f"fingerprint:{fingerprint}|desde:{min_fecha}|hasta:{max_fecha}|rows:{rows_total}|months:{months_text}"


def derive_affected_months(fechas):
    return sorted({str(f)[:7] for f in fechas if str(f)[:7]})


def main():
    if not os.path.exists(INCREMENTAL_INPUT_FILE):
        print(f"ERROR: No se encontro el archivo '{INCREMENTAL_INPUT_FILE}'")
        raise SystemExit(1)

    current = load_dataset(INCREMENTAL_INPUT_FILE, "incremental vigente 2026")
    fechas = ensure_incremental_scope(current["rows"])
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fingerprint = compute_execution_fingerprint(
        INCREMENTAL_INPUT_FILE,
        fechas,
        current["rows_total"],
        current["rows_skipped"],
    )
    affected_months = derive_affected_months(fechas)
    note = build_execution_note(
        fingerprint,
        min(fechas),
        max(fechas),
        current["rows_total"],
        affected_months,
    )
    data_version = f"inc-{fingerprint}-{generated_at.replace('-', '').replace(':', '')}"
    affected_dates = ", ".join(fechas)
    affected_months_text = ", ".join(affected_months)
    min_fecha = min(fechas)
    max_fecha = max(fechas)

    print(f"  -> fechas afectadas: {affected_dates}")
    print(f"  -> meses afectados: {affected_months_text}")
    print(f"  -> fingerprint:      {fingerprint}")
    print(f"  -> nota de control:  {note}")
    print(f"  -> data version:     {data_version}")
    print(f"\nGenerando {OUTPUT_FILE}...")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        fh.write(
            f"""-- ============================================================
-- ventas_incremental.sql
-- Generado por actualizacion_incremental.py
-- Incremental vigente: {current['rows_total']:,} filas ({INCREMENTAL_INPUT_FILE})
-- Fechas afectadas: {affected_dates}
-- Meses afectados: {affected_months_text}
-- Fingerprint: {fingerprint}
-- Control note: {note}
-- Data version incremental: {data_version}
-- Compatibilidad D1 remoto:
--   * sin BEGIN/COMMIT explicitos
--   * sin CREATE TEMP TABLE
-- ============================================================

DELETE FROM ventas
WHERE Fecha IN ({sql_list(fechas)});

"""
        )
        write_sales_rows(fh, "ventas", current["rows"])
        fh.write("\n")
        fh.write(build_runtime_refresh_sql_incremental(affected_months))
        fh.write(
            f"""
UPDATE dataset_metadata
SET
  data_version = {escape_sql(data_version)},
  generated_at_utc = {escape_sql(generated_at)},
  source_file = {escape_sql(INCREMENTAL_INPUT_FILE)},
  rows_total = (SELECT COUNT(*) FROM ventas),
  rows_skipped = {current['rows_skipped']},
  min_fecha = (SELECT MIN(Fecha) FROM ventas),
  max_fecha = (SELECT MAX(Fecha) FROM ventas),
  clientes_total = (SELECT COUNT(DISTINCT NULLIF(Cod_Cliente, '')) FROM ventas),
  productos_total = (SELECT COUNT(DISTINCT NULLIF(Cod_Producto, '')) FROM ventas),
  load_mode = 'incremental',
  last_source_file = {escape_sql(INCREMENTAL_INPUT_FILE)},
  last_rows_in_file = {current['rows_total'] + current['rows_skipped']},
  last_rows_inserted = {current['rows_total']},
  last_rows_skipped = {current['rows_skipped']},
  last_delta_min_fecha = {escape_sql(min_fecha)},
  last_delta_max_fecha = {escape_sql(max_fecha)},
  historical_source_file = COALESCE(historical_source_file, 'BBDD_2025.csv'),
  historical_rows_total = COALESCE(historical_rows_total, (SELECT COUNT(*) FROM ventas_2025))
WHERE singleton = 1;

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
  'incremental',
  {escape_sql(generated_at)},
  {escape_sql(INCREMENTAL_INPUT_FILE)},
  {current['rows_total'] + current['rows_skipped']},
  {current['rows_total']},
  {current['rows_skipped']},
  {escape_sql(min_fecha)},
  {escape_sql(max_fecha)},
  {escape_sql(affected_dates)},
  {escape_sql(data_version)},
  {escape_sql(note)}
WHERE NOT EXISTS (
  SELECT 1
  FROM dataset_load_log
  WHERE load_mode = 'incremental'
    AND notes = {escape_sql(note)}
);
"""
        )

    with open(FINGERPRINT_FILE, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(fingerprint + "\n")

    with open(NOTE_FILE, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(note + "\n")

    size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print("\n" + "=" * 56)
    print("LISTO")
    print("=" * 56)
    print(f"Archivo generado:   {OUTPUT_FILE}")
    print(f"Tamano:             {size_mb:.1f} MB")
    print(f"Filas incremental:  {current['rows_total']:,}")
    print(f"Fechas afectadas:   {affected_dates}")
    print(f"Meses afectados:    {affected_months_text}")
    print(f"Fingerprint:        {fingerprint}")
    print(f"Archivo fingerprint:{FINGERPRINT_FILE}")
    print(f"Archivo note:       {NOTE_FILE}")
    print("=" * 56)


if __name__ == "__main__":
    main()
