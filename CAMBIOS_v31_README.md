# Ventas Dash v31 — Guía de aplicación

**Fecha de release:** 2026-04-16
**Versión técnica:** `20260416-v31-ux-ia-observabilidad`
**Basado en:** v30 (2026-04-15)

---

## 🎯 Qué incluye este parche

### Sprint 1-A — Visual (frontend)
- **Design tokens formales** en `public/css/tokens.css` — 3 capas (primitives, semantic, component)
- **KPIs con delta + sparkline inline** cuando hay rango de fechas activo.
- **Empty states mejorados** con CTA accionable.
- **Microinteracciones**: hover lift, focus ring, tab underline animado, theme toggle rotando, chips animados.
- **Tabular-nums** en columnas numéricas.
- **Skeletons refinados** con shimmer suave.

### Sprint 1-B — Backend y observabilidad
- **Endpoint `/api/ai/feedback`** (POST) — persiste thumbs up/down en D1.
- **Endpoint `/api/ai/feedback-stats`** (GET) — métricas agregadas.
- **Endpoint `/api/sparkline`** (GET) — series optimizadas para KPIs.
- **Sentry-lite** — captura de errores sin SDK. No-op si DSN no configurado.
- **Cron trigger** (comentado, opcional) en wrangler.toml.

### Sprint 2-A — Asistente IA (opt-in)
- **Streaming SSE real**: `body.stream === true` → respuesta palabra por palabra.
- **Fast-path determinista**: `body.fast === true` → respuesta instantánea sin LLM.
- **UI toggles** "Stream"/"Rápido" en footer del panel IA.
- **Analytics Engine** (opcional): tracking de latencia/modelo/intent.

### Sprint 3 — Tablas BI y gráficos interactivos (100% frontend)
- **Vistas guardadas (⭐ Marcadores)**: botón en header. Dropdown para guardar/aplicar/borrar. Hasta 20 en localStorage.
- **Multi-sort con Shift+Click**: en cabeceras. Badges numerados (1,2,3). Hasta 3 niveles.
- **Row-details drawer**: doble-click en fila → panel lateral con sparkline 60d + 3 acciones (preguntar a IA, filtrar tablero, copiar resumen).
- **Cross-filter en gráficos**: clic en barras de Grupos/Marcas/Donut aplica el filtro al tablero.

### Sprint 4 — Integraciones externas (todas opcionales)
- **`/api/ipc`** — proxy a datos.gob.ar con IPC nacional (serie INDEC). Cache 6h. Habilita deflactor de inflación.
- **`/api/email/report`** (POST) — reportes HTML por email vía Resend. Plan free 100/día.
- **Panel `/admin/ai-stats.html`** — dashboard HTML estático con totales de thumbs, % satisfacción, últimos 50 ratings.

---

## 📦 Archivos nuevos (20)

```
public/css/tokens.css
public/css/v31-enhancements.css
public/js/v31/kpi-delta.js
public/js/v31/empty-states.js
public/js/v31/ai-suggestions.js
public/js/v31/ai-feedback.js
public/js/v31/ai-enhancements.js
public/js/v31/bookmarks.js
public/js/v31/multi-sort.js
public/js/v31/row-drawer.js
public/js/v31/chart-crossfilter.js
public/admin/ai-stats.html
src/worker/lib/sentry-lite.js
src/worker/lib/analytics.js
src/worker/lib/resend.js
src/worker/handlers/dashboard/ai-feedback-handler.js
src/worker/handlers/dashboard/sparkline-handler.js
src/worker/handlers/dashboard/ipc-handler.js
src/worker/handlers/dashboard/email-handler.js
CAMBIOS_v31_README.md
```

## 📝 Archivos modificados (10)

```
src/shared/version.js                        → bump a v31
public/app_version.js                        → bump a v31
public/app_shared.js                         → bump fallback a v31
public/sw.js                                 → bump + assets v31 en shell
public/index.html                            → +11 líneas (CSS y scripts v31)
src/worker/handlers/dashboard/index.js       → +5 exports
src/worker/app.js                            → +5 rutas + Sentry + scheduled()
src/worker/handlers/dashboard/ai-handler.js  → fast-path + streaming opt-in + tracking
wrangler.toml                                → bloques opcionales comentados
package.json                                 → check:v31
```

---

## 🚀 Cómo aplicar

### Paso 0 — Backup
```bash
cp -r Dash Dash.backup.v30
```

### Paso 1 — Descomprimir sobre Dash/
```bash
cd /ruta/a/tu/proyecto
unzip -o Dash_v31.zip
```

**Windows (PowerShell):**
```powershell
Expand-Archive -Path Dash_v31.zip -DestinationPath . -Force
```

### Paso 2 — Validar sintaxis
```bash
cd Dash
npm run check        # debe pasar TODOS los checks en verde
npm run check:v31    # check específico de los 16 archivos v31
```

