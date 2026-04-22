# Arquitectura modular aplicada

## Runtime estable actual

La fase 3 queda cerrada con `public/app.js` como orquestador real del frontend estable.

### Módulos activos en runtime

#### Núcleo visual y utilitario

- `public/js/auth-ui.js`
  - shell visual de autenticación
  - storage del token basic auth
  - badge de usuario autenticado
- `public/js/runtime-state.js`
  - estados vacíos del dashboard, detalle, insights y proyección
  - helpers de cache cliente con TTL
  - factory del estado de catálogos lazy
- `public/js/charts.js`
  - render de gráficos
- `public/js/projection.js`
  - cálculo y helpers puros de proyección
- `public/js/table-ui.js`
  - render de tabla principal
  - paginador de detalle
  - render de tablas acumuladas
- `public/js/accessible-tabs.js`
  - tabs con navegación por teclado
  - roles/atributos ARIA y paneles asociados
- `public/js/accessible-combobox.js`
  - navegación accesible para dropdowns de cliente y producto
  - `aria-expanded`, `aria-activedescendant`, selección por Enter y flechas

#### Capa de queries y orquestación

- `public/js/dashboard-queries.js`
  - builders puros para `state`, `detail`, `insights`, `projection-compare` y `projection-detail`
  - helpers puros de rangos y comparación proyectada
  - cálculo del `scopeKey` para catálogos lazy
- `public/js/app-listeners.js`
  - wiring de listeners del frontend principal
  - tabs accesibles y comboboxes accesibles desacoplados de `app.js`
- `public/js/data-service.js`
  - centraliza fetch a endpoints
  - cache cliente versionado
  - sincronización de `dataVersion`
  - manejo de `AbortController`
- `public/js/detail-controller.js`
  - dueño único del estado del detalle principal
  - hidratación inicial desde `/state`
  - paginación `ver más` y `ver todos`
  - render delegado a `table-ui.js`
- `public/js/insights-controller.js`
  - carga lazy de rankings y gráficos
  - merge controlado sobre `dashboardState`
- `public/js/projection-controller.js`
  - dueño único del estado comparativo 2025 vs proyectado
  - carga del detalle proyectado
  - paginación del detalle proyectado
  - manejo de grupos seleccionados para el comparativo
- `public/js/filter-controller.js`
  - fachada estable para filtros, catálogos y búsquedas
  - mantiene compatibilidad con `public/app.js` y `public/js/app-listeners.js`
- `public/js/catalog-store.js`
  - scope de catálogos
  - fetch lazy, merge, set e invalidación de caches transitorias
- `public/js/client-search-controller.js`
  - búsqueda y selección de clientes
  - dropdown accesible y labels cacheadas
- `public/js/product-selector-controller.js`
  - multiselección de productos
  - dropdown accesible, chips y label lookup
- `public/js/filter-pills-controller.js`
  - pills visuales
  - conteo de filtros de negocio
  - lógica de expandir/colapsar panel de filtros
- `public/app.js`
  - auth
  - bootstrap
  - render principal
  - coordinación entre controladores y módulos visuales
  - render estable de la solapa Proyección

## Cierre de fase 3

### Lo que sí quedó consolidado

- `public/app.js` ya no concentra fetch ni estados mutables dispersos.
- detalle, insights y proyección usan controladores dedicados.
- filtros y búsquedas quedaron particionados sin romper la API pública existente.
- el runtime estable se carga solamente desde:
  - `public/index.html`
  - `public/app.js`
  - módulos activos bajo `public/js/`

### Lo que quedó archivado y fuera del runtime

La extracción visual completa de Proyección **no quedó activa** en la versión estable.

El intento de esa extracción se conserva solo como referencia técnica en:

- `public/js/_experimental/projection-view.experimental.js`

Ese archivo:
- no es importado por `public/app.js`
- no está referenciado por `public/index.html`
- no forma parte del app shell del service worker
- no debe tomarse como parte del runtime estable

## Fase 3.3 archivada como experimento controlado

La idea de extraer la vista visual de Proyección sigue siendo válida, pero quedó archivada para evitar reintroducir los errores de runtime que aparecieron durante la estabilización.

### Estado real

- el render visual activo de Proyección sigue en `public/app.js`
- `projection-controller.js` conserva la propiedad del estado y la carga
- la vista experimental queda guardada para retomarla más adelante con rollout controlado

### Condición para retomarla

Antes de reactivar esa extracción conviene hacer tres cosas:

1. agregar una validación que compare imports activos vs archivos disponibles
2. mover primero puentes pequeños de Proyección antes de cambiar todo el render
3. validar en deploy real con service worker limpio y cache shell renovado

## Service worker

Se mantiene un app shell endurecido con precache de los módulos activos del frontend.

Además:
- se normalizan claves sin querystring
- se usa `network-first` para assets estáticos del frontend
- se mantiene fallback de `index.html` para navegación offline o deploy parcial

## Validación y consistencia

Se mantiene:

- `scripts/checks/validate-frontend-consistency.mjs`

La validación ahora debe proteger específicamente:
- que `public/index.html` cargue el runtime correcto en el orden esperado
- que no existan entrypoints duplicados fuera de `public/`
- que los experimentos queden fuera del runtime activo
- que las exportaciones/importaciones activas sigan consistentes

## Objetivo general

Mantener la funcionalidad actual del dashboard, cerrar la fase 3 sobre una base estable y dejar preparado el terreno para la siguiente iteración, donde conviene atacar primero la modularización de `worker.js` y recién después retomar la extracción visual de Proyección.

## Backend modularizado

La modularización de `worker.js` quedó aplicada para alinear el backend con la misma lógica de entrypoint fino + módulos dedicados que ya venía usando el frontend.

### Nuevo mapa backend activo

- `worker.js`
  - queda como entrypoint mínimo del Worker
  - delega en `src/worker/app.js`
- `src/worker/app.js`
  - router principal de `/api/*`
  - auth básica
  - manejo global de errores
- `src/worker/config.js`
  - constantes compartidas de TTL, paginación y columnas resumen
- `src/worker/runtime-context.js`
  - resolver memoizado del contexto de runtime y metadata D1
- `src/worker/lib/payloads.js`
  - payloads vacíos y mensajes comunes del backend
- `src/worker/lib/endpoint-cache.js`
  - helper común de cache versionada + respuestas JSON públicas/no-store
- `src/worker/handlers/dashboard.js`
  - queda como barrel liviano
- `src/worker/handlers/dashboard/`
  - `health-handler.js`
  - `state-handler.js`
  - `insights-handler.js`
  - `detail-handler.js`
  - `catalog-handler.js`
- `src/worker/handlers/projection.js`
  - queda como barrel liviano
- `src/worker/handlers/projection/`
  - `compare-handler.js`
  - `detail-handler.js`
  - `shared.js`
- `src/worker/services/state-queries.js`
  - queda como barrel de servicios
- `src/worker/services/state-queries/`
  - `common.js`
  - `detail-queries.js`
  - `options-queries.js`
  - `insights-queries.js`
  - `fast-path-queries.js`

### Resultado buscado

- reducir el tamaño y acoplamiento directo de `worker.js`
- separar routing, handlers y queries sin cambiar rutas ni contratos JSON
- dejar una base más segura para seguir con optimizaciones de backend sin tocar el frontend

### Validación backend agregada

Se suma:

- `scripts/checks/validate-worker-modules.mjs`

Esta validación protege que:

- `worker.js` siga delegando a `src/worker/app.js`
- existan los módulos backend críticos
- el router principal siga importando handlers y librerías base esperadas

