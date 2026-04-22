@echo off
setlocal EnableExtensions

REM =============================================================
REM actualizar_d1_full.bat
REM Reconstruccion completa de D1 desde VENTAS_DIARIAS.csv + BBDD_2025.csv
REM =============================================================

set "BASE_DIR=%~dp0"
cd /d "%BASE_DIR%"

set "DB_NAME=ventas-d1-proyeccion-v2"
set "CSV_NAME=VENTAS_DIARIAS.csv"
set "HIST_CSV_NAME=BBDD_2025.csv"
set "PYTHON_SCRIPT=convertir_csv.py"
set "SQL_FILE=ventas_import.sql"

call :resolve_python
if errorlevel 1 goto :error

if not exist "%CSV_NAME%" (
  echo ERROR: No se encontro %CSV_NAME%
  goto :error
)

if not exist "%HIST_CSV_NAME%" (
  echo ERROR: No se encontro %HIST_CSV_NAME%
  goto :error
)

if not exist "%PYTHON_SCRIPT%" (
  echo ERROR: No se encontro %PYTHON_SCRIPT%
  goto :error
)

echo.
echo ==========================================
echo MODO FULL - reconstruccion completa
echo ==========================================

echo.
echo 1^) Generando SQL desde los CSV...
call %PY_EXE% "%PYTHON_SCRIPT%"
if errorlevel 1 goto :error

echo.
echo 2^) Importando en Cloudflare D1...
call npx wrangler d1 execute "%DB_NAME%" --remote --file="%SQL_FILE%" --yes
if errorlevel 1 goto :error

echo.
echo 3^) Validando ventas vigentes y metadata...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT (SELECT data_version FROM dataset_metadata LIMIT 1) AS data_version, (SELECT rows_total FROM dataset_metadata LIMIT 1) AS meta_rows, (SELECT COUNT(*) FROM ventas) AS ventas_rows, (SELECT rows_skipped FROM dataset_metadata LIMIT 1) AS meta_rows_skipped, (SELECT min_fecha FROM dataset_metadata LIMIT 1) AS meta_desde, (SELECT MIN(Fecha) FROM ventas) AS ventas_desde, (SELECT max_fecha FROM dataset_metadata LIMIT 1) AS meta_hasta, (SELECT MAX(Fecha) FROM ventas) AS ventas_hasta, ROUND((SELECT SUM(Kilos) FROM ventas), 0) AS kilos;"
if errorlevel 1 goto :error

echo.
echo 4^) Validando historico 2025...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT COUNT(*) AS ventas_2025_rows, MIN(Fecha) AS ventas_2025_desde, MAX(Fecha) AS ventas_2025_hasta, ROUND(COALESCE(SUM(Kilos), 0), 0) AS ventas_2025_kilos FROM ventas_2025;"
if errorlevel 1 goto :error

echo.
echo 5^) Validando catalogos y materializados runtime...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT (SELECT clientes_total FROM dataset_metadata LIMIT 1) AS meta_clientes, (SELECT COUNT(*) FROM clientes_catalogo) AS catalogo_clientes, (SELECT productos_total FROM dataset_metadata LIMIT 1) AS meta_productos, (SELECT COUNT(*) FROM productos_catalogo) AS catalogo_productos, (SELECT COUNT(*) FROM agentes_catalogo) AS catalogo_agentes, (SELECT COUNT(*) FROM scope_catalogo) AS scope_rows, (SELECT COUNT(*) FROM state_snapshot_global) AS snapshot_rows, (SELECT COUNT(*) FROM ranking_grupos_global) AS ranking_grupos_rows, (SELECT COUNT(*) FROM state_options_month_global) AS state_options_month_rows, (SELECT COUNT(*) FROM state_snapshot_month) AS state_snapshot_month_rows, (SELECT COUNT(*) FROM ranking_grupos_month) AS ranking_grupos_month_rows, (SELECT COUNT(*) FROM insights_rankings_month) AS insights_rankings_month_rows, (SELECT COUNT(*) FROM ventas_scope_dim) AS current_scope_dim_rows, (SELECT COUNT(*) FROM ventas_dia_scope) AS current_day_scope_rows, (SELECT COUNT(*) FROM ventas_mes_scope) AS current_scope_rows, (SELECT COUNT(*) FROM ventas_2025_snapshot_month) AS hist_snapshot_month_rows, (SELECT COUNT(*) FROM ventas_2025_scope_dim) AS hist_scope_dim_rows, (SELECT COUNT(*) FROM ventas_2025_clientes_catalogo) AS hist_clientes_rows, (SELECT COUNT(*) FROM ventas_2025_productos_catalogo) AS hist_productos_rows, (SELECT COUNT(*) FROM ventas_2025_mes_scope) AS hist_scope_rows;"
if errorlevel 1 goto :error

echo.
echo 6^) Recomendado: si el entorno no tiene auditoria liviana, aplicar migracion_v9.sql una sola vez.

goto :success

:resolve_python
set "PY_EXE="
where py >nul 2>nul
if not errorlevel 1 set "PY_EXE=py"
if defined PY_EXE goto :eof
where python >nul 2>nul
if not errorlevel 1 set "PY_EXE=python"
if defined PY_EXE goto :eof
echo ERROR: No se encontro Python ^(ni py ni python^) en PATH.
exit /b 1

:success
echo.
echo Proceso full terminado correctamente.
pause
exit /b 0

:error
echo.
echo ERROR: El proceso full termino con errores.
pause
exit /b 1
