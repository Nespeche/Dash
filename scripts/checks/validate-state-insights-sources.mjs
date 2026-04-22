#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function read(relPath) {
  return fs.readFile(path.resolve(root, relPath), "utf8");
}

function mustInclude(source, token, label, failures) {
  if (!source.includes(token)) failures.push(label);
}

async function main() {
  const failures = [];
  const [scopeSource, stateHandler, insightsHandler, fastQueries, insightsQueries, optionsQueries] = await Promise.all([
    read("src/worker/lib/scope.js"),
    read("src/worker/handlers/dashboard/state-handler.js"),
    read("src/worker/handlers/dashboard/insights-handler.js"),
    read("src/worker/services/state-queries/fast-path-queries.js"),
    read("src/worker/services/state-queries/insights-queries.js"),
    read("src/worker/services/state-queries/options-queries.js")
  ]);

  mustInclude(scopeSource, "export function canUseCurrentPeriodScope", "scope.js debe exportar canUseCurrentPeriodScope.", failures);
  mustInclude(scopeSource, "export function buildCurrentScopedSource", "scope.js debe exportar buildCurrentScopedSource.", failures);
  mustInclude(scopeSource, "ventas_dia_scope", "scope.js debe contemplar ventas_dia_scope.", failures);
  mustInclude(scopeSource, "ventas_mes_scope", "scope.js debe contemplar ventas_mes_scope.", failures);

  mustInclude(stateHandler, "canUseCurrentPeriodScope", "state-handler.js debe resolver currentPeriodScope.", failures);
  mustInclude(stateHandler, "phase-10-state-current-period-scope", "state-handler.js debe exponer el nuevo stateMode scope-aware.", failures);

  mustInclude(insightsHandler, "canUseCurrentPeriodScope", "insights-handler.js debe resolver currentPeriodScope.", failures);

  mustInclude(fastQueries, "buildCurrentScopedSource", "fast-path-queries.js debe reutilizar buildCurrentScopedSource.", failures);
  mustInclude(insightsQueries, "buildCurrentScopedSource", "insights-queries.js debe reutilizar buildCurrentScopedSource.", failures);
  mustInclude(optionsQueries, "buildCurrentScopedSource", "options-queries.js debe reutilizar buildCurrentScopedSource.", failures);
  mustInclude(optionsQueries, "canUseCurrentPeriodScope", "options-queries.js debe usar canUseCurrentPeriodScope.", failures);

  if (failures.length) {
    console.error("VALIDACION STATE/INSIGHTS FALLIDA");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("VALIDACION STATE/INSIGHTS OK");
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
