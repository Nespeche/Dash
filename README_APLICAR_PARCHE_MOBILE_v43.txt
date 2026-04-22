Parche aplicado: mobile UX/UI v43

Archivos incluidos:
- public/css/responsive.css
- public/app_version.js

Objetivo:
- Aprovechar mejor el ancho del celular.
- Evitar banda negra lateral / desborde horizontal del viewport.
- Unificar la experiencia de tablas mobile con scroll horizontal dentro del contenedor.
- Mantener desktop intacto.

Aplicación:
1) Hacer backup de los archivos actuales.
2) Reemplazar los archivos del ZIP respetando la misma ruta.
3) Publicar / desplegar.
4) En el celular, forzar recarga completa o cerrar y volver a abrir la app para renovar caché.
5) Si sigue viendo assets viejos, limpiar caché del sitio / service worker y volver a entrar.
