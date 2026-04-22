#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function read(relPath) {
  const abs = path.resolve(root, relPath);
  return fs.readFile(abs, "utf8");
}

async function exists(relPath) {
  try {
    await fs.access(path.resolve(root, relPath));
    return true;
  } catch {
    return false;
  }
}

function mustMatch(source, regex, label) {
  const match = source.match(regex);
  if (!match) throw new Error(`No se pudo leer ${label}.`);
  return String(match[1]).trim();
}

function collectNamedExports(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/gs)) {
    const block = match[1] || "";
    for (const rawPart of block.split(",")) {
      const part = rawPart.trim();
      if (!part) continue;
      const asMatch = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!asMatch) continue;
      names.add(asMatch[2] || asMatch[1]);
    }
  }
  return names;
}

function collectNamedImports(source) {
  const imports = [];
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gs)) {
    const rawNames = String(match[1] || "").split(",").map(part => part.trim()).filter(Boolean);
    const names = rawNames.map(part => {
      const asMatch = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      return asMatch ? asMatch[1] : part;
    });
    imports.push({ source: String(match[2] || ""), names });
  }
  return imports;
}

function collectStaticImportSources(source) {
  const imports = new Set();
  for (const match of source.matchAll(/import\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/gs)) {
    imports.add(String(match[1] || "").trim());
  }
  return [...imports];
}

function collectScriptSourcesFromHtml(source) {
  const sources = [];
  for (const match of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    sources.push(String(match[1] || "").trim());
  }
  return sources;
}

function hasIdentifierDeclaration(source, identifier) {
  const escaped = identifier.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const patterns = [
    new RegExp(`\\bfunction\\s+${escaped}\\b`),
    new RegExp(`\\basync\\s+function\\s+${escaped}\\b`),
    new RegExp(`\\bconst\\s+${escaped}\\b`),
    new RegExp(`\\blet\\s+${escaped}\\b`),
    new RegExp(`\\bvar\\s+${escaped}\\b`),
    new RegExp(`\\bimport\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`),
    new RegExp(`\\bimport\\s+${escaped}\\b`)
  ];
  return patterns.some((pattern) => pattern.test(source));
}

async function validateNamedExports(relFiles) {
  const contents = new Map();
  for (const relFile of relFiles) {
    contents.set(relFile, await read(relFile));
  }

  const exportMap = new Map();
  for (const [relFile, source] of contents.entries()) {
    exportMap.set(relFile, collectNamedExports(source));
  }

  const failures = [];
  for (const [relFile, source] of contents.entries()) {
    const importerDir = path.dirname(relFile);
    for (const entry of collectNamedImports(source)) {
      if (!entry.source.startsWith(".")) continue;
      let resolved = path.normalize(path.join(importerDir, entry.source));
      if (!path.extname(resolved)) resolved += ".js";
      const targetExports = exportMap.get(resolved);
      if (!targetExports) continue;
      const missing = entry.names.filter(name => !targetExports.has(name));
      if (missing.length) {
        failures.push(`${relFile} importa ${missing.join(", ")} desde ${resolved}, pero no está exportado.`);
      }
    }
  }

  return failures;
}

async function checkForbiddenRootEntryPoints() {
  const failures = [];
  const candidates = ["app.js"];

  for (const relFile of candidates) {
    if (!(await exists(relFile))) continue;
    const publicTwin = path.posix.join("public", relFile);
    const hasTwin = await exists(publicTwin);
    if (hasTwin) {
      failures.push(`Existe un entrypoint prohibido fuera de public/: '${relFile}'. Eliminá '${relFile}' y conservá solo '${publicTwin}' como runtime.`);
    } else {
      failures.push(`Existe un entrypoint prohibido fuera de public/: '${relFile}'. Eliminá ese archivo porque no pertenece al runtime actual.`);
    }
  }

  return { failures };
}

