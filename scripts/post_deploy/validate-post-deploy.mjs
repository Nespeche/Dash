#!/usr/bin/env node
import process from "node:process";
import { ensureConfigConsistency, getMonthWindow, readConfiguredApiBase, readLocalAppVersion, readWranglerName, resolveApiBase, resolveBasicAuthHeader } from "./config.mjs";
import { getJson } from "./http.mjs";

function printHelp() {
  console.log(`Validación post-deploy de Ventas Dash\n\nUso:\n  node scripts/post_deploy/validate-post-deploy.mjs [--month YYYY-MM]\n\nVariables requeridas:\n  VENTAS_API_BASIC_TOKEN\n    o bien\n  VENTAS_API_USER y VENTAS_API_PASS\n\nVariables opcionales:\n  POST_DEPLOY_API_BASE   Sobrescribe la apiBase de public/config.js\n  POST_DEPLOY_MONTH      Mes a validar si no se pasa --month\n`);
}

function parseArgs(argv) {
  const args = { month: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }
    if (value === "--month") {
      args.month = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    throw new Error(`Argumento no soportado: ${value}`);
  }
  return args;
}

function buildQuery(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach(item => qs.append(key, String(item)));
    } else {
      qs.set(key, String(value));
    }
  }
  return `${path}?${qs.toString()}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}


function formatKeys(obj) {
  return Object.keys(obj || {}).sort().join(", ");
}

function buildRollingMonthRange(monthWindow, span = 3) {
  const end = new Date(Date.UTC(monthWindow.year, monthWindow.month, 0));
  const start = new Date(Date.UTC(monthWindow.year, monthWindow.month - span, 1));
  return {
    desde: start.toISOString().slice(0, 10),
    hasta: end.toISOString().slice(0, 10)
  };
}

function shiftIsoToYear(isoDate, targetYear) {
  const [_, month, day] = String(isoDate || "").split("-");
  return `${targetYear}-${month}-${day}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const workerName = await readWranglerName();
  const configuredApiBase = await readConfiguredApiBase();
  const localAppVersion = await readLocalAppVersion();
  const apiBase = resolveApiBase({ configuredApiBase });
  const authHeader = resolveBasicAuthHeader();
  const monthWindow = getMonthWindow(args.month);
  const { host } = ensureConfigConsistency({ workerName, apiBase });

  const headers = {
    Authorization: authHeader,
    Accept: "application/json"
  };

  console.log(`[config] worker=${workerName}`);
  console.log(`[config] apiBase=${apiBase}`);
  console.log(`[config] host=${host}`);
  const rollingRange = buildRollingMonthRange(monthWindow, 3);
  console.log(`[config] month=${monthWindow.monthKey}`);
  console.log(`[config] localAppVersion=${localAppVersion}`);
  console.log(`[config] rollingRange=${rollingRange.desde}..${rollingRange.hasta}`);

  const results = [];
  async function runCheck(name, path, validate) {
    const url = `${apiBase}${path}`;
    const { payload, elapsedMs } = await getJson({ name, url, headers });
    await validate(payload);
    results.push({ name, url, elapsedMs });
    console.log(`[ok] ${name} (${elapsedMs} ms)`);
    return payload;
  }

  const health = await runCheck("health", "/health", payload => {
    assert(payload.ok === true, "health: ok debe ser true.");
    assert(typeof payload.appVersion === "string" && payload.appVersion, "health: falta appVersion.");
    assert(payload.appVersion === localAppVersion, `health: appVersion remoto (${payload.appVersion}) no coincide con el local (${localAppVersion}).`);
    assert(typeof payload.dataVersion === "string" && payload.dataVersion, "health: falta dataVersion.");
    assert(payload.status && typeof payload.status.ready === "boolean", "health: falta status.ready.");
    assert(payload.materialized && typeof payload.materialized.ventasDiaScope === "boolean", `health: falta materialized.ventasDiaScope. materialized=[${formatKeys(payload.materialized)}]`);
    assert(typeof payload.materialized.ventasMesScope === "boolean", `health: falta materialized.ventasMesScope. materialized=[${formatKeys(payload.materialized)}]`);
    assert(typeof payload.materialized.ventasScopeDim === "boolean", `health: falta materialized.ventasScopeDim. materialized=[${formatKeys(payload.materialized)}]`);
  });

  const baseFilters = {
    desde: monthWindow.desde,
    hasta: monthWindow.hasta
  };

  const state = await runCheck("state", buildQuery("/state", baseFilters), payload => {
    assert(payload.ok === true, "state: ok debe ser true.");
    assert(payload.kpis && typeof payload.kpis.kilos === "number", "state: falta kpis.kilos.");
    assert(payload.options && Array.isArray(payload.options.coordinadores), "state: falta options.coordinadores.");
    assert(payload.meta && typeof payload.meta.dataVersion === "string", "state: falta meta.dataVersion.");
  });

  await runCheck("detail", buildQuery("/detail", { ...baseFilters, limit: 5, offset: 0 }), payload => {
    assert(payload.ok === true, "detail: ok debe ser true.");
    assert(Array.isArray(payload.headers), "detail: headers debe ser array.");
    assert(Array.isArray(payload.rows), "detail: rows debe ser array.");
  });

  await runCheck("insights", buildQuery("/insights", baseFilters), payload => {
    assert(payload.ok === true, "insights: ok debe ser true.");
    assert(payload.rankings && Array.isArray(payload.rankings.grupos), "insights: falta rankings.grupos.");
    assert(payload.charts && Array.isArray(payload.charts.lineMensual), "insights: falta charts.lineMensual.");
  });

  const catalogClientes = await runCheck("catalog-clientes", buildQuery("/catalog", { ...baseFilters, kind: "clientes", limit: 3 }), payload => {
    assert(payload.ok === true, "catalog-clientes: ok debe ser true.");
    assert(payload.kind === "clientes", "catalog-clientes: kind inválido.");
    assert(Array.isArray(payload.items), "catalog-clientes: items debe ser array.");
  });

  await runCheck("catalog-productos", buildQuery("/catalog", { ...baseFilters, kind: "productos", limit: 3 }), payload => {
    assert(payload.ok === true, "catalog-productos: ok debe ser true.");
    assert(payload.kind === "productos", "catalog-productos: kind inválido.");
    assert(Array.isArray(payload.items), "catalog-productos: items debe ser array.");
  });

  await runCheck(
    "projection-compare",
    buildQuery("/projection-compare", {
      ...baseFilters,
      compareYear: 2025,
      compareMonth: monthWindow.month
    }),
    payload => {
      assert(payload.ok === true, "projection-compare: ok debe ser true.");
      assert(payload.current && typeof payload.current.kilos === "number", "projection-compare: falta current.kilos.");
      assert(payload.compare && typeof payload.compare.label === "string", "projection-compare: falta compare.label.");
      assert(payload.compare.mode === "month", "projection-compare: el caso mensual debe devolver compare.mode='month'.");
      assert(payload.meta && typeof payload.meta.historicalSource === "string", "projection-compare: falta meta.historicalSource.");
    }
  );

  const projectionRangeFilters = {
    desde: rollingRange.desde,
    hasta: rollingRange.hasta,
    compareYear: 2025,
    compareMode: "range"
  };

  await runCheck(
    "projection-compare-range",
    buildQuery("/projection-compare", projectionRangeFilters),
    payload => {
      assert(payload.ok === true, "projection-compare-range: ok debe ser true.");
      assert(payload.compare && payload.compare.mode === "range", "projection-compare-range: compare.mode debe ser 'range'.");
      assert(payload.compare.desde === shiftIsoToYear(rollingRange.desde, 2025), "projection-compare-range: compare.desde no coincide con el rango LY esperado.");
      assert(payload.compare.hasta === shiftIsoToYear(rollingRange.hasta, 2025), "projection-compare-range: compare.hasta no coincide con el rango LY esperado.");
      assert(payload.meta && typeof payload.meta.historicalSource === "string", "projection-compare-range: falta meta.historicalSource.");
      assert(payload.meta.historicalSource !== "ventas_2025_snapshot_month", "projection-compare-range: no debe usar snapshot mensual historico para rangos multi-mes.");
    }
  );

  const selectedClient = catalogClientes.items?.[0]?.codigo || state.options?.clientes?.[0]?.codigo || "";
  if (selectedClient) {
    await runCheck("state-filtered-month-scope", buildQuery("/state", { ...baseFilters, cliente: selectedClient }), payload => {
      assert(payload.ok === true, "state-filtered-month-scope: ok debe ser true.");
      assert(payload.kpis && typeof payload.kpis.kilos === "number", "state-filtered-month-scope: falta kpis.kilos.");
      assert(payload.meta && payload.meta.stateMode === "phase-8-state-current-month-scope", "state-filtered-month-scope: debe usar el fast path mensual compacto.");
    });

    await runCheck("insights-filtered-month-scope", buildQuery("/insights", { ...baseFilters, cliente: selectedClient }), payload => {
      assert(payload.ok === true, "insights-filtered-month-scope: ok debe ser true.");
      assert(payload.meta && payload.meta.insightsMode === "phase-8-current-month-scope", "insights-filtered-month-scope: debe usar el fast path mensual compacto.");
      assert(payload.rankings && Array.isArray(payload.rankings.clientes), "insights-filtered-month-scope: falta rankings.clientes.");
    });

    await runCheck("detail-filtered-day-scope", buildQuery("/detail", { ...baseFilters, cliente: selectedClient, limit: 5, offset: 0 }), payload => {
      assert(payload.ok === true, "detail-filtered-day-scope: ok debe ser true.");
      assert(payload.meta && payload.meta.detailMode === "phase-9-detail-day-scope", "detail-filtered-day-scope: debe usar el fast path diario compacto.");
      assert(Array.isArray(payload.rows), "detail-filtered-day-scope: rows debe ser array.");
    });

    await runCheck("projection-compare-filtered-month-scope", buildQuery("/projection-compare", { ...baseFilters, compareYear: 2025, compareMonth: monthWindow.month, cliente: selectedClient }), payload => {
      assert(payload.ok === true, "projection-compare-filtered-month-scope: ok debe ser true.");
      assert(payload.meta && payload.meta.currentSource === "ventas_mes_scope+ventas_scope_dim", "projection-compare-filtered-month-scope: debe usar currentSource compacto.");
      assert(payload.meta && typeof payload.meta.historicalSource === "string", "projection-compare-filtered-month-scope: falta historicalSource.");
    });
  }

  const projectionDetailParams = {
    ...baseFilters,
    compareYear: 2025,
    compareMonth: monthWindow.month,
    limit: 5,
    offset: 0,
    cliente: selectedClient
  };

  await runCheck("projection-detail", buildQuery("/projection-detail", projectionDetailParams), payload => {
    assert(payload.ok === true, "projection-detail: ok debe ser true.");
    assert(Array.isArray(payload.headers), "projection-detail: headers debe ser array.");
    assert(Array.isArray(payload.rows), "projection-detail: rows debe ser array.");
    assert(payload.summary && typeof payload.summary.projectedDate === "string", "projection-detail: falta summary.projectedDate.");
    assert(payload.meta && payload.meta.currentSource === "ventas_mes_scope+ventas_scope_dim", "projection-detail: debe usar currentSource compacto para el dataset actual.");
  });

  await runCheck("projection-detail-range", buildQuery("/projection-detail", {
    ...projectionRangeFilters,
    limit: 5,
    offset: 0,
    cliente: selectedClient
  }), payload => {
    assert(payload.ok === true, "projection-detail-range: ok debe ser true.");
    assert(Array.isArray(payload.headers), "projection-detail-range: headers debe ser array.");
    assert(Array.isArray(payload.rows), "projection-detail-range: rows debe ser array.");
    assert(payload.summary && payload.summary.projectedDate === rollingRange.hasta, "projection-detail-range: summary.projectedDate debe coincidir con el fin del rango actual.");
    assert(payload.meta && payload.meta.currentSource === "ventas_mes_scope+ventas_scope_dim", "projection-detail-range: debe usar currentSource compacto para el dataset actual.");
  });

  console.log(`\nValidación completada. Checks ejecutados: ${results.length}`);
  if (!health.status?.ready) {
    console.log("Aviso: health.status.ready reportó false; revisar la carga de la tabla ventas en D1.");
  }
}

main().catch(error => {
  console.error(`\n[FAIL] ${error.message}`);
  process.exitCode = 1;
});
