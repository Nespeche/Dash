import { APP_VERSION } from "../../../shared/version.js";
import { PROJECTION_COMPARE_TTL } from "../../config.js";
import { resolveRuntimeContext } from "../../runtime-context.js";
import { queryAll } from "../../lib/db.js";
import { parseFilters } from "../../lib/filters.js";
import { formatProjectionRangeLabel, parseProjectionCompareContext } from "../../lib/dates.js";
import { buildBusinessWhere, buildCurrentScopedSource, buildHistoricalMonthSource } from "../../lib/scope.js";
import { jsonNoStore, jsonPublic, respondWithVersionedCache } from "../../lib/endpoint-cache.js";
import { missingVentasMessage } from "../../lib/payloads.js";
import { PROJECTION_COMPARE_DIMS, resolveProjectionCompareSources } from "./shared.js";

const PRODUCT_SUMMARY_RULES = Object.freeze([
  { key: "fiambres", label: "TOTAL FIAMBRES", mode: "exclude", families: ["FRESCO", "HAMBURGUESAS", "SALCHICHAS"] },
  { key: "salchichas", label: "TOTAL SALCHICHAS", mode: "include", families: ["SALCHICHAS"] },
  { key: "hamburguesas", label: "TOTAL HAMBURGUESAS", mode: "include", families: ["HAMBURGUESAS"] },
  { key: "fsh", label: "TOTAL F+S+H", mode: "exclude", families: ["FRESCO"] },
  { key: "fresco", label: "TOTAL FRESCO", mode: "include", families: ["FRESCO"] }
]);

function normalizeFamilyName(value = "") {
  const clean = String(value || "").trim();
  return clean || "Sin familia";
}

