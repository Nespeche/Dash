@echo off
setlocal EnableExtensions

REM =============================================================
REM actualizar_d1.bat
REM Ejecutar desde la misma carpeta del proyecto.
REM
REM Modos:
REM   actualizar_d1.bat full
REM   actualizar_d1.bat incremental
REM   actualizar_d1.bat help
REM
REM Si no se pasa parametro, por compatibilidad usa modo full.
REM =============================================================

set "BASE_DIR=%~dp0"
cd /d "%BASE_DIR%"

set "DB_NAME=ventas-d1-proyeccion-v2"
set "FULL_CSV_NAME=VENTAS_DIARIAS.csv"
set "HIST_CSV_NAME=BBDD_2025.csv"
set "FULL_PYTHON_SCRIPT=convertir_csv.py"
set "FULL_SQL_FILE=ventas_import.sql"
set "INCREMENTAL_CSV_NAME=VENTAS_DIARIAS_INCREMENTAL.csv"
set "INCREMENTAL_PYTHON_SCRIPT=actualizacion_incremental.py"
set "INCREMENTAL_SQL_FILE=ventas_incremental.sql"
set "MODE=%~1"

if /I "%MODE%"=="" set "MODE=full"
if /I "%MODE%"=="help" goto :usage
if /I "%MODE%"=="/h" goto :usage
if /I "%MODE%"=="-h" goto :usage
if /I "%MODE%"=="--help" goto :usage
if /I "%MODE%"=="full" goto :full
if /I "%MODE%"=="incremental" goto :incremental

echo ERROR: modo no reconocido: %MODE%
goto :usage

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

:full
call :resolve_python
if errorlevel 1 goto :error

if not exist "%FULL_CSV_NAME%" (
  echo ERROR: No se encontro %FULL_CSV_NAME%
  goto :error
)

if not exist "%HIST_CSV_NAME%" (
  echo ERROR: No se encontro %HIST_CSV_NAME%
  goto :error
)

if not exist "%FULL_PYTHON_SCRIPT%" (
  echo ERROR: No se encontro %FULL_PYTHON_SCRIPT%
  goto :error
)

echo.
echo ==========================================
echo MODO FULL - reconstruccion completa
echo ==========================================

echo.
echo 1^) Generando SQL desde los CSV...
call %PY_EXE% "%FULL_PYTHON_SCRIPT%"
if errorlevel 1 goto :error

echo.
echo 2^) Importando en Cloudflare D1...
call npx wrangler d1 execute "%DB_NAME%" --remote --file="%FULL_SQL_FILE%" --yes
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

:incremental
call :resolve_python
if errorlevel 1 goto :error

if not exist "%INCREMENTAL_CSV_NAME%" (
  echo ERROR: No se encontro %INCREMENTAL_CSV_NAME%
  echo Copia ahi el CSV incremental con uno o varios dias completos de 2026.
  goto :error
)

if not exist "%INCREMENTAL_PYTHON_SCRIPT%" (
  echo ERROR: No se encontro %INCREMENTAL_PYTHON_SCRIPT%
  goto :error
)

echo.
echo ==========================================
echo MODO INCREMENTAL - delta 2026 sobre D1
echo ==========================================

echo.
echo 0^) Validando que el esquema base de incremental ya este aplicado...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT load_mode, historical_rows_total FROM dataset_metadata LIMIT 1;"
if errorlevel 1 (
  echo.
  echo ERROR: No se detecto el esquema base de incremental en D1.
  echo Primero ejecuta la migracion v8 y luego la v9:
  echo   npx wrangler d1 execute "%DB_NAME%" --remote --file="migracion_v8.sql" --yes
  echo   npx wrangler d1 execute "%DB_NAME%" --remote --file="migracion_v9.sql" --yes
  goto :error
)

echo.
echo 1^) Generando SQL incremental...
call %PY_EXE% "%INCREMENTAL_PYTHON_SCRIPT%"
if errorlevel 1 goto :error

if not exist "%INCREMENTAL_SQL_FILE%" (
  echo ERROR: No se genero %INCREMENTAL_SQL_FILE%
  goto :error
)

echo.
echo 2^) Aplicando incremental en Cloudflare D1...
call npx wrangler d1 execute "%DB_NAME%" --remote --file="%INCREMENTAL_SQL_FILE%" --yes
if errorlevel 1 goto :error

echo.
echo 3^) Validando metadata incremental...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT data_version, load_mode, last_source_file, last_delta_min_fecha, last_delta_max_fecha, rows_total FROM dataset_metadata LIMIT 1;"
if errorlevel 1 goto :error

echo.
echo 4^) Validando log de cargas...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT id, load_mode, executed_at_utc, source_file, rows_inserted, delta_min_fecha, delta_max_fecha FROM dataset_load_log ORDER BY id DESC LIMIT 5;"
if errorlevel 1 goto :error

echo.
echo 5^) Validando materializados mensuales luego del incremental...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT (SELECT COUNT(*) FROM state_snapshot_month) AS state_snapshot_month_rows, (SELECT COUNT(*) FROM ranking_grupos_month) AS ranking_grupos_month_rows, (SELECT COUNT(*) FROM insights_rankings_month) AS insights_rankings_month_rows, (SELECT COUNT(*) FROM ventas_scope_dim) AS current_scope_dim_rows, (SELECT COUNT(*) FROM ventas_mes_scope) AS current_scope_rows;"
if errorlevel 1 goto :error

echo.
echo 6^) Validando ventas vigentes luego del incremental...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT COUNT(*) AS ventas_rows, MIN(Fecha) AS ventas_desde, MAX(Fecha) AS ventas_hasta, ROUND(COALESCE(SUM(Kilos), 0), 0) AS kilos_total FROM ventas;"
if errorlevel 1 goto :error

goto :success

:usage
echo.
echo Uso:
echo   actualizar_d1.bat full
echo   actualizar_d1.bat incremental
echo.
echo full:
echo   reconstruye por completo ventas 2026, historico 2025 y materializados.
echo.
echo incremental:
echo   toma VENTAS_DIARIAS_INCREMENTAL.csv, genera ventas_incremental.sql
echo   y lo aplica en D1 automaticamente.
echo.
pause
exit /b 1

:success
echo.
echo Proceso terminado correctamente.
pause
exit /b 0

:error
echo.
echo ERROR: El proceso termino con errores.
pause
exit /b 1
