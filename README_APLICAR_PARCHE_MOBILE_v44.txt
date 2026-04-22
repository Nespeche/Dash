PARCHE MOBILE v44 — Ventas Dash

Objetivo
- Aplicar solo mejoras para celular/mobile.
- No introducir cambios intencionales en desktop.

Archivos incluidos
- public/css/responsive.css
- public/styles.css
- public/js/table-ui.js
- public/js/charts.js
- public/app_version.js

Cambios aplicados
1) Filtro Fecha en mobile
- El filtro de la columna Fecha mantiene el comportamiento actual en desktop.
- En mobile ahora muestra un selector tipo calendario con los dias disponibles.
- Permite tocar uno o varios dias y luego aplicar el filtro.

2) Solapa Acumulados
- La columna # se redujo al ancho minimo util.
- La segunda columna se compacto para liberar espacio visual a Kilos, %, y Dist.
- La compresion se aplica solo en mobile.

3) Solapa Proyeccion
- Se redujo el ancho de la primera columna en:
  - Proyeccion por Familia y Producto
  - Proyeccion por Coordinador y Agente
  - Resumen ejecutivo por Familia
- Se conservaron los datos, priorizando abreviacion visual y mejor reparto del ancho.

4) Solapa Graficos
- En mobile, al tocar un punto de Evolucion diaria comparada aparece un tooltip visual con el dato del dia.
- Desktop conserva su comportamiento habitual.

5) Cache busting
- Se actualizo public/app_version.js para forzar refresco de assets y evitar mezcla con cache vieja.

Paso a paso para aplicar
1. Hacer backup de estos archivos actuales en tu proyecto:
   - public/css/responsive.css
   - public/styles.css
   - public/js/table-ui.js
   - public/js/charts.js
   - public/app_version.js

2. Descomprimir este ZIP.

3. Copiar los archivos del parche respetando exactamente la misma estructura de carpetas.

4. Reemplazar los archivos existentes del proyecto por los del parche.

5. Volver a desplegar la app.

6. En el celular:
   - cerrar la pestana o PWA
   - volver a abrir
   - si siguiera cargando version vieja, limpiar cache del sitio / service worker y entrar otra vez

Validaciones recomendadas despues del deploy
- Detalle > filtro de columna Fecha:
  - debe abrir calendario mobile en vez de lista
  - deben poder seleccionarse dias visibles y aplicar filtro

- Acumulados:
  - la columna # debe verse mas angosta
  - la segunda columna debe ocupar menos ancho
  - Kilos, %, Dist. deben ganar visibilidad

- Proyeccion:
  - la primera columna verde/jerarquica debe verse mas compacta
  - deben verse mejor 2025, 2026, Var Kg y Var %

- Graficos:
  - al tocar un punto de Evolucion diaria comparada debe aparecer tooltip

Notas
- El parche fue preparado con criterio mobile-first pero acotado a reglas y comportamientos de mobile.
- No se tocaron contratos backend ni logica de datos.
