# APIs gratuitas recomendadas para Ventas Dash

Catálogo curado de APIs gratuitas que se integran bien con la app. Las dos primeras (**BCRA + Vectorize**) ya quedaron implementadas en v30.

---

## ✅ Ya integradas en v30

### BCRA + dolarapi.com
- **Endpoint app:** `GET /api/bcra/dolar`
- **Widget:** pill USD en header con tooltip de todas las cotizaciones
- **Sin API key**, sin límites significativos
- **Caché:** 10 min server-side + 5 min refresh en cliente

### Cloudflare Vectorize
- **Endpoints app:** `GET /api/vectorize/search`, `POST /api/vectorize/reindex`
- **Modelo embeddings:** `@cf/baai/bge-base-en-v1.5` (768 dims)
- **Free tier:** 5M vectores almacenados, 30M queries/mes
- **Activación:** ver `MEJORAS_v30_README.md` paso 6

---

## 🚀 Top 5 próximas integraciones recomendadas

### 1. Cloudflare Cron Triggers — automatizar carga incremental
**Costo:** $0 (incluido en plan free de Workers)
**Esfuerzo:** bajo (1-2h)
**Beneficio:** disparar `actualizacion_incremental.py` cada noche sin intervención manual.

```toml
# wrangler.toml
[triggers]
crons = ["0 3 * * *"]  # 3:00 AM UTC todos los días
```

```js
// worker.js
async scheduled(event, env, ctx) {
  // Ejecutar lógica de ingesta incremental directo desde el Worker
  // o disparar GitHub Actions vía webhook
}
```

### 2. Resend — reportes diarios por email
**Costo:** 100 mails/día gratis, 3.000/mes
**Esfuerzo:** medio (3-4h)
**Beneficio:** enviar resumen diario al coordinador con KPIs + top 5 movimientos del día.

```js
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}` },
  body: JSON.stringify({
    from: "ventas@tudominio.com",
    to: ["coord@empresa.com"],
    subject: "Resumen Ventas " + new Date().toLocaleDateString("es-AR"),
    html: htmlReport
  })
});
```

### 3. Datos Argentina (datos.gob.ar) — IPC para deflactar
**Costo:** $0
**Esfuerzo:** medio (4-6h)
**Beneficio:** comparar series 2025 vs 2026 ajustadas por inflación. Más útil para análisis de tendencia real.

Endpoint: `https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&format=json`

### 4. Sentry — captura de errores
**Costo:** 5.000 errores/mes gratis
**Esfuerzo:** bajo (1h)
**Beneficio:** ver en dashboard centralizado errores del Worker y errores JS del frontend (especialmente útiles los errores en mobile que el usuario nunca reporta).

```js
// En el worker
import * as Sentry from "@sentry/cloudflare";
Sentry.init({ dsn: env.SENTRY_DSN });
```

### 5. Open-Meteo — clima por región
**Costo:** $0, sin API key, 10k req/día
**Esfuerzo:** medio (3-4h)
**Beneficio:** correlacionar caídas de venta de helados/bebidas con el pronóstico. Particularmente útil si trabajás con productos estacionales.

```js
const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=-34.6&longitude=-58.4&daily=temperature_2m_max,precipitation_sum&timezone=America/Argentina/Buenos_Aires`);
```

---

## 📚 Catálogo extendido

| API | Para qué sirve | Plan free | Sin key? |
|---|---|---|:---:|
| **dolarapi.com** | Cotizaciones USD blue/MEP/CCL/etc | Ilimitado | ✅ |
| **api.bcra.gob.ar** | Tipo de cambio mayorista oficial | Ilimitado | ✅ |
| **Cloudflare Vectorize** | Búsqueda semántica de catálogos | 5M vectores | ❌ |
| **Cloudflare Cron Triggers** | Ingesta automática nocturna | Incluido | ❌ |
| **Cloudflare R2** | Backup de CSV originales | 10 GB storage gratis | ❌ |
| **Cloudflare Analytics Engine** | Métricas de uso del dashboard | 10M writes/mes | ❌ |
| **Resend** | Envío de emails transaccionales | 100/día, 3k/mes | ❌ |
| **Brevo (ex Sendinblue)** | Email + SMS marketing | 300 mails/día | ❌ |
| **Datos Argentina (datos.gob.ar)** | IPC, índices, datos macro | Ilimitado | ✅ |
| **Open-Meteo** | Clima histórico y forecast | 10k req/día | ✅ |
| **Nominatim / OSM** | Geocoding de direcciones | 1 req/seg | ✅ |
| **MapTiler** | Mapas para visualización geo | 100k tiles/mes | ❌ |
| **Mapbox** | Mapas premium | 50k cargas/mes | ❌ |
| **REST Countries** | Datos de países (banderas, etc) | Ilimitado | ✅ |
| **ExchangeRate.host** | Conversión multi-moneda histórica | Ilimitado | ✅ |
| **ipapi.co** | Geolocalización por IP | 1k req/día | ✅ |
| **ipinfo.io** | Geolocalización por IP (más datos) | 50k req/mes | ❌ |
| **Sentry** | Captura de errores | 5k errores/mes | ❌ |
| **Plausible (self-host)** | Analítica de uso sin cookies | $0 si self-host | ❌ |
| **Umami (self-host)** | Analítica de uso sin cookies | $0 si self-host | ❌ |
| **Cloudflare Web Analytics** | Pageviews + Core Web Vitals | Ilimitado | ❌ |
| **Logflare** | Logs estructurados | 10k/día | ❌ |
| **Better Stack** | Logs + uptime monitoring | 1 monitor + 1 logs | ❌ |
| **Hugging Face Inference API** | LLMs alternativos a Workers AI | 30k req/mes | ❌ |
| **Replicate** | Modelos ML (predicción de demanda) | $0 trial, luego pay | ❌ |

---

## 💡 Ideas de integración para tu caso específico

### A. Predicción de demanda con embeddings
Usando Vectorize ya integrado: indexar series temporales de venta de cada cliente como embeddings. Después podés clusterizar clientes con patrón de compra similar y usar eso para identificar clientes "en riesgo de fuga" (su patrón empieza a parecerse al de clientes históricamente perdidos).

### B. Alertas inteligentes vía cron + email
Cron job nocturno → corre query de variación día/día → si algún coordinador o grupo cae más de N% → manda email de alerta vía Resend. El asistente IA puede armar el texto del email.

### C. Dashboard público read-only
Subdominio sin auth con un endpoint `/api/state-public` que devuelve solo KPIs agregados (sin nombres de clientes/agentes). Útil para mostrar a un comité directivo sin exponer data sensible.

### D. Mobile app vía Pages
La app ya está en HTML/CSS/JS puro. Agregar un wrapper de Capacitor o convertirla a PWA instalable (ya tiene `manifest.json` y `sw.js`) lleva ~1 día. Cero costo de API store gratis si distribuís solo PWA.
