PARCHE IA ALINEACION v28

Objetivo
- Alinear el Asistente IA con las fuentes y filtros reales del dashboard.
- Mejorar detección de cliente/producto por código o parte del nombre.
- Reducir discrepancias entre IA vs Resumen Filtrado / Detalle Proyección.

Archivos modificados
- src/worker/handlers/dashboard/ai-handler.js
- src/shared/version.js
- public/app_version.js
- public/app_shared.js
- public/sw.js

Cambios principales
1) Parser de período reforzado
- Reconoce meses completos en texto, abreviaturas y formatos numéricos MM/YYYY y YYYY-MM.
- Si el mes no trae año, pide aclaración.

2) Resolución de entidades mejorada
- Busca clientes y productos en catálogos actual + histórico.
- Acepta código exacto, prefijo numérico y coincidencias parciales por nombre.
- Cuando el texto del chat contradice al dashboard, gana el texto del chat.

3) Fuentes alineadas con dashboard
- Para 2026 con rango de fechas, prioriza una fuente alineada al detalle diario.
- Para 2025 histórico, prioriza la fuente mensual materializada alineada a Proyección/Comparativo.
- Región sigue forzando lectura raw para no perder exactitud cuando la dimensión no está materializada en la fuente alineada.

4) Modos de consulta diferenciados
- summary
- ranking
- compare
- client-delta
- availability

5) Contexto de respuesta más auditable
- Devuelve en contextUsed el tipo de consulta, período y fuentes utilizadas.

Validación local ejecutada
- npm run check
