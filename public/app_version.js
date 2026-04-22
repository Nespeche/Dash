(function (global) {
  global.__VENTAS_APP_VERSION__ = "20260421-v48-mobile-accum-inline-layout-fix";
  if (typeof global.VentasDash !== "undefined") global.VentasDash.version = global.__VENTAS_APP_VERSION__;
  else global.VentasDash = { version: global.__VENTAS_APP_VERSION__ };
})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : window));
