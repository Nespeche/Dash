# Validación post-deploy

Este flujo valida que el deploy publicado responda correctamente en endpoints críticos.

## Requisitos

- Haber aplicado el patch completo de optimización.
- Ejecutar el comando desde la raíz real del proyecto `Dash`, donde existe `wrangler.toml`.
- Definir credenciales:
  - `VENTAS_API_BASIC_TOKEN`
  - o `VENTAS_API_USER` y `VENTAS_API_PASS`

## Uso

```bash
npm run validate:postdeploy -- --month 2026-04
```

## Override opcional de rutas/base

Si necesitás forzar otra carpeta raíz del proyecto:

```bash
set POST_DEPLOY_ROOT_DIR=C:\ruta\a\Dash
```

Si necesitás forzar otra API publicada:

```bash
set POST_DEPLOY_API_BASE=https://tu-worker.workers.dev/api
```
