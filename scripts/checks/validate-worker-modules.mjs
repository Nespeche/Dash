#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const requiredFiles = [
  'worker.js',
  'src/worker/app.js',
  'src/worker/config.js',
  'src/worker/runtime-context.js',
  'src/worker/lib/payloads.js',
  'src/worker/lib/endpoint-cache.js',
  'src/worker/handlers/dashboard.js',
  'src/worker/handlers/dashboard/index.js',
  'src/worker/handlers/dashboard/health-handler.js',
  'src/worker/handlers/dashboard/state-handler.js',
  'src/worker/handlers/dashboard/insights-handler.js',
  'src/worker/handlers/dashboard/detail-handler.js',
  'src/worker/handlers/dashboard/catalog-handler.js',
  'src/worker/handlers/projection.js',
  'src/worker/handlers/projection/index.js',
  'src/worker/handlers/projection/shared.js',
  'src/worker/handlers/projection/compare-handler.js',
  'src/worker/handlers/projection/detail-handler.js',
  'src/worker/handlers/projection/hierarchy-handler.js',
  'src/worker/services/state-queries.js',
  'src/worker/services/state-queries/common.js',
  'src/worker/services/state-queries/detail-queries.js',
  'src/worker/services/state-queries/options-queries.js',
  'src/worker/services/state-queries/insights-queries.js',
  'src/worker/services/state-queries/fast-path-queries.js'
];

async function read(relPath) {
  return fs.readFile(path.resolve(root, relPath), 'utf8');
}

async function exists(relPath) {
  try {
    await fs.access(path.resolve(root, relPath));
    return true;
  } catch {
    return false;
  }
}

function collectNamedExports(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/gs)) {
    for (const rawPart of String(match[1] || '').split(',')) {
      const part = rawPart.trim();
      if (!part) continue;
      const asMatch = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (asMatch) names.add(asMatch[2] || asMatch[1]);
    }
  }
  return names;
}

function collectNamedImports(source) {
  const imports = [];
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gs)) {
    const rawNames = String(match[1] || '').split(',').map(part => part.trim()).filter(Boolean);
    const names = rawNames.map(part => {
      const asMatch = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      return asMatch ? asMatch[1] : part;
    });
    imports.push({ source: String(match[2] || ''), names });
  }
  return imports;
}

function includesEither(source, expected) {
  return source.includes(`from "${expected}"`) || source.includes(`from '${expected}'`);
}

async function validateNamedExports(relFiles) {
  const contents = new Map();
  for (const relFile of relFiles) contents.set(relFile, await read(relFile));

  const exportMap = new Map();
  for (const [relFile, source] of contents.entries()) {
    exportMap.set(relFile, collectNamedExports(source));
  }

  const failures = [];
  for (const [relFile, source] of contents.entries()) {
    const importerDir = path.dirname(relFile);
    for (const entry of collectNamedImports(source)) {
      if (!entry.source.startsWith('.')) continue;
      let resolved = path.normalize(path.join(importerDir, entry.source));
      if (!path.extname(resolved)) resolved += '.js';
      const targetExports = exportMap.get(resolved);
      if (!targetExports) continue;
      const missing = entry.names.filter(name => !targetExports.has(name));
      if (missing.length) {
        failures.push(`${relFile} importa ${missing.join(', ')} desde ${resolved}, pero no está exportado.`);
      }
    }
  }
  return failures;
}

