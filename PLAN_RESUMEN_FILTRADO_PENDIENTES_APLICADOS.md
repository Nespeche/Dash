# Plan aplicado · Resumen Filtrado / Detalle Proyectado / Acumulados

## Fase 1 · Simplificación y velocidad
- Reducir foco visible inicial a 50 filas.
- Mantener presets, foco Top N y agrupación en Otros.
- Hidratar en segundo plano el contexto completo para que los filtros de encabezado no dependan de las filas visibles.

## Fase 2 · Exploración ejecutiva
- Llevar toolbar avanzada al detalle proyectado y acumulados.
- Agregar insights automáticos de concentración y mix.
- Agregar comparación entre dos selecciones cuando un filtro de columna tenga exactamente dos valores seleccionados.
- Agregar exportación exacta de la vista visible.

## Fase 3 · Mobile y refinamiento operativo
- Convertir panel avanzado en bottom sheet en mobile.
- Ajustar el copy y la señalización para distinguir contexto cargado vs foco Top N.
- Mantener compatibilidad con checks y arquitectura actual.

## Cambios aplicados en este parche
- Resumen Filtrado y Detalle Proyectado muestran 50 filas como foco inicial.
- Los filtros de encabezado dejan de depender del foco visible y pasan a basarse en el contexto hidratado automáticamente.
- Detalle Proyectado recibe presets, métrica principal, Top N, agrupación en Otros, exportación e insights.
- Acumulados recibe presets, métrica principal, Top N, agrupación en Otros, exportación e insights.
- Se agrega comparación ejecutiva automática cuando una columna tiene exactamente 2 valores seleccionados.
- Se agrega bottom sheet mobile para opciones avanzadas.

## Pendiente fino recomendado
- Si más adelante querés un comparador aún más fuerte, conviene sumar selección manual de filas/entidades para comparar más de dos elementos a la vez.
