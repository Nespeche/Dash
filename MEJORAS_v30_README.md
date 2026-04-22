# Ventas Dash · v30 — Mejoras IA + UX + Acumulado + BCRA

**Fecha de release:** 2026-04-15
**Versión técnica:** `20260415-v30-ai-uxd-acumulado-bcra`

---

## 🎯 Resumen ejecutivo

Esta versión implementa los 7 pedidos puntuales del usuario:

| # | Pedido | Implementación |
|---|---|---|
| 1 | IA más inteligente con mejor vínculo a D1 | Modelo `llama-3.3-70b-instruct-fp8-fast` con cadena de fallback, captura completa del contexto del tablero (filtros, labels, vista activa, configuración de proyección), 5 nuevos intents (top-movers, projection, trend, explain, help), system prompt reescrito con reglas duras |
| 2 | UX moderna, ágil, intuitiva | KPIs con gradientes, hover lift, transiciones suaves, theme toggle 1-click, anti-FOUC, BCRA pill en header con tooltip |
| 3 | Mejor diseño visual y gráficos | Paleta refrescada, sombras semánticas (sm/md/lg), gradientes en KPIs y mode buttons, line/donut charts adaptados a light mode |
| 4 | Mejorar colores | Variables CSS rediseñadas + **modo claro completo** (`data-theme="light"`) con persistencia |
| 5 | Mejorar filtros | Pills con hover lift, filter-count-chip con gradiente, soporte responsive mejorado |
| 6 | Tabla acumulada similar a Resumen Filtrado | **Nueva pestaña "Resumen Acumulado"** con 3 modos (corrido / total dataset / YTD vs 2025) × 5 vistas (detalle / cliente / grupo / producto / fecha) |
| 7 | APIs gratuitas | **BCRA + dolarapi** integradas (widget en header) + **Cloudflare Vectorize** integrado para búsqueda semántica (binding opcional). Ver `APIS_GRATUITAS.md` para más recomendaciones |

---

## 📦 Archivos modificados

### Backend / Worker
- `src/shared/version.js` → bump a v30
- `src/worker/handlers/dashboard/ai-handler.js` → modelo 70B, fallback chain, contexto completo, 5 intents, prompt reescrito
- `src/worker/handlers/dashboard/index.js` → exports nuevos
- `src/worker/app.js` → 4 endpoints nuevos
- `wrangler.toml` → bindings Vectorize opcionales documentados

### Backend / Worker (NUEVOS)
- `src/worker/handlers/dashboard/accum-summary-handler.js` — endpoint `/api/accum-summary`
- `src/worker/handlers/dashboard/bcra-handler.js` — endpoint `/api/bcra/dolar`
- `src/worker/handlers/dashboard/vectorize-handler.js` — endpoints `/api/vectorize/*`

### Frontend
- `public/app_version.js` → bump a v30
- `public/styles.css` → variables refrescadas + bloque `:root[data-theme="light"]` + ~150 líneas v30
- `public/index.html` → BCRA pill + theme toggle en header, anti-FOUC inline script, nueva tab "Resumen Acumulado", página completa `#page-resumen-acum`
- `public/app.js` → `TAB_RESUMEN_ACUM` registrada, `renderResumenAcumuladoPage` nueva, `initThemeAndWidgets` lazy

### Frontend (NUEVOS)
- `public/js/accumulated-summary.js` — controlador de la nueva tabla
- `public/js/bcra-widget.js` — widget de cotización USD
- `public/js/theme-toggle.js` — toggle dark/light persistente

### Documentación (NUEVOS)
- `MEJORAS_v30_README.md` (este archivo)
- `APIS_GRATUITAS.md` — catálogo extendido de APIs gratuitas integrables

---

## 🚀 Pasos para aplicar

### Pre-requisitos
- Wrangler instalado y autenticado (`wrangler login`)
- Acceso al proyecto Cloudflare con D1 + Workers AI habilitado
- Proyecto Pages para `/public`

### Paso 1 — Reemplazar archivos
Descomprimí el ZIP sobre tu carpeta `Dash/` actual respetando la estructura. Los archivos nuevos se sumarán; los modificados se reemplazarán.

