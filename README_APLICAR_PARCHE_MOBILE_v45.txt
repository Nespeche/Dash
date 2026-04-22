PARCHE MOBILE v45 — Ventas Dash

Contenido
- public/css/responsive.css
- public/styles.css
- public/app_version.js

Objetivo
- Repartir mejor el ancho de columnas en Acumulados mobile.
- Hacer entrar mejor la tabla Por Cliente (Top 20) en celular.
- Compactar mas la primera columna de Proyeccion sin tocar desktop.
- Limpiar la sombra/capa visual sobre la solapa Graf. en mobile.

Aplicacion
1. Hacer backup de estos archivos actuales:
   - public/css/responsive.css
   - public/styles.css
   - public/app_version.js
2. Reemplazar esos archivos por los del parche, respetando exactamente la misma ruta.
3. Desplegar la app.
4. En el celular, cerrar la PWA o la pestana y volver a abrir.
5. Si siguiera viendose una version vieja, limpiar cache/service worker del sitio y volver a entrar.

Validaciones sugeridas
- Acumulados > Coordinador / Agente / Grupo / Marca: Kilos, %, Dist. deben ocupar mejor el ancho visible.
- Acumulados > Cliente Top 20: debe entrar mejor la tabla completa en la pantalla.
- Tabs superiores: la sombra/capa detras de Graf. debe desaparecer o quedar alineada.
- Proyeccion: Etiquetas de fila y Resumen deben quedar mas angostos, con mejor visibilidad de 2025 / 2026 / Var Kg / Var %.
