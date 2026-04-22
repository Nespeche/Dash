# Cambios aplicados · Resumen Filtrado v8

## Objetivos resueltos
- Evitar que el menú del filtro de encabezado quede cortado fuera de pantalla.
- Hacer que los filtros de encabezado de **Resumen Filtrado** usen el **contexto real filtrado** y no solo las 50 filas visibles.
- Mantener velocidad: ya no se hidrata automáticamente todo el detalle para alimentar esos filtros.
- Recuperar la lógica de `+ Ver 50 más / Ver todos` evitando la carga total automática del detalle.

## Solución técnica
1. Se eliminó la hidratación automática completa del detalle en `detail-controller.js`.
2. Se agregó el endpoint `GET /api/detail-options`.
3. Ese endpoint devuelve valores distintos por columna para el contexto filtrado actual, incluyendo filtros de otras columnas (`xf_*`).
4. El frontend consulta ese endpoint cuando se abre un filtro de encabezado en la vista `Detalle`.
5. Los menús de encabezado ahora se posicionan con `position: fixed` y coordenadas calculadas para no quedar fuera del viewport.

## Archivos tocados
- public/app.js
- public/app_shared.js
- public/app_version.js
- public/sw.js
- public/js/dashboard-queries.js
- public/js/data-service.js
- public/js/detail-controller.js
- public/js/table-ui.js
- src/shared/version.js
- src/worker/app.js
- src/worker/lib/filters.js
- src/worker/handlers/dashboard/index.js
- src/worker/handlers/dashboard/detail-options-handler.js
- src/worker/services/state-queries.js
- src/worker/services/state-queries/detail-queries.js
- package.json
