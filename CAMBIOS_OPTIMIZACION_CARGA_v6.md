# Optimización de carga Resumen Filtrado v6

## Objetivo
Eliminar la hidratación masiva de filas del detalle al cambiar filtros amplios (por ejemplo, 3 meses) y mantener filtros de encabezado útiles sin sacrificar velocidad.

## Cambios principales
1. `Resumen Filtrado` ahora arranca con lote inicial de 50 filas.
2. Se agregó el endpoint `/api/detail-options` para obtener valores distintos por columna según el contexto filtrado, sin descargar todas las filas del detalle.
3. Los filtros de encabezado consultan opciones en forma lazy al abrirse.
4. Se mantiene la paginación manual (`+ Ver 50 más` / `Ver todos`) para que solo se cargue más detalle si el usuario lo decide.
5. Se actualizó la versión de app/service worker para invalidar caché.

## Archivos tocados
- public/app.js
- public/app_shared.js
- public/app_version.js
- public/js/dashboard-queries.js
- public/js/data-service.js
- public/js/detail-controller.js
- public/js/table-ui.js
- public/sw.js
- src/shared/version.js
- src/worker/app.js
- src/worker/config.js
- src/worker/handlers/dashboard/index.js
- src/worker/handlers/dashboard/detail-options-handler.js
- src/worker/lib/filters.js
- src/worker/services/state-queries.js
- src/worker/services/state-queries/detail-queries.js
- package.json
