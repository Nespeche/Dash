// Configuracion del frontend.
//
// Si en el futuro cambias el Worker, actualiza la URL en apiBase.
// Unica fuente de verdad para el namespace window.VentasDash.
(function (global) {
  global.VentasDash = Object.assign(global.VentasDash || {}, {
    apiBase: "https://ventas-d1-api-proyeccion-v2.pechenicolas.workers.dev/api"
  });
  // Compatibilidad con código existente que lee __VENTAS_APP_CONFIG__
  global.__VENTAS_APP_CONFIG__ = Object.assign({
    apiBase: "https://ventas-d1-api-proyeccion-v2.pechenicolas.workers.dev/api"
  }, global.__VENTAS_APP_CONFIG__ || {});
})(window);
