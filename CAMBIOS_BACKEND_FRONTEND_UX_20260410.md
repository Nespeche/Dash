# Cambios aplicados · Backend + Frontend + UX · 2026-04-10

## Objetivo
Mejorar consumo de recursos, velocidad de navegación, robustez del cache y tolerancia UX sin romper la funcionalidad existente.

## Archivos modificados
- `package.json`
- `public/app.js`
- `public/app_shared.js`
- `public/app_version.js`
- `public/index.html`
- `public/styles.css`
- `public/sw.js`
- `public/js/explorer-state.js` *(nuevo)*
- `src/shared/version.js`
- `src/worker/lib/endpoint-cache.js`
- `src/worker/lib/filters.js`
- `src/worker/lib/http.js`

## Mejoras de Backend
### 1. Cache key canónica en el Worker
Se agregó canonización de query string en `src/worker/lib/http.js` para que requests equivalentes compartan la misma clave de cache aunque el orden de parámetros cambie.

### 2. Coalescing de requests concurrentes
Se agregó deduplicación de misses concurrentes en `src/worker/lib/endpoint-cache.js`. Si dos requests idénticos llegan al mismo tiempo, el Worker reutiliza la misma construcción de respuesta.

### 3. Rango de fechas tolerante a errores
Se normaliza `desde/hasta` en `src/worker/lib/filters.js`. Si el usuario envía el rango invertido, el backend lo corrige automáticamente.

## Mejoras de Frontend
### 4. Cold start con menos roundtrips
`public/app.js` ya no consulta `/health` en el primer arranque frío cuando aún no hay caches cliente cargados. El primer `/state` pasa a ser la fuente de verdad inicial del `dataVersion`.

### 5. Lazy loading de vistas pesadas
Se movió el estado puro del explorador a `public/js/explorer-state.js` y se dejaron `public/js/explorer-views.js` y `public/js/charts.js` para carga diferida bajo demanda.

### 6. Service worker menos invasivo
`public/sw.js`:
- reduce el precache inicial del app shell
- deja fuera assets visuales no críticos
- usa cache-first con revalidación en background para el shell

### 7. Registro diferido del service worker
El registro del SW se agenda en idle y deja de competir con el bootstrap de la app.

## Mejoras de UX
### 8. Persistencia de solapa activa
La última pestaña visitada se guarda en `localStorage` y se restaura al volver a entrar.

### 9. Corrección automática del rango manual
Si el usuario elige fechas invertidas, el frontend las corrige y sincroniza los inputs.

### 10. Reintento visible ante error
Se agregó botón `Reintentar` en la barra de error.

### 11. Carga de fuentes un poco más eficiente
`public/index.html` agrega `preconnect` a `fonts.gstatic.com`.

## Validación ejecutada
- `npm run check`
- `node --check public/sw.js`

Todo quedó validado sin errores de sintaxis ni inconsistencias de versión.

## Aplicación manual mínima
1. Copiar los archivos modificados sobre el proyecto actual.
2. Ejecutar `npm run check`.
3. Hacer deploy del Worker y del frontend.
4. Forzar refresh del navegador para renovar el app shell.
