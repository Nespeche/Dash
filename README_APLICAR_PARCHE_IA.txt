PARCHE IA — Ventas Dash

Archivos incluidos:
- worker.js
- public/index.html
- public/app_version.js
- public/app_shared.js
- public/config.js
- public/sw.js
- src/shared/version.js
- src/worker/handlers/dashboard/ai-handler.js

Cambios principales:
1. El chat IA ahora envía la misma autenticación Basic del tablero.
2. El frontend del asistente soporta respuestas JSON y SSE.
3. Se corrigió el parseo de errores para evitar el mensaje "Error: true".
4. El backend AI ahora reutiliza historial reciente en modo JSON.
5. Se simplificó el entrypoint worker.js para evitar desalineación con el backend modular.
6. Se normalizó la consistencia del runtime y se incrementó la versión del app shell para forzar actualización del service worker.
7. En esta copia parcheada, npm run check termina OK.

Aplicación sugerida:
- Hacer backup del proyecto actual.
- Copiar estos archivos respetando las rutas.
- Ejecutar npm run check.
- Commit + push a GitHub.
- Esperar el deploy de Cloudflare o ejecutar wrangler deploy.
- Abrir la app y hacer recarga forzada para tomar el nuevo service worker.
- Probar el asistente con una consulta simple.