```bash
cd C:\ruta\a\Dash
# Hacé backup antes:
cp -r . ../Dash.backup.20260415

# Después descomprimí encima
unzip -o Dash_v30.zip
```

### Paso 2 — Verificar dependencias

```bash
npm install   # si hay cambios en package.json (no los hay)
node --check src/worker/app.js
node --check public/app.js
```

### Paso 3 — Deploy del Worker

```bash
wrangler deploy
```

Esto activa: nuevo modelo IA, endpoints `/api/accum-summary`, `/api/bcra/dolar`, `/api/vectorize/*`. **Vectorize devolverá 503 hasta configurar bindings (paso 6).**

### Paso 4 — Deploy del frontend (Pages)

Si tu pipeline auto-deploya desde git, hacé commit + push.
Si lo hacés manual:

```bash
wrangler pages deploy public --project-name=<tu-pages-project>
```

### Paso 5 — Validación rápida en producción

```bash
# Health
curl https://ventas-d1-api-proyeccion-v2.<tu-subdomain>.workers.dev/api/health

# BCRA (sin auth - cacheado 10min)
curl -u user:pass https://...workers.dev/api/bcra/dolar

# Accum-summary (con auth)
curl -u user:pass "https://...workers.dev/api/accum-summary?mode=running&view=cliente&limit=10"

# IA (con auth, POST)
curl -u user:pass -X POST -H "content-type: application/json" \
  -d '{"message":"Top 5 clientes del mes"}' \
  https://...workers.dev/api/ai/chat
```

En el frontend deberías ver:
- ✅ Botón theme toggle (🌓) en header — clic alterna dark/light
- ✅ Pill USD con cotización en header (al lado del toggle)
- ✅ Nueva tab "📚 Resumen Acumulado" en la barra de tabs
- ✅ KPIs con gradientes, hover lift sutil
- ✅ Asistente IA respondiendo más detallado y mencionando filtros activos

### Paso 6 (OPCIONAL) — Activar Vectorize para búsqueda semántica

Si querés que el asistente IA pueda encontrar clientes/productos por descripción libre (ej: "el cliente que compra carne para el sur"):

```bash
# Crear los índices (una sola vez)
wrangler vectorize create ventas-clientes  --dimensions=768 --metric=cosine
wrangler vectorize create ventas-productos --dimensions=768 --metric=cosine
```

Editar `wrangler.toml` y descomentar los bloques `[[vectorize]]`. Hacer `wrangler deploy`.

Indexar los catálogos (one-shot, después podés re-correrlo cuando agregues clientes/productos):

```bash
curl -u user:pass -X POST -H "content-type: application/json" \
  -d '{"type":"clientes"}' \
  https://...workers.dev/api/vectorize/reindex

curl -u user:pass -X POST -H "content-type: application/json" \
  -d '{"type":"productos"}' \
  https://...workers.dev/api/vectorize/reindex
```

Probar:

```bash
curl -u user:pass "https://...workers.dev/api/vectorize/search?q=lacteos&type=productos&limit=5"
```

---

## 🧠 Detalle de mejoras de IA

### Modelo más potente con cadena de fallback
- **Primario:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (8x más parámetros que antes)
- **Fallback 1:** `@cf/meta/llama-3.1-70b-instruct`
- **Fallback 2:** `@cf/meta/llama-3.1-8b-instruct` (el original)
- **Fallback final:** respuesta manual generada con datos estructurados

Si Workers AI tiene cuota agotada o un modelo está caído, el handler prueba con el siguiente automáticamente. Te enterás del modelo realmente usado en `contextUsed.model` del response.

### Contexto completo del tablero
Antes la IA recibía solo códigos (`MIENKO`, `MNK`, etc). Ahora recibe **labels legibles** + sub-modo del explorador + configuración de proyección activa. Eso le permite responder cosas como:

> *"Considerando el coordinador MIENKO (Mauricio Inkenpov) y el grupo SECCION TODO, en marzo 2026 se vendieron 145.230 kg vs 128.500 kg en marzo 2025 (+13%)..."*

