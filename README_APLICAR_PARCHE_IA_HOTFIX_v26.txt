PARCHE HOTFIX IA v26

Archivos incluidos:
- src/worker/app.js
- src/worker/lib/http.js
- src/worker/handlers/dashboard/ai-handler.js
- src/shared/version.js

Objetivo:
1) Evitar que errores async del handler IA escapen sin CORS/JSON.
2) Forzar await en rutas async del Worker para que el catch global funcione.
3) Asegurar CORS para POST en respuestas JSON.
4) Endurecer ai-handler con fallback y errores JSON legibles.