async function main() {
  const failures = [];
  for (const relPath of requiredFiles) {
    if (!(await exists(relPath))) failures.push(`Falta el módulo requerido '${relPath}'.`);
  }

  const backendFiles = [
    'worker.js',
    ...requiredFiles.filter(file => file.endsWith('.js') && file !== 'worker.js')
  ];
  failures.push(...await validateNamedExports(backendFiles));

  const [workerEntry, appSource, dashboardBarrel, projectionBarrel, stateQueriesBarrel] = await Promise.all([
    read('worker.js'),
    read('src/worker/app.js'),
    read('src/worker/handlers/dashboard.js'),
    read('src/worker/handlers/projection.js'),
    read('src/worker/services/state-queries.js')
  ]);

  if (!/export\s*\{\s*default\s*\}\s*from\s*["']\.\/src\/worker\/app\.js["']\s*;?/m.test(workerEntry)) {
    failures.push("worker.js debe delegar el entrypoint a './src/worker/app.js'.");
  }

  for (const expected of [
    './handlers/dashboard/index.js',
    './handlers/projection/index.js',
    './lib/auth.js',
    './lib/http.js'
  ]) {
    if (!includesEither(appSource, expected)) {
      failures.push(`src/worker/app.js debe importar '${expected}'.`);
    }
  }

  for (const route of [
    '/api/health',
    '/api/state',
    '/api/insights',
    '/api/detail',
    '/api/projection-compare',
    '/api/projection-detail',
    '/api/projection-hierarchy',
    '/api/projection-product-hierarchy',
    '/api/catalog'
  ]) {
    if (!appSource.includes(route)) failures.push(`src/worker/app.js debe rutear '${route}'.`);
  }

  if (!includesEither(dashboardBarrel, './dashboard/index.js')) {
    failures.push("src/worker/handlers/dashboard.js debe ser un barrel hacia './dashboard/index.js'.");
  }
  if (!includesEither(projectionBarrel, './projection/index.js')) {
    failures.push("src/worker/handlers/projection.js debe ser un barrel hacia './projection/index.js'.");
  }
  for (const expected of [
    './state-queries/common.js',
    './state-queries/detail-queries.js',
    './state-queries/options-queries.js',
    './state-queries/insights-queries.js',
    './state-queries/fast-path-queries.js'
  ]) {
    if (!includesEither(stateQueriesBarrel, expected)) {
      failures.push(`src/worker/services/state-queries.js debe reexportar '${expected}'.`);
    }
  }

  const stateHandler = await read('src/worker/handlers/dashboard/state-handler.js');
  const insightsHandler = await read('src/worker/handlers/dashboard/insights-handler.js');
  const detailHandler = await read('src/worker/handlers/dashboard/detail-handler.js');
  const catalogHandler = await read('src/worker/handlers/dashboard/catalog-handler.js');
  const compareHandler = await read('src/worker/handlers/projection/compare-handler.js');
  const projectionDetailHandler = await read('src/worker/handlers/projection/detail-handler.js');
  const projectionHierarchyHandler = await read('src/worker/handlers/projection/hierarchy-handler.js');
  const projectionProductHierarchyHandler = await read('src/worker/handlers/projection/product-hierarchy-handler.js');

  for (const [relPath, source] of [
    ['src/worker/handlers/dashboard/state-handler.js', stateHandler],
    ['src/worker/handlers/dashboard/insights-handler.js', insightsHandler],
    ['src/worker/handlers/dashboard/detail-handler.js', detailHandler],
    ['src/worker/handlers/dashboard/catalog-handler.js', catalogHandler],
    ['src/worker/handlers/projection/compare-handler.js', compareHandler],
    ['src/worker/handlers/projection/detail-handler.js', projectionDetailHandler],
    ['src/worker/handlers/projection/hierarchy-handler.js', projectionHierarchyHandler],
    ['src/worker/handlers/projection/product-hierarchy-handler.js', projectionProductHierarchyHandler]
  ]) {
    if (!includesEither(source, '../../lib/endpoint-cache.js') && !includesEither(source, '../lib/endpoint-cache.js')) {
      failures.push(`${relPath} debe reutilizar el helper común de cache/respuesta.`);
    }
    if (!source.includes('respondWithVersionedCache(')) {
      failures.push(`${relPath} debe usar respondWithVersionedCache(...).`);
    }
  }

  const detailSource = projectionDetailHandler;
  for (const expectedName of [
    'resolveProjectionDetailContext',
    'resolveProjectionCompareSources',
    'buildCurrentMonthSource',
    'buildHistoricalMonthSource'
  ]) {
    const isUsed = detailSource.includes(`${expectedName}(`);
    const isImported = collectNamedImports(detailSource).some(entry => entry.names.includes(expectedName));
    if (isUsed && !isImported) {
      failures.push(`src/worker/handlers/projection/detail-handler.js usa '${expectedName}' pero no lo importa.`);
    }
  }

  const appModule = await import(pathToFileURL(path.resolve(root, 'src/worker/app.js')).href);
  if (typeof appModule?.default?.fetch !== 'function') {
    failures.push('src/worker/app.js debe exportar default.fetch como función.');
  }

  const dashboardIndex = await import(pathToFileURL(path.resolve(root, 'src/worker/handlers/dashboard/index.js')).href);
  const projectionIndex = await import(pathToFileURL(path.resolve(root, 'src/worker/handlers/projection/index.js')).href);
  const stateQueries = await import(pathToFileURL(path.resolve(root, 'src/worker/services/state-queries.js')).href);

  for (const exportedName of ['handleHealth', 'handleState', 'handleInsights', 'handleDetail', 'handleCatalog']) {
    if (typeof dashboardIndex[exportedName] !== 'function') failures.push(`dashboard/index.js debe exportar '${exportedName}'.`);
  }
  for (const exportedName of ['handleProjectionCompare', 'handleProjectionDetail', 'handleProjectionHierarchy', 'handleProjectionProductHierarchy']) {
    if (typeof projectionIndex[exportedName] !== 'function') failures.push(`projection/index.js debe exportar '${exportedName}'.`);
  }
  for (const exportedName of ['queryDetailPageData', 'queryStateOptionsBundle', 'queryMonthInsightsPayload', 'queryGlobalKpisFastPath']) {
    if (typeof stateQueries[exportedName] !== 'function') failures.push(`state-queries.js debe exportar '${exportedName}'.`);
  }

  if (failures.length) {
    throw new Error(`Validación de módulos backend falló:\n- ${failures.join('\n- ')}`);
  }

  console.log('[ok] backend modular consistente');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