### Nuevos intents detectados
| Intent | Trigger en la pregunta | Modo de respuesta |
|---|---|---|
| `wantsTopMovers` | "que más creció", "que cayó más" | `top-movers` |
| `wantsProjection` | "proyección", "cierre del mes", "estimación" | `projection` |
| `wantsTrend` | "tendencia", "evolución", "serie", "mensual" | datos en `compare` |
| `wantsExplain` | "por qué", "qué pasó", "explicame" | enrichece con rankings |
| `wantsHelp` | "qué podés hacer", "ayuda", "cómo te uso" | `help` |

### System prompt con reglas duras
10 reglas numeradas que el modelo debe respetar:
1. Español rioplatense
2. No inventar datos
3. Respetar instrucciones de aclaración
4. Comparativas siempre con kilos + variación absoluta + porcentual
5. Rankings: top 3-5
6. "Por qué" → identificar dimensión que más cambió
7. Mencionar filtros activos al inicio si son relevantes
8. Sugerir Proyección si falta data
9. Máximo 280 palabras
10. Cifras con miles separados + unidad "kg"

---

## 📊 Detalle del nuevo Resumen Acumulado

### Modos
- **⏱ Corrido**: respeta filtros + rango de fechas. Devuelve cada fila (o agregado) ordenado por kilos descendente, con columna `Acumulado` que es la suma corrida del top.
- **∑ Total dataset**: ignora el rango de fechas, respeta los demás filtros. Útil para ver el peso real de cada cliente/grupo a lo largo de toda la base histórica vigente.
- **📅 YTD vs 2025**: year-to-date 2026 (1° enero hasta última fecha disponible) vs mismo rango 2025. Muestra `kilos 2026`, `kilos 2025`, `var Kg`, `var %`, `% participación 2026`. Marca los items con tag `perdido` si existían en 2025 pero no tienen ventas en 2026.

### Vistas
- Detalle (filas crudas con running total cronológico)
- Cliente / Grupo / Producto / Fecha (agregadas)

### Endpoint
```
GET /api/accum-summary?mode=<running|total|ytd>&view=<detalle|cliente|grupo|producto|fecha>&limit=500&desde=&hasta=&coordinador=&agente=&cliente=&grupo=&marca=&codProd=
```

---

## 💵 BCRA Widget

Pill en header que muestra cotización USD oficial (vendedor). Al hover, tooltip con todas las cotizaciones (oficial, blue, MEP, CCL, mayorista, tarjeta).

- Refresh automático cada 5 min en el cliente
- Caché de 10 min en CF Workers (Cache API)
- Doble fuente: BCRA oficial + dolarapi.com (degradación elegante si una falla)
- No requiere API key

---

## 🌓 Theme Toggle

Botón 🌓 en el header. Persiste en `localStorage["ventasDashTheme"]`. Respeta `prefers-color-scheme` la primera vez.

Implementado con anti-FOUC: hay un script inline en `<head>` que aplica el atributo `data-theme="light"` al `<html>` antes del primer paint, así no parpadea de oscuro a claro al cargar.

---

## 🔄 Rollback

Si algo sale mal:

```bash
# Revertir Worker a versión previa
cd ../Dash.backup.20260415
wrangler deploy

# Revertir Pages
wrangler pages deploy public --project-name=<tu-pages-project>
```

El cambio de modelo IA es la única modificación con riesgo de cuota. Si Workers AI agota neuronas, la cadena de fallback ya garantiza que el chat sigue respondiendo (peor caso: con el modelo 8B viejo o con la respuesta manual).

---

## ✅ Checklist post-deploy

- [ ] `/api/health` responde 200
- [ ] `/api/bcra/dolar` devuelve `{ok:true, bcra:..., dolares:[...]}`
- [ ] Pill USD aparece en el header con un valor
- [ ] Theme toggle alterna correctamente y persiste tras recargar
- [ ] Tab "Resumen Acumulado" carga datos en modo Corrido + vista Cliente
- [ ] Cambiar a modo "YTD vs 2025" muestra columnas Var Kg / Var % / % Total 2026
- [ ] Asistente IA responde más detallado que antes y menciona los filtros activos
- [ ] (Opcional) Si configuraste Vectorize: `/api/vectorize/search?q=...&type=clientes` devuelve resultados
