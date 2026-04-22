#!/usr/bin/env node
import process from 'node:process';
import { parseProjectionCompareContext } from '../../src/worker/lib/dates.js';
import { resolveProjectionCompareSources } from '../../src/worker/handlers/projection/shared.js';

function makeUrl(search = '') {
  return new URL(`https://example.test/api/projection-compare${search}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeFilters(overrides = {}) {
  return {
    desde: null,
    hasta: null,
    coordinador: '',
    agente: '',
    cliente: '',
    grupo: '',
    marca: '',
    codProd: [],
    projGroups: [],
    ...overrides
  };
}

const runtime = {
  hasVentas: true,
  hasVentasDiaScope: true,
  hasVentasMesScope: true,
  hasVentasScopeDim: true,
  hasStateSnapshotMonth: true,
  hasVentas2025: true,
  hasVentas2025MesScope: true,
  hasVentas2025ScopeDim: true,
  hasVentas2025SnapshotMonth: true
};

function runCase({ name, filters, search, expected }) {
  const url = makeUrl(search);
  const compare = parseProjectionCompareContext(url, filters);
  const resolved = resolveProjectionCompareSources(runtime, filters, compare);

  if (expected.currentSourceLabel) {
    assert(resolved.currentSourceLabel === expected.currentSourceLabel, `${name}: currentSourceLabel esperado='${expected.currentSourceLabel}' actual='${resolved.currentSourceLabel}'`);
  }
  if (expected.historicalSourceLabel) {
    assert(resolved.historicalSourceLabel === expected.historicalSourceLabel, `${name}: historicalSourceLabel esperado='${expected.historicalSourceLabel}' actual='${resolved.historicalSourceLabel}'`);
  }
  if (expected.compareResponseMode) {
    assert(resolved.compareResponseMode === expected.compareResponseMode, `${name}: compareResponseMode esperado='${expected.compareResponseMode}' actual='${resolved.compareResponseMode}'`);
  }
  if (expected.compareResponseLabel) {
    assert(resolved.compareResponseLabel === expected.compareResponseLabel, `${name}: compareResponseLabel esperado='${expected.compareResponseLabel}' actual='${resolved.compareResponseLabel}'`);
  }
  if (typeof expected.useHistoricalClosedMonth === 'boolean') {
    assert(resolved.useHistoricalClosedMonth === expected.useHistoricalClosedMonth, `${name}: useHistoricalClosedMonth esperado='${expected.useHistoricalClosedMonth}' actual='${resolved.useHistoricalClosedMonth}'`);
  }
}

try {
  runCase({
    name: 'single-month-partial-no-filters',
    filters: makeFilters({ desde: '2026-04-01', hasta: '2026-04-10' }),
    search: '?compareYear=2025',
    expected: {
      currentSourceLabel: 'ventas_dia_scope+ventas_scope_dim',
      historicalSourceLabel: 'ventas_2025_snapshot_month',
      compareResponseMode: 'month',
      compareResponseLabel: 'Abril 2025',
      useHistoricalClosedMonth: true
    }
  });

  runCase({
    name: 'single-full-month-no-filters',
    filters: makeFilters({ desde: '2026-03-01', hasta: '2026-03-31' }),
    search: '?compareYear=2025',
    expected: {
      currentSourceLabel: 'state_snapshot_month',
      historicalSourceLabel: 'ventas_2025_snapshot_month',
      compareResponseMode: 'month',
      compareResponseLabel: 'Marzo 2025',
      useHistoricalClosedMonth: true
    }
  });

  runCase({
    name: 'single-month-partial-with-filter',
    filters: makeFilters({ desde: '2026-04-01', hasta: '2026-04-10', cliente: '7953' }),
    search: '?compareYear=2025',
    expected: {
      currentSourceLabel: 'ventas_dia_scope+ventas_scope_dim',
      historicalSourceLabel: 'ventas_2025_mes_scope+ventas_2025_scope_dim',
      compareResponseMode: 'month',
      compareResponseLabel: 'Abril 2025',
      useHistoricalClosedMonth: true
    }
  });

  console.log('[OK] validate-projection-sources');
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(1);
}
