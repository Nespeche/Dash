# Implementación del plan de mejoras — Ventas DASH v22

**Base recibida:** `Dash.zip` compartido el 2026-04-12  
**Plan aplicado:** `PLAN_MEJORAS_VENTAS_DASH.md`  
**Versión resultante:** `20260412-plan-mejoras-v22`

## Resultado general
Se aplicaron las mejoras del plan sobre una copia limpia del proyecto, manteniendo la lógica funcional del dashboard y validando sintaxis completa de Worker + Frontend.

## Mejoras implementadas

### Backend
- **B-01** TTL de caché del Worker aumentado.
- **B-02** Índice covering para detalle agregado en `schema.sql` y `migracion_v22.sql`.
- **B-03** Índices covering para insights filtrados agregados en `schema.sql` y `migracion_v22.sql`.
- **B-04** Respuestas JSON preparadas para compresión en edge, sin fijar `content-encoding` manual.
- **B-05** Rate limiting básico por IP para `/api/detail` y `/api/insights`.
- **B-06** ETag + `If-None-Match` + `304 Not Modified`.

### Frontend
- **F-01** Debounce de carga de estado aumentado a 220 ms.
- **F-02** KPIs con feedback visual durante carga.
- **F-03** Animación de entrada al cambiar de tab.
- **F-04** `document.title` dinámico según tab, filtros y período.
- **F-05** Botón flotante “volver arriba” para desktop.
- **F-06** Tooltips descriptivos en botones de período.
- **F-07** Semilla de clientes en `sessionStorage` para recargas frecuentes.
- **F-08** Prefetch lazy al hover/focus de tabs.

### UI
- **U-01** Botón de período activo con estado más visible.
- **U-02** Chip del período con color diferenciado.
- **U-03** Skeleton rows en la tabla durante la primera carga.
- **U-04** Badge de tabla con estado “actualizando”.
- **U-05** Tap targets del dock mobile más cómodos.
- **U-06** Labels del panel de filtros más legibles.
- **U-07** Hover de filas más visible.
- **U-08** Hover en selects para reforzar interactividad.

### UX
- **X-01** En mobile, al elegir período se colapsan filtros automáticamente.
- **X-02** Nota del panel colapsado enriquecida con período y filtros activos.
- **X-03** Atajos de teclado `Alt+1/2/3/4` para tabs.
- **X-04** Copia al portapapeles desde celdas numéricas con toast.
- **X-05** Empty states más contextuales en la tabla.
- **X-06** Persistencia del explorador de detalle entre navegaciones.
- **X-07** Confirmación antes de “Limpiar todo” en mobile.
- **X-08** Toast de confirmación al aplicar filtros de columna.

## Archivos modificados incluidos
- `package.json`
- `public/app.js`
- `public/app_shared.js`
- `public/app_version.js`
- `public/index.html`
- `public/js/app-listeners.js`
- `public/js/catalog-store.js`
- `public/js/data-service.js`
- `public/js/explorer-state.js`
- `public/js/filter-pills-controller.js`
- `public/js/table-ui.js`
- `public/styles.css`
- `public/sw.js`
- `schema.sql`
- `migracion_v22.sql`
- `src/shared/version.js`
- `src/worker/app.js`
- `src/worker/config.js`
- `src/worker/handlers/dashboard/catalog-handler.js`
- `src/worker/handlers/dashboard/detail-handler.js`
- `src/worker/handlers/dashboard/detail-options-handler.js`
- `src/worker/handlers/dashboard/insights-handler.js`
- `src/worker/handlers/dashboard/state-handler.js`
- `src/worker/handlers/projection/compare-handler.js`
- `src/worker/handlers/projection/detail-handler.js`
- `src/worker/lib/endpoint-cache.js`
- `src/worker/lib/filters.js`
- `src/worker/lib/http.js`
- `src/worker/lib/rate-limit.js`

## Validaciones ejecutadas
- `npm run check`
- `node --check public/sw.js`

## Nota operativa
El índice SQL nuevo requiere ejecutar la migración en D1 para capturar la mejora de latencia en consultas de detalle/insights.
