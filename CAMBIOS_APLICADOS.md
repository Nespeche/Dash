# Cambios aplicados

## Fase 3.2A — app.js como coordinador real

Se completó la extracción de carga y estado que seguían concentrados en `public/app.js`.

### Nuevos módulos agregados

- `public/js/data-service.js`
- `public/js/detail-controller.js`
- `public/js/insights-controller.js`
- `public/js/projection-controller.js`

### Qué salió de `public/app.js`

- fetch versionado a `/state`, `/detail`, `/insights`, `/projection-compare` y `/projection-detail`
- estado del detalle principal (`rows`, `total`, `nextOffset`, `hasMore`, `loading`)
- carga lazy de insights
- estado y carga del comparativo proyectado y del detalle proyectado
- secuencias de carga y aborts asociados a esas capas

### Qué quedó en `public/app.js`

- auth
- bootstrap
- helpers UI generales
- render principal
- render visual de proyección
- coordinación entre controladores y módulos visuales

### Estado actual del archivo principal en esa etapa

- `public/app.js` bajó de 1869 a 1544 líneas
- la reducción se logró sin mover todavía el render visual estable de Proyección

## Fase 3.2B — partición de filter-controller.js

Se completó la división de `public/js/filter-controller.js` en submódulos, manteniendo su API pública como fachada estable.

### Nuevos submódulos agregados

- `public/js/catalog-store.js`
- `public/js/client-search-controller.js`
- `public/js/product-selector-controller.js`
- `public/js/filter-pills-controller.js`

### Resultado

- `filter-controller.js` quedó reducido y enfocado en orquestación
- se preservó compatibilidad con `public/app.js` y `public/js/app-listeners.js`
- la lógica de negocio no fue alterada; se redistribuyó por responsabilidades

## runtime-state y dashboard-queries

### `public/js/runtime-state.js`

Se amplió para que actúe como fuente de verdad de estados vacíos:

- `createEmptyDetailState()`
- `createEmptyInsightsState()`
- mantenimiento de factories de proyección y catálogos

### `public/js/dashboard-queries.js`

Se ajustó para soportar la nueva capa modular:

- builders puros reutilizables para controladores
- helper `buildCatalogScopeKey()`
- consolidación del cálculo de contexto proyectado y querystrings asociados

## package.json y validación

Se actualizó `package.json` para que `npm run check` valide también:

- `data-service.js`
- `detail-controller.js`
- `insights-controller.js`
- `projection-controller.js`
- `catalog-store.js`
- `client-search-controller.js`
- `product-selector-controller.js`
- `filter-pills-controller.js`

## Service worker y versionado

Se actualizó el versionado público a:

- `20260406-phase3-2ab-modular-v1`

Archivos sincronizados:

- `src/shared/version.js`
- `public/app_version.js`
- fallback de `public/app_shared.js`
- fallback de `public/sw.js`

Además, `public/sw.js` pasó a precachear también los módulos nuevos de fase 3.2A y 3.2B.

## Validaciones ejecutadas en la estabilización previa

- `node --check public/app.js`
- `node --check public/js/data-service.js`
- `node --check public/js/detail-controller.js`
- `node --check public/js/insights-controller.js`
- `node --check public/js/projection-controller.js`
- `node --check public/js/catalog-store.js`
- `node --check public/js/client-search-controller.js`
- `node --check public/js/product-selector-controller.js`
- `node --check public/js/filter-pills-controller.js`
- `node --check public/js/filter-controller.js`
- `npm run check`

## 2026-04-06 — Estabilización post Fase 3.3

- Se revirtió la parte inestable de la refactorización visual de Proyección y se restauró la versión estable de `public/app.js` basada en la última base operativa validada.
- Esto recompuso la capa puente entre `app.js`, `data-service.js`, `detail-controller.js`, `insights-controller.js` y `projection-controller.js`.
- Con esta estabilización se eliminaron errores en runtime del tipo `syncTabsTop is not defined`, `getProjectionComparison is not defined`, `renderAgentKpiValue is not defined` y `ensureProjectionCompareLoaded is not defined`.
- Se reforzó `scripts/checks/validate-frontend-consistency.mjs` para detectar preventivamente la ausencia de funciones puente críticas en `public/app.js` antes de desplegar.
- Nueva versión pública en esa estabilización: `20260406-phase3-2ab-stabilization-v1`.

## Hotfix de cache / service worker — 20260406-phase3-2ab-stabilization-v2-cachefix1

- Se detectó una inconsistencia entre el `public/app.js` actual del ZIP y el `app.js` que seguía ejecutando el navegador: el error `ensureProjectionCompareLoaded is not defined` provenía de una versión vieja del frontend servida desde caché del service worker.
- Se actualizó el versionado público para forzar rotación del cache shell.
- `public/sw.js` pasó de `cache-first` a `network-first` para assets estáticos del frontend, con `fallback` a caché cuando no hay red.
- Se agregó `public/favicon.svg` y el link correspondiente en `public/index.html` para eliminar el 404 del ícono de pestaña.
- Se reforzó la validación de consistencia para exigir que `sw.js` precachee el favicon.

## 2026-04-06 — Cierre de fase 3 + limpieza de inconsistencias frontend/runtime

### Cambios aplicados

- Se eliminó el `app.js` duplicado en la raíz del proyecto porque no era parte del runtime real y podía inducir errores en futuras ediciones.
- Se archivó la extracción visual experimental de Proyección en `public/js/_experimental/projection-view.experimental.js` para dejar explícito que no forma parte del runtime estable.
- Se alineó la documentación para que refleje el estado real de la app: el render activo de Proyección sigue en `public/app.js`.
- Se endureció `scripts/checks/validate-frontend-consistency.mjs` para validar:
  - orden y entrypoints reales cargados por `public/index.html`
  - ausencia de entrypoints duplicados fuera de `public/`
  - permanencia de los experimentos fuera del runtime activo
  - consistencia de imports/exports y funciones puente críticas
- Se agregó chequeo de sintaxis para el módulo experimental archivado, sin reintroducirlo en producción.

### Criterio aplicado

En esta etapa no se tocó el runtime estable (`public/app.js`, `public/index.html`, `public/sw.js`) a nivel funcional. La decisión fue cerrar inconsistencias estructurales sin volver a abrir riesgo operativo.

## Fase 3.2C — limpieza definitiva del entrypoint huérfano

Se cerró la deuda pendiente del frontend eliminando definitivamente `app.js` de la raíz del proyecto.

### Qué se hizo
- se removió `app.js` de la raíz
- se mantuvo `public/app.js` como único entrypoint real del frontend
- se endureció `scripts/checks/validate-frontend-consistency.mjs` para que vuelva a fallar si reaparece un entrypoint fuera de `public/`

### Resultado
- desaparecen los warnings por entrypoint duplicado
- el runtime queda alineado con `public/index.html` y `public/sw.js`
- futuras reintroducciones de `app.js` en raíz se detectan antes del deploy

