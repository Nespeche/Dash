# Guía de implementación de la optimización

## 1. Preparación local
1. Descomprimir el ZIP optimizado en una carpeta limpia.
2. Verificar que estén presentes:
   - `worker.js`
   - `wrangler.toml`
   - carpeta `public/`
   - carpeta `src/`
   - carpeta `docs/`
   - carpeta `scripts/post_deploy/`
   - `convertir_csv.py`
   - `actualizacion_incremental.py`
   - `runtime_sql.py`
   - `actualizar_d1.bat`
   - `actualizar_d1_full.bat`
   - `actualizar_d1_incremental.bat`
   - `validar_post_deploy.bat`
3. Abrir una terminal en la carpeta del proyecto.
4. Instalar dependencias si hace falta:
   - `npm install`

## 2. Qué cambia en esta versión
### Modularización adicional
Se sigue desacoplando el frontend para reducir riesgo y facilitar mantenimiento:
- `public/js/auth-ui.js`: autenticación UI + storage del token.
- `public/js/runtime-state.js`: estados vacíos, cache cliente y estado lazy de catálogos.
- `public/js/charts.js`: renderizado de gráficos.
- `public/js/projection.js`: lógica de proyección.

### Validación post-deploy automatizada
Se agrega un flujo nuevo para validar la API publicada después del deploy:
- `scripts/post_deploy/config.mjs`
- `scripts/post_deploy/http.mjs`
- `scripts/post_deploy/validate-post-deploy.mjs`
- `scripts/post_deploy/README.md`
- `validar_post_deploy.bat`

También se agregan scripts npm:
- `npm run check`
- `npm run validate:postdeploy`
- `npm run deploy:validated`

## 3. Validaciones locales rápidas
1. Validar sintaxis JS:
   - `npm run check`
2. Validar sintaxis Python:
   - `python -m py_compile convertir_csv.py actualizacion_incremental.py runtime_sql.py`
3. Generar SQL full de prueba:
   - `python convertir_csv.py`
4. Generar SQL incremental de prueba:
   - `python actualizacion_incremental.py`

## 4. Migraciones recomendadas en D1
Si la base remota ya existe, aplicar una vez:
1. `npx wrangler d1 execute ventas-d1-proyeccion-v2 --remote --file="migracion_v8.sql" --yes`
2. `npx wrangler d1 execute ventas-d1-proyeccion-v2 --remote --file="migracion_v9.sql" --yes`

La v8 deja lista la metadata incremental.
La v9 agrega índices de auditoría liviana para el log de cargas.

## 5. Carga full
Usar cuando quieras reconstruir toda la base 2026 + histórico 2025.

### Opción simple
- `actualizar_d1.bat full`

### Opción equivalente
- `actualizar_d1_full.bat`

Qué hace:
1. Lee `VENTAS_DIARIAS.csv` y `BBDD_2025.csv`.
2. Genera `ventas_import.sql`.
3. Rebuild completo de tablas runtime.
4. Rebuild de soporte histórico 2025.
5. Actualiza metadata.
6. Ejecuta validaciones finales.

## 6. Carga incremental
Usar cuando recibís un delta de 2026 con uno o varios días completos.

### Opción simple
- `actualizar_d1.bat incremental`

### Opción equivalente
- `actualizar_d1_incremental.bat`

Qué hace:
1. Lee `VENTAS_DIARIAS_INCREMENTAL.csv`.
2. Calcula fingerprint y nota de control.
3. Detecta fechas y meses afectados.
4. Borra solo las fechas afectadas del dataset 2026.
5. Inserta el delta.
6. Rebuild global solo de:
   - catálogos runtime
   - `scope_catalogo`
   - `state_snapshot_global`
   - `ranking_grupos_global`
7. Refresca solo los meses afectados en:
   - `state_options_month_global`
   - `state_snapshot_month`
   - `ranking_grupos_month`
   - `insights_rankings_month`
8. Actualiza metadata y log.
9. Valida resultado.

## 7. Deploy del Worker
1. Confirmar que `wrangler.toml` apunta a la D1 correcta.
2. Confirmar que `public/config.js` apunta a la API correcta.
3. Deploy manual:
   - `npm run deploy`
   - o `npx wrangler deploy`

## 8. Validación post-deploy automatizada
### Credenciales necesarias
Definir una de estas opciones antes de ejecutar la validación:

#### Opción A
- `VENTAS_API_BASIC_TOKEN`

#### Opción B
- `VENTAS_API_USER`
- `VENTAS_API_PASS`

### Mes a validar
Definir el mes de validación de una de estas maneras:
- argumento `--month YYYY-MM`
- variable `POST_DEPLOY_MONTH`
- si no se informa, toma el mes actual

### Validación desde terminal
- `npm run validate:postdeploy -- --month 2026-04`

### Validación desde batch Windows
- `validar_post_deploy.bat 2026-04`

### Deploy + validación en una sola corrida
- `npm run deploy:validated`

### Qué valida automáticamente
1. Consistencia entre `wrangler.toml` y `public/config.js`.
2. Endpoint `/health`.
3. Endpoint `/state`.
4. Endpoint `/detail`.
5. Endpoint `/insights`.
6. Endpoint `/catalog` para clientes.
7. Endpoint `/catalog` para productos.
8. Endpoint `/projection-compare`.
9. Endpoint `/projection-detail`.

## 9. Validación funcional en navegador
1. Abrir la app.
2. Forzar recarga completa del navegador.
3. Verificar:
   - login
   - carga inicial del mes
   - filtros
   - detalle paginado
   - comparativo 2025
   - proyección
   - gráficos
4. Confirmar que no haya mezcla de assets viejos:
   - si había una versión anterior cacheada, cerrar la pestaña y volver a abrir la app.

## 10. Checklist final
- [ ] `npm install` ejecutado si faltaban dependencias
- [ ] `npm run check` sin errores
- [ ] `python -m py_compile ...` sin errores
- [ ] full genera `ventas_import.sql`
- [ ] incremental genera `ventas_incremental.sql`
- [ ] migraciones aplicadas si correspondían
- [ ] deploy remoto correcto
- [ ] `npm run validate:postdeploy -- --month YYYY-MM` sin errores
- [ ] UI y endpoints funcionando igual que antes
- [ ] autenticación Basic Auth operativa
- [ ] sin mezcla de assets cacheados
