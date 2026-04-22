PARCHE IA — Integracion 2025/2026 y contexto completo

Archivos modificados:
- src/worker/handlers/dashboard/ai-handler.js
- public/app.js
- public/index.html
- public/app_shared.js
- public/app_version.js
- public/sw.js
- src/shared/version.js

Pasos:
1. Copiar estos archivos sobre el proyecto actual respetando rutas.
2. En la raiz del proyecto ejecutar: npm run check
3. Si el check da OK, desplegar con: npx wrangler deploy
4. Luego abrir la app y hacer recarga forzada para renovar el service worker.
5. Validar desde Network que /api/ai/chat devuelva 200 y que contextUsed refleje fuentes y filtros.

Validaciones sugeridas:
- ventas de febrero 2026
- compara febrero 2025 vs febrero 2026
- top clientes marzo 2026
- clientes perdidos entre febrero 2025 y febrero 2026
- con filtros visibles activos del tablero y con filtros del chat que los contradigan