Output esperado:
```
[ok] backend modular consistente
[ok] frontend consistente
[ok] version=20260416-v31-ux-ia-observabilidad
VALIDACION STATE/INSIGHTS OK
```

### Paso 3 — Deploy del Worker
```bash
wrangler deploy
```

Activa: 6 endpoints nuevos + streaming opt-in en `/api/ai/chat`.

### Paso 4 — Deploy del frontend (Pages)
```bash
git add . && git commit -m "feat: v31 - UX, IA, observabilidad, integraciones" && git push
# o
wrangler pages deploy public --project-name=<tu-pages-project>
```

### Paso 5 — Validación en producción

```bash
curl https://...workers.dev/api/health
curl -u user:pass "https://...workers.dev/api/sparkline?auto=1&limit=30"
curl -u user:pass "https://...workers.dev/api/ai/feedback-stats"
curl -u user:pass "https://...workers.dev/api/ipc?limit=24"
curl -u user:pass -N -X POST -H "content-type: application/json" \
  -d '{"message":"Top 5 clientes del mes","stream":true}' \
  https://...workers.dev/api/ai/chat
```

### Paso 6 — Verificación frontend

- ✅ KPIs con delta y sparkline cuando hay rango activo
- ✅ Botón ⭐ en header para marcadores
- ✅ Shift+click en cabeceras → multi-sort con badges 1,2,3
- ✅ Doble-click en filas → drawer lateral
- ✅ Clic en barras → filtra el tablero
- ✅ Asistente IA con sugerencias dinámicas, 👍/👎 y toggles Stream/Rápido
- ✅ `/admin/ai-stats.html` carga con Basic Auth

---

## 🧪 Activaciones opcionales

### Sentry
```toml
[vars]
SENTRY_DSN = "https://xxxxx@oYYY.ingest.sentry.io/ZZZ"
SENTRY_ENV = "production"
```

### Analytics Engine
```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "ventas_dash_analytics"
```

### Resend (emails)
Mejor práctica: usá `wrangler secret put` para la key.
```bash
wrangler secret put RESEND_API_KEY
```
Y el resto:
```toml
[vars]
RESEND_FROM = "ventas@tudominio.com"
RESEND_TO   = "coord@empresa.com"
```

Ejemplo POST `/api/email/report`:
```json
{
  "to": "coord@empresa.com",
  "title": "Reporte diario",
  "kpis": [
    {"label":"Total Kilos","value":"145.230","delta":"+13% vs ayer","deltaPositive":true},
    {"label":"Clientes","value":"487"}
  ],
  "highlights": ["MIENKO creció 18%","Grupo X pesa 42% del total"]
}
```

### Cron Trigger
```toml
[triggers]
crons = [ "0 11 * * MON-FRI" ]
```

Conectá `scheduled()` en `src/worker/app.js` con `sendEmail` + `/api/state`.

---

## 🔄 Rollback

```bash
# Worker
cd ../Dash.backup.v30 && wrangler deploy

# Pages
wrangler pages deploy public --project-name=<tu-pages-project>
```

O más granular: borrar `public/css/`, `public/js/v31/`, `public/admin/` y revertir las 11 líneas en `index.html`.

---

## ✅ Checklist post-deploy

- [ ] `/api/health` responde 200
- [ ] `/api/sparkline?auto=1&limit=30` devuelve points
- [ ] `/api/ai/feedback` POST registra en D1
- [ ] `/api/ai/feedback-stats` devuelve totals
- [ ] `/api/ipc?limit=24` devuelve puntos IPC
- [ ] `/api/email/report` responde 502 sin key (esperado)
- [ ] KPIs con delta + sparkline
- [ ] Marcadores, multi-sort, drawer, cross-filter funcionan
- [ ] Stream/Rápido toggles responden
- [ ] `/admin/ai-stats.html` carga

---

## 🚨 Lo que este parche NO incluye

- Tool-calling completo del asistente (requiere refactor profundo)
- Brush temporal en line chart
- Overlay 2025/2026 en line chart
- Sparklines por fila (endpoint existe, falta inyectar en celda)
- Filtros por columna con operadores tipo Airtable
- Migración a R2 (N/A plan free)
- Telegram Bot
- Tests automatizados
- PWA con offline splash dedicado
- Integración AFIP

---

## 📞 Troubleshooting

| Problema | Solución |
|---|---|
| `npm run check` falla | `npm run check:v31` para aislar el archivo |
| KPIs sin delta/sparkline | DevTools Network: `/api/state` debe responder 200. Console: buscar `[v31/kpi-delta]` |
| Marcadores no persisten | localStorage lleno/bloqueado. DevTools → Application → Storage |
| Streaming IA se corta | Desactivar "Stream" en footer → vuelve a JSON. Backend cae a buildManualAnswer si falla |
| Email no se envía | Verificar `RESEND_API_KEY` y dominio verificado en Resend |
| /admin/ai-stats: "Auth inválida" | Loggearse primero en tablero principal, mismo browser |
