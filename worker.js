/**
 * Worker entrypoint.
 *
 * La implementación activa vive en ./src/worker/app.js.
 * Se mantiene este archivo mínimo para evitar duplicación de lógica
 * y para que wrangler.toml siga apuntando al mismo entrypoint.
 */
export { default } from "./src/worker/app.js";
