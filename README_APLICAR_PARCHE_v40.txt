PARCHE Ventas Dash v40
======================

Objetivo
--------
1. Habilitar desplazamiento horizontal de las tarjetas KPI "Kilos por Grupo de Familia"
   con click del botón del medio del mouse en las solapas Detalle y Proyección.
2. Agregar porcentaje de participación dinámico en las visuales de la solapa Gráficos para:
   - Kilos por Grupo
   - Kilos por Marca
   - Kilos por Agente

Archivos incluidos
------------------
- public/app.js
- public/js/charts.js
- public/styles.css
- public/app_version.js
- public/app_shared.js
- public/sw.js
- src/shared/version.js

Validaciones ya ejecutadas sobre esta versión
--------------------------------------------
- npm run check:worker
- npm run check:worker-modules
- npm run check:app
- npm run check:frontend-modules
- npm run check:consistency
- npm run check:state-insights
- npm run check:postdeploy

Aplicación manual
-----------------
1. Hacer backup de la app actual.
2. Descomprimir este ZIP preservando la estructura de carpetas.
3. Copiar y reemplazar los archivos en la raíz del proyecto Dash.
4. Ejecutar validaciones:
   npm run check
5. Publicar / desplegar como de costumbre.
6. Forzar actualización de frontend en navegador:
   - abrir la app
   - hacer hard refresh
   - si sigue mezclando caché, cerrar pestaña y volver a abrir

Pruebas funcionales sugeridas
----------------------------
A. Detalle
   - Ir a la tira de "Kilos por Grupo de Familia"
   - Mantener apretado el botón del medio del mouse sobre la tira
   - Arrastrar horizontalmente y verificar que se desplace
   - Hacer click izquierdo sobre una tarjeta y confirmar que siga filtrando

B. Proyección
   - Repetir la misma prueba sobre la tira de grupos proyectados
   - Confirmar que el detalle por grupo siga funcionando

C. Gráficos
   - Verificar que "Kilos por Grupo", "Kilos por Marca" y "Kilos por Agente"
     muestren kilos + % de participación
   - Cambiar filtros y confirmar que el % cambie de forma dinámica
   - Confirmar que "Kilos por Cliente" quede sin alteraciones funcionales
