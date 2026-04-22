# Parche UX / filtros / performance v17

## Objetivo
Pulir la experiencia de presets y filtros en Resumen y Proyectado, y reducir recargas/repeticiones innecesarias en frontend.

## Cambios incluidos
- Deduplicación de requests en `public/js/data-service.js`.
- Debounce de inputs de proyección en `public/js/app-listeners.js`.
- Evitar recarga de estado redundante cuando la query no cambió en `public/app.js`.
- Rediseño visual de presets con tarjetas compactas en `public/js/table-ui.js` y `public/styles.css`.
- Menú de filtros de encabezado mejorado: búsqueda local, selección múltiple y botón Aplicar para evitar una recarga por cada click.
- Presets enriquecidos también para Proyectado en `public/js/explorer-views.js`.
- Bump de versión pública a `20260409-ux-filter-performance-v17`.
- Definición de `type: module` en `package.json` para eliminar reinterpretación ESM durante checks.

## Archivos modificados
- package.json
- src/shared/version.js
- public/app.js
- public/app_shared.js
- public/app_version.js
- public/styles.css
- public/sw.js
- public/js/app-listeners.js
- public/js/data-service.js
- public/js/table-ui.js
- public/js/explorer-views.js

## Validación ejecutada
- `npm run check`