function normalizeSummaryKey(value = "") {
  return normalizeFamilyName(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function sortRowsByFamilyThenProduct(left = {}, right = {}) {
  const familyDelta = String(left?.grupo || "").localeCompare(String(right?.grupo || ""), "es", { numeric: true, sensitivity: "base" });
  if (familyDelta !== 0) return familyDelta;
  const codeDelta = String(left?.codProducto || "").localeCompare(String(right?.codProducto || ""), "es", { numeric: true, sensitivity: "base" });
  if (codeDelta !== 0) return codeDelta;
  const nameDelta = String(left?.productoDesc || "").localeCompare(String(right?.productoDesc || ""), "es", { numeric: true, sensitivity: "base" });
  if (nameDelta !== 0) return nameDelta;
  const currentDelta = Number(right?.kilosActuales || 0) - Number(left?.kilosActuales || 0);
  if (currentDelta !== 0) return currentDelta;
  return Number(right?.kilos2025 || 0) - Number(left?.kilos2025 || 0);
}

function matchesSummaryRule(rule, family = "") {
  const normalizedFamily = normalizeSummaryKey(family);
  const normalizedFamilies = new Set((rule?.families || []).map(normalizeSummaryKey));
  if (rule?.mode === "exclude") return !normalizedFamilies.has(normalizedFamily);
  return normalizedFamilies.has(normalizedFamily);
}

function buildRawHistoricalProductSource(compare, f) {
  const columns = {
    grupo: "h.Grupo_Familia",
    codProd: "h.Cod_Producto",
    coordinador: "h.Coordinador",
    agente: "h.Cod_Agente",
    cliente: "h.Cod_Cliente",
    marca: "h.Marca",
    kilos: "h.Kilos"
  };
  const business = buildBusinessWhere(f, PROJECTION_COMPARE_DIMS, columns);
  const whereParts = ["h.Fecha >= ?", "h.Fecha <= ?"];
  const params = [compare.desde, compare.hasta];
  if (business.sql) {
    whereParts.push(business.sql.replace(/^WHERE\s+/i, ""));
    params.push(...business.params);
  }
  return {
    columns,
    fromSql: "FROM ventas_2025 h",
    whereSql: `WHERE ${whereParts.join(" AND ")}`,
    params
  };
}

function buildSummaryRows(groups = []) {
  return PRODUCT_SUMMARY_RULES.map((rule) => {
    const totals = groups.reduce((acc, group) => {
      if (!matchesSummaryRule(rule, group?.grupo)) return acc;
      acc.kilosActuales += Number(group?.kilosActuales || 0);
      acc.kilos2025 += Number(group?.kilos2025 || 0);
      return acc;
    }, {
      kilosActuales: 0,
      kilos2025: 0
    });

    return {
      key: rule.key,
      label: rule.label,
      kilosActuales: Number(totals.kilosActuales || 0),
      kilos2025: Number(totals.kilos2025 || 0)
    };
  });
}

export async function handleProjectionProductHierarchy(url, env, ctx, request = null) {
  const runtime = await resolveRuntimeContext(env);
  const f = parseFilters(url);
  const compare = parseProjectionCompareContext(url, f);
  const compareSources = resolveProjectionCompareSources(runtime, f, compare);

  return respondWithVersionedCache({
    request,
    url,
    dataVersion: runtime.meta.dataVersion,
    ctx,
    build: async () => {
      const currentLabel = formatProjectionRangeLabel(compare.currentDesde, compare.currentHasta);

      if (!runtime.hasVentas) {
        return jsonNoStore({
          ok: true,
          available: Boolean(runtime.hasVentas2025),
          current: {
            label: currentLabel,
            kilos: 0
          },
          compare: {
            year: compare.compareYear,
            month: compare.compareMonth,
            desde: compare.desde,
            hasta: compare.hasta,
            mode: compareSources.compareResponseMode,
            label: compareSources.compareResponseLabel,
            kilos: 0
          },
          summary: {
            familias: 0,
            productos: 0,
            kilosActuales: 0,
            kilos2025: 0
          },
          familyGroups: [],
          summaryRows: buildSummaryRows([]),
          meta: {
            appVersion: APP_VERSION,
            dataVersion: runtime.meta.dataVersion,
            selectedGroups: f.projGroups || [],
            currentSource: compareSources.currentSourceLabel,
            historicalSource: compareSources.historicalSourceLabel,
            summaryRuleNote: "FIAMBRES = todas las familias salvo Fresco, Hamburguesas y Salchichas. F+SH = total sin Fresco.",
            message: missingVentasMessage()
          }
        });
      }

      const currentSource = buildCurrentScopedSource(runtime, f, PROJECTION_COMPARE_DIMS, { factAlias: "c", dimAlias: "cs" });
      const historicalSource = runtime.hasVentas2025
        ? (compareSources.useHistoricalMonthScope
            ? buildHistoricalMonthSource(runtime, compare, f, PROJECTION_COMPARE_DIMS, { factAlias: "h", dimAlias: "hs" })
            : buildRawHistoricalProductSource(compare, f))
        : null;

      const currentProductJoinSql = runtime.hasProductosCatalogo
        ? `LEFT JOIN productos_catalogo pc ON pc.Cod_Producto = ${currentSource.columns.codProd}`
        : "";
      const currentProductNameExpr = runtime.hasProductosCatalogo
        ? `COALESCE(NULLIF(TRIM(pc.Producto_Desc), ''), NULLIF(TRIM(${currentSource.columns.codProd}), ''), '')`
        : `COALESCE(NULLIF(TRIM(${currentSource.columns.codProd}), ''), '')`;

      const historicalProductJoins = [];
      if (runtime.hasVentas2025ProductosCatalogo) historicalProductJoins.push(`LEFT JOIN ventas_2025_productos_catalogo hp ON hp.Cod_Producto = ${historicalSource?.columns?.codProd || "h.Cod_Producto"}`);
      if (runtime.hasProductosCatalogo) historicalProductJoins.push(`LEFT JOIN productos_catalogo pc ON pc.Cod_Producto = ${historicalSource?.columns?.codProd || "h.Cod_Producto"}`);
      const historicalProductNameExpr = runtime.hasVentas2025ProductosCatalogo && runtime.hasProductosCatalogo
        ? `COALESCE(NULLIF(TRIM(hp.Producto_Desc), ''), NULLIF(TRIM(pc.Producto_Desc), ''), NULLIF(TRIM(${historicalSource?.columns?.codProd || "h.Cod_Producto"}), ''), '')`
        : runtime.hasVentas2025ProductosCatalogo
          ? `COALESCE(NULLIF(TRIM(hp.Producto_Desc), ''), NULLIF(TRIM(${historicalSource?.columns?.codProd || "h.Cod_Producto"}), ''), '')`
          : runtime.hasProductosCatalogo
            ? `COALESCE(NULLIF(TRIM(pc.Producto_Desc), ''), NULLIF(TRIM(${historicalSource?.columns?.codProd || "h.Cod_Producto"}), ''), '')`
            : `COALESCE(NULLIF(TRIM(${historicalSource?.columns?.codProd || "h.Cod_Producto"}), ''), '')`;

      const historicalRowsCte = !runtime.hasVentas2025
        ? `historical_rows AS (
            SELECT CAST(NULL AS TEXT) AS Grupo_Familia, CAST(NULL AS TEXT) AS Cod_Producto, CAST(NULL AS TEXT) AS Producto_Desc, CAST(0 AS REAL) AS Kilos2025
            WHERE 1 = 0
          )`
        : `historical_rows AS (
            SELECT
              COALESCE(NULLIF(TRIM(${historicalSource.columns.grupo}), ''), 'Sin familia') AS Grupo_Familia,
              COALESCE(NULLIF(TRIM(${historicalSource.columns.codProd}), ''), '') AS Cod_Producto,
              MIN(${historicalProductNameExpr}) AS Producto_Desc,
              COALESCE(SUM(${historicalSource.columns.kilos}), 0) AS Kilos2025
            ${historicalSource.fromSql}
            ${historicalProductJoins.join("\n            ")}
            ${historicalSource.whereSql}
            GROUP BY 1, 2
          )`;

      const rows = await queryAll(env, `
        WITH current_rows AS (
          SELECT
            COALESCE(NULLIF(TRIM(${currentSource.columns.grupo}), ''), 'Sin familia') AS Grupo_Familia,
            COALESCE(NULLIF(TRIM(${currentSource.columns.codProd}), ''), '') AS Cod_Producto,
            MIN(${currentProductNameExpr}) AS Producto_Desc,
            COALESCE(SUM(${currentSource.columns.kilos}), 0) AS KilosActuales
          ${currentSource.fromSql}
          ${currentProductJoinSql}
          ${currentSource.whereSql}
          GROUP BY 1, 2
        ),
        ${historicalRowsCte},
        union_rows AS (
          SELECT Grupo_Familia, Cod_Producto, Producto_Desc, KilosActuales, 0 AS Kilos2025 FROM current_rows
          UNION ALL
          SELECT Grupo_Familia, Cod_Producto, Producto_Desc, 0 AS KilosActuales, Kilos2025 FROM historical_rows
        ),
        joined_rows AS (
          SELECT
            Grupo_Familia,
            Cod_Producto,
            MAX(COALESCE(Producto_Desc, '')) AS Producto_Desc,
            COALESCE(SUM(KilosActuales), 0) AS KilosActuales,
            COALESCE(SUM(Kilos2025), 0) AS Kilos2025
          FROM union_rows
          GROUP BY Grupo_Familia, Cod_Producto
        )
        SELECT
          Grupo_Familia,
          Cod_Producto,
          Producto_Desc,
          KilosActuales,
          Kilos2025
        FROM joined_rows
        WHERE COALESCE(KilosActuales, 0) <> 0 OR COALESCE(Kilos2025, 0) <> 0
        ORDER BY Grupo_Familia COLLATE NOCASE ASC, Cod_Producto COLLATE NOCASE ASC, Producto_Desc COLLATE NOCASE ASC
      `, [
        ...currentSource.params,
        ...(runtime.hasVentas2025 ? historicalSource.params : [])
      ]);

      const grouped = new Map();
      rows.forEach((row) => {
        const grupo = normalizeFamilyName(row?.Grupo_Familia);
        const codProducto = String(row?.Cod_Producto || "").trim();
        const productoDesc = String(row?.Producto_Desc || "").trim();
        const kilosActuales = Number(row?.KilosActuales || 0);
        const kilos2025 = Number(row?.Kilos2025 || 0);

        if (!grouped.has(grupo)) {
          grouped.set(grupo, {
            grupo,
            kilosActuales: 0,
            kilos2025: 0,
            productos: []
          });
        }

        const bucket = grouped.get(grupo);
        bucket.kilosActuales += kilosActuales;
        bucket.kilos2025 += kilos2025;
        bucket.productos.push({
          codProducto,
          productoDesc,
          kilosActuales,
          kilos2025
        });
      });

      const familyGroups = [...grouped.values()]
        .map((group) => ({
          ...group,
          productos: [...group.productos].sort(sortRowsByFamilyThenProduct)
        }))
        .sort((left, right) => String(left?.grupo || "").localeCompare(String(right?.grupo || ""), "es", { numeric: true, sensitivity: "base" }));

      const summary = familyGroups.reduce((acc, group) => {
        acc.familias += 1;
        acc.productos += group.productos.length;
        acc.kilosActuales += Number(group.kilosActuales || 0);
        acc.kilos2025 += Number(group.kilos2025 || 0);
        return acc;
      }, {
        familias: 0,
        productos: 0,
        kilosActuales: 0,
        kilos2025: 0
      });

      return jsonPublic({
        ok: true,
        available: Boolean(runtime.hasVentas2025),
        current: {
          label: currentLabel,
          desde: compare.currentDesde,
          hasta: compare.currentHasta,
          kilos: Number(summary.kilosActuales || 0)
        },
        compare: {
          year: compare.compareYear,
          month: compare.compareMonth,
          desde: compare.desde,
          hasta: compare.hasta,
          mode: compareSources.compareResponseMode,
          label: compareSources.compareResponseLabel,
          kilos: Number(summary.kilos2025 || 0)
        },
        summary,
        familyGroups,
        summaryRows: buildSummaryRows(familyGroups),
        meta: {
          appVersion: APP_VERSION,
          dataVersion: runtime.meta.dataVersion,
          selectedGroups: f.projGroups || [],
          currentSource: compareSources.currentSourceLabel,
          historicalSource: compareSources.historicalSourceLabel,
          summaryRuleNote: "FIAMBRES = todas las familias salvo Fresco, Hamburguesas y Salchichas. F+SH = total sin Fresco."
        }
      }, PROJECTION_COMPARE_TTL);
    }
  });
}
