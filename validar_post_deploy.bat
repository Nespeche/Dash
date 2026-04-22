@echo off
setlocal EnableExtensions

set "BASE_DIR=%~dp0"
cd /d "%BASE_DIR%"

if "%VENTAS_API_BASIC_TOKEN%"=="" (
  if "%VENTAS_API_USER%"=="" (
    echo ERROR: Defini VENTAS_API_BASIC_TOKEN o VENTAS_API_USER y VENTAS_API_PASS antes de ejecutar.
    exit /b 1
  )
  if "%VENTAS_API_PASS%"=="" (
    echo ERROR: Falta VENTAS_API_PASS.
    exit /b 1
  )
)

set "MONTH_ARG=%~1"
if "%MONTH_ARG%"=="" (
  node scripts\post_deploy\validate-post-deploy.mjs
) else (
  node scripts\post_deploy\validate-post-deploy.mjs --month %MONTH_ARG%
)

exit /b %errorlevel%
