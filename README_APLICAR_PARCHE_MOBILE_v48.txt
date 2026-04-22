PARCHE MOBILE v48

Archivos incluidos:
- public/css/responsive.css
- public/js/table-ui.js
- public/app_version.js

Objetivo:
- corregir definitivamente Por Agente y Por Cliente (Top 20) en Acumulados
- igualar la distribucion de columnas a las tablas que ya se ven bien
- mantener desktop sin cambios intencionales

Motivo detectado:
Los ajustes previos dependian demasiado de CSS. En las tablas con texto mas largo (Agente y Cliente Top 20), el layout seguia expandiendose por contenido y no llegaba a respetar del todo el reparto de columnas.

Que hace esta version:
1. Aplica layout mobile por runtime sobre las tablas reales.
2. Inserta un colgroup con anchos fijos por columna.
3. Fuerza table-layout fixed solo en mobile.
4. Recorta texto largo con ellipsis para que no empuje el ancho.

Como aplicar:
1. Hacer backup de:
   - public/css/responsive.css
   - public/js/table-ui.js
   - public/app_version.js
2. Reemplazar esos archivos por los del ZIP.
3. Desplegar/publicar la app.
4. En el celular, cerrar completamente la PWA o la pestana y volver a abrir.
5. Si se sigue viendo una version vieja, limpiar cache y service worker del sitio.

Validacion esperada:
- Por Agente debe verse con la misma logica que Por Coordinador.
- Por Cliente (Top 20) debe mostrar Cliente, Coord., Agente, Kilos, %, Dist. completos dentro del ancho mobile.
