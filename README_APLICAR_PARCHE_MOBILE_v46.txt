PARCHE MOBILE v46 — Ventas Dash

Archivos incluidos:
- public/index.html
- public/css/responsive.css
- public/app_version.js

Objetivo de esta iteración:
1. Unificar la disposición de columnas en Acumulados para que Por Agente se vea igual que Por Coordinador.
2. Hacer que Por Cliente (Top 20) entre completo en mobile, priorizando Kilos, % y Dist.
3. Quitar la sombra/fade lateral en Proyección por Familia y Producto y en Resumen Ejecutivo por Familia.
4. Mantener desktop sin cambios intencionales.

Aplicación paso a paso:
1. Hacé backup de estos archivos actuales:
   - public/index.html
   - public/css/responsive.css
   - public/app_version.js

2. Copiá los archivos del parche respetando la misma estructura de carpetas.

3. Volvé a desplegar la app.

4. En el celular, cerrá completamente la PWA o la pestaña del navegador y abrí nuevamente la app.

5. Si todavía vieras la versión anterior, limpiá caché y service worker del sitio y volvé a ingresar.

Validaciones recomendadas:
- Acumulados > Por Agente: debe verse con la misma lógica de columnas que Por Coordinador.
- Acumulados > Por Cliente (Top 20): deben verse Cliente, Coord., Agente, Kilos, % y Dist. sin perder las métricas.
- Proyección por Familia y Producto: no debe verse la sombra vertical a la altura de Var. Kg.
- Resumen Ejecutivo por Familia: no debe verse la misma sombra lateral.
