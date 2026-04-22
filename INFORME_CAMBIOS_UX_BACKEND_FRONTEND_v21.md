# Informe de cambios · Dash v21

## Base analizada
- ZIP actualizado entregado por el usuario.
- Video `Ventas Dashboard - Google Chrome 2026-04-10 13-32-47.mp4`.
- URL publicada del dashboard.

## Hallazgo principal del bug visual
El menú de filtros por columna estaba siendo desacoplado del contexto visual de la tabla y movido a una capa global flotante. Además, se reposicionaba en cada scroll del documento.

### Efecto visible
- El cuadro de filtro quedaba “pegado” al viewport.
- Acompañaba el desplazamiento al hacer scroll.
- La transparencia y el blur reducían contraste sobre fondos variables de la tabla.

## Estado de la optimización previa
### Backend
La optimización estructural del Worker sigue siendo correcta:
- cache versionada
- canonización de requests en backend
- deduplicación concurrente
- filtros tolerantes a rangos invertidos

No detecté un problema crítico de backend en esta iteración que justificara tocar queries o contratos JSON sin benchmark productivo.

### Frontend
La dirección general también era correcta:
- lazy loading
- service worker diferido
- caches cliente
- deduplicación de requests

Pero seguían dos deficiencias relevantes:
1. el menú flotante de filtros por columna seguía forzando trabajo de layout durante scroll;
2. el cliente no normalizaba localmente la query string antes de cachear/deduplicar, por lo que requests equivalentes podían generar claves distintas.

## Cambios aplicados
### UX / capa visual
- Menú de filtros por columna relocalizado al contexto visual local de la tarjeta.
- Cierre automático del menú al hacer scroll fuera del propio menú, evitando que acompañe a la pantalla.
- Superficies del menú y dropdowns endurecidas con fondos opacos.
- Contraste reforzado en controles, botones, pills y paneles.
- Mejora de foco visible para navegación y accesibilidad.
- Ajuste visual de tabs, hero, cards y toolbars para una lectura más nítida.
- Metadatos visuales para navegador: `theme-color` y `color-scheme`.
- Tipografía DM Sans ampliada con peso 700 para títulos/acciones con mejor jerarquía.

### Frontend / rendimiento
- Normalización canónica de query strings en `public/js/data-service.js`.
- Eliminación del tracking continuo de scroll para reposicionar el menú de filtros.
- Reposicionamiento solo ante resize/orientation/resize-observer, con menor costo de render.
- Mantención de la lógica existente sin tocar contratos ni flujos de datos.

## Archivos modificados
- `public/index.html`
- `public/styles.css`
- `public/js/table-ui.js`
- `public/js/data-service.js`
- `public/app_shared.js`
- `public/app_version.js`
- `public/sw.js`
- `src/shared/version.js`

## Validación ejecutada
- `npm run check`
- `node --check public/sw.js`

## Versión pública
- `20260410-ux-layer-fix-v21`
