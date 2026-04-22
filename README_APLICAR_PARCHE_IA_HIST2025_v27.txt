Parche IA histórico 2025 v27

Archivos modificados:
- src/worker/lib/scope.js
- src/worker/handlers/dashboard/ai-handler.js
- src/shared/version.js
- public/app_version.js

Motivo:
La IA estaba consultando h.Registros sobre ventas_2025_mes_scope, pero esa tabla no tiene esa columna.

Corrección:
- scope histórico 2025 expone kilos y registros coherentes con la materialización actual
- para registros en ventas_2025_mes_scope se usa 1 por fila agregada, igual que projection/compare-handler
- ai-handler deja de referenciar h.Registros y usa scoped.columns.*
