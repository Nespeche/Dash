@echo off
setlocal EnableExtensions

REM =============================================================
REM actualizar_d1_incremental.bat
REM Aplica un incremental 2026 sobre D1 evitando doble ejecucion identica.
REM =============================================================

set "BASE_DIR=%~dp0"
cd /d "%BASE_DIR%"

set "DB_NAME=ventas-d1-proyeccion-v2"
set "CSV_NAME=VENTAS_DIARIAS_INCREMENTAL.csv"
set "PYTHON_SCRIPT=actualizacion_incremental.py"
set "SQL_FILE=ventas_incremental.sql"
set "NOTE_FILE=ventas_incremental_note.txt"
set "CHECK_FILE=wrangler_incremental_check.tmp"

call :resolve_python
if errorlevel 1 goto :error

if not exist "%CSV_NAME%" (
  echo ERROR: No se encontro %CSV_NAME%
  echo Copia ahi el CSV incremental con uno o varios dias completos de 2026.
  goto :error
)

if not exist "%PYTHON_SCRIPT%" (
  echo ERROR: No se encontro %PYTHON_SCRIPT%
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
echo 1^) Generando SQL incremental y firma de control...
call %PY_EXE% "%PYTHON_SCRIPT%"
if errorlevel 1 goto :error

if not exist "%SQL_FILE%" (
  echo ERROR: No se genero %SQL_FILE%
  goto :error
)

if not exist "%NOTE_FILE%" (
  echo ERROR: No se genero %NOTE_FILE%
  goto :error
)

set /p NOTE=<"%NOTE_FILE%"
if "%NOTE%"=="" (
  echo ERROR: La nota de control incremental quedo vacia.
  goto :error
)

echo.
echo 2^) Verificando si ese incremental ya fue aplicado...
if exist "%CHECK_FILE%" del /f /q "%CHECK_FILE%" >nul 2>nul
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT CASE WHEN EXISTS (SELECT 1 FROM dataset_load_log WHERE load_mode='incremental' AND notes='%NOTE%') THEN 'YES' ELSE 'NO' END AS already_applied;" > "%CHECK_FILE%"
if errorlevel 1 goto :error
findstr /I /C:"YES" "%CHECK_FILE%" >nul
if not errorlevel 1 (
  echo.
  echo Ese incremental ya fue aplicado antes.
  echo No se vuelve a ejecutar para evitar duplicacion innecesaria.
  if exist "%CHECK_FILE%" del /f /q "%CHECK_FILE%" >nul 2>nul
  goto :success
)
if exist "%CHECK_FILE%" del /f /q "%CHECK_FILE%" >nul 2>nul

echo.
echo 3^) Aplicando incremental en Cloudflare D1...
call npx wrangler d1 execute "%DB_NAME%" --remote --file="%SQL_FILE%" --yes
if errorlevel 1 goto :error

echo.
echo 4^) Validando metadata incremental...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT data_version, load_mode, last_source_file, last_delta_min_fecha, last_delta_max_fecha, rows_total FROM dataset_metadata LIMIT 1;"
if errorlevel 1 goto :error

echo.
echo 5^) Validando log de cargas...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT id, load_mode, executed_at_utc, source_file, rows_inserted, delta_min_fecha, delta_max_fecha, notes FROM dataset_load_log ORDER BY id DESC LIMIT 5;"
if errorlevel 1 goto :error

echo.
echo 6^) Validando materializados mensuales luego del incremental...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT (SELECT COUNT(*) FROM state_snapshot_month) AS state_snapshot_month_rows, (SELECT COUNT(*) FROM ranking_grupos_month) AS ranking_grupos_month_rows, (SELECT COUNT(*) FROM insights_rankings_month) AS insights_rankings_month_rows, (SELECT COUNT(*) FROM ventas_scope_dim) AS current_scope_dim_rows, (SELECT COUNT(*) FROM ventas_dia_scope) AS current_day_scope_rows, (SELECT COUNT(*) FROM ventas_mes_scope) AS current_scope_rows, (SELECT notes FROM dataset_load_log ORDER BY id DESC LIMIT 1) AS last_incremental_note;"
if errorlevel 1 goto :error

echo.
echo 7^) Validando ventas vigentes luego del incremental...
call npx wrangler d1 execute "%DB_NAME%" --remote --command "SELECT COUNT(*) AS ventas_rows, MIN(Fecha) AS ventas_desde, MAX(Fecha) AS ventas_hasta, ROUND(COALESCE(SUM(Kilos), 0), 0) AS kilos_total FROM ventas;"
if errorlevel 1 goto :error

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
echo Proceso incremental terminado correctamente.
pause
exit /b 0

:error
if exist "%CHECK_FILE%" del /f /q "%CHECK_FILE%" >nul 2>nul
echo.
echo ERROR: El proceso incremental termino con errores.
pause
exit /b 1
