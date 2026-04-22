PARCHE MOBILE v47 — Acumulados (Por Agente / Por Cliente Top 20)

Archivos incluidos:
- public/css/responsive.css
- public/js/table-ui.js
- public/app_version.js

Que corrige:
1) Fuerza una marca runtime en las tablas de Acumulados usando los tbody estables:
   - at-coord
   - at-agte
   - at-grp
   - at-mrc
   - at-clie
2) Hace que Por Agente use la misma distribucion visual que Por Coordinador / Grupo / Marca.
3) Hace que Por Cliente (Top 20) entre completa en mobile, priorizando Cliente, Coord., Agente, Kilos, % y Dist.
4) Evita depender de clases agregadas en index.html, para que el ajuste siga funcionando aunque el HTML viejo haya quedado cacheado.

PASO A PASO
1. Hacer backup de:
   - public/css/responsive.css
   - public/js/table-ui.js
   - public/app_version.js
2. Reemplazar esos archivos por los del ZIP, respetando exactamente la misma ruta.
3. Desplegar/publicar la app.
4. En el celular, cerrar completamente la PWA o pestaña y volver a abrir.
5. Si siguiera viendose la version vieja:
   - limpiar cache del sitio
   - actualizar el service worker
   - volver a ingresar

VALIDACION ESPERADA
- En Acumulados > Por Agente deben verse las columnas igual de resueltas que en Por Coordinador.
- En Acumulados > Por Cliente (Top 20) deben verse Cliente, Coord., Agente, Kilos, % y Dist. sin quedar cortadas como antes.
- Desktop no tiene cambios intencionales.