async function main() {
  const [sharedVersion, appVersionJs, appShared, swJs, configJs, indexHtml] = await Promise.all([
    read("src/shared/version.js"),
    read("public/app_version.js"),
    read("public/app_shared.js"),
    read("public/sw.js"),
    read("public/config.js"),
    read("public/index.html")
  ]);

  const localVersion = mustMatch(sharedVersion, /APP_VERSION\s*=\s*"([^"]+)"/, "APP_VERSION en src/shared/version.js");
  const publicVersion = mustMatch(appVersionJs, /__VENTAS_APP_VERSION__\s*=\s*"([^"]+)"/, "__VENTAS_APP_VERSION__ en public/app_version.js");
  const sharedFallbackVersion = mustMatch(appShared, /return String\(global\.__VENTAS_APP_VERSION__ \|\| "([^"]+)"\)/, "fallback de versión en public/app_shared.js");
  const swFallbackVersion = mustMatch(swJs, /__VENTAS_APP_VERSION__ \|\| "([^"]+)"/, "fallback de versión en public/sw.js");

  const configuredApiBase = mustMatch(configJs, /apiBase:\s*"([^"]+)"/, "apiBase en public/config.js").replace(/\/+$/, "");
  const metaApiBase = mustMatch(indexHtml, /<meta\s+name="ventas-api-base"\s+content="([^"]+)"\s*\/?>/i, "meta ventas-api-base en public/index.html").replace(/\/+$/, "");

  const requiredSwAssets = [
    "./js/app-listeners.js",
    "./js/filter-controller.js",
    "./js/dashboard-queries.js",
    "./favicon.svg"
  ];

  const appJs = await read("public/app.js");
  const appModuleImports = collectStaticImportSources(appJs)
    .filter(source => source.startsWith("./"))
    .map(source => source.startsWith("./js/") ? source : source)
    .sort();
  const htmlScripts = collectScriptSourcesFromHtml(indexHtml).map(src => src.replace(/^\.\//, ""));
  const expectedScriptOrder = ["app_version.js", "config.js", "app_shared.js", "app.js"];

  const failures = [];
  const warnings = [];
  if (localVersion !== publicVersion) failures.push(`Versión pública distinta: src/shared/version.js='${localVersion}' vs public/app_version.js='${publicVersion}'.`);
  if (localVersion !== sharedFallbackVersion) failures.push(`Fallback de app_shared.js distinto: '${sharedFallbackVersion}' vs '${localVersion}'.`);
  if (localVersion !== swFallbackVersion) failures.push(`Fallback de sw.js distinto: '${swFallbackVersion}' vs '${localVersion}'.`);
  if (configuredApiBase !== metaApiBase) failures.push(`apiBase distinto entre public/config.js ('${configuredApiBase}') e index.html ('${metaApiBase}').`);

  for (const asset of [...new Set([...requiredSwAssets, ...appModuleImports])]) {
    if (!swJs.includes(`"${asset}"`)) {
      failures.push(`sw.js no precachea '${asset}'.`);
    }
  }

  const currentScriptOrder = htmlScripts.slice(0, expectedScriptOrder.length);
  if (currentScriptOrder.join("|") !== expectedScriptOrder.join("|")) {
    failures.push(`index.html debe cargar scripts en orden ${expectedScriptOrder.join(" -> ")}; actual=${currentScriptOrder.join(" -> ") || "(vacío)"}.`);
  }

  if (!swJs.includes('SKIP_WAITING')) {
    failures.push("sw.js debe soportar el mensaje SKIP_WAITING para activar updates del app shell.");
  }

  const frontendFiles = [
    "public/app.js",
    "public/js/auth-ui.js",
    "public/js/runtime-state.js",
    "public/js/charts.js",
    "public/js/projection.js",
    "public/js/accessible-tabs.js",
    "public/js/accessible-combobox.js",
    "public/js/table-ui.js",
    "public/js/app-listeners.js",
    "public/js/filter-controller.js",
    "public/js/dashboard-queries.js",
    "public/js/data-service.js",
    "public/js/detail-controller.js",
    "public/js/insights-controller.js",
    "public/js/projection-controller.js",
    "public/js/catalog-store.js",
    "public/js/client-search-controller.js",
    "public/js/product-selector-controller.js",
    "public/js/filter-pills-controller.js"
  ];

  failures.push(...await validateNamedExports(frontendFiles));

  for (const identifier of [
    "fetchStatePayload",
    "ensureInsightsLoaded",
    "ensureProjectionCompareLoaded",
    "ensureProjectionDetailLoaded",
    "loadMoreProjectionDetail",
    "loadAllProjectionDetail",
    "renderTable",
    "syncTabsTop",
    "renderAgentKpiValue",
    "getProjectionComparison",
    "bootApp",
    "registerAppServiceWorker",
    "installRuntimeGuards",
    "ensureAppUpdateToast"
  ]) {
    if (!hasIdentifierDeclaration(appJs, identifier)) {
      failures.push(`public/app.js requiere '${identifier}' pero no tiene una declaración/import visible para ese identificador.`);
    }
  }

  const forbiddenRootEntryPoints = await checkForbiddenRootEntryPoints();
  failures.push(...forbiddenRootEntryPoints.failures);

  if (failures.length) {
    throw new Error(`Validación de consistencia frontend falló:\n- ${failures.join("\n- ")}`);
  }

  console.log(`[ok] frontend consistente`);
  console.log(`[ok] version=${localVersion}`);
  console.log(`[ok] apiBase=${configuredApiBase}`);
  for (const warning of warnings) {
    console.log(`[warn] ${warning}`);
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
