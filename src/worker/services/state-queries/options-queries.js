import { queryAll } from "../../lib/db.js";
import { andExtra, buildWhere } from "../../lib/filters.js";
import { getExactYearMonthKey } from "../../lib/dates.js";
import { buildBusinessWhere, buildCurrentScopedSource, canUseCurrentPeriodScope, canUseMaterializedScope } from "../../lib/scope.js";
import { buildCatalogSearchClause } from "./common.js";

export async function queryCurrentMonthStateOptionsBundle(env, runtime, f) {
  const source = buildCurrentScopedSource(runtime, f, [], { factAlias: "m", dimAlias: "ms" });
  const agentScope = buildBusinessWhere(f, ["coordinador"], source.columns);
  const groupScope = buildBusinessWhere(f, ["coordinador", "agente", "cliente"], source.columns);
  const brandScope = buildBusinessWhere(f, ["coordinador", "agente", "cliente", "grupo"], source.columns);

  const selects = [];
  const params = [];

  selects.push(`
    SELECT 1 AS sort_group, 'coordinador' AS kind, ${source.columns.coordinador} AS value, NULL AS codigo, NULL AS nombre
    ${source.fromSql}
    ${andExtra(source.whereSql, `NULLIF(${source.columns.coordinador}, '') IS NOT NULL`)}
    GROUP BY ${source.columns.coordinador}
  `);
  params.push(...source.params);

  if (runtime.hasAgentesCatalogo) {
    selects.push(`
      SELECT 2 AS sort_group, 'agente' AS kind, NULL AS value, a.Cod_Agente AS codigo, a.Agente AS nombre
      FROM agentes_catalogo a
      JOIN (
        SELECT DISTINCT ${source.columns.agente} AS Cod_Agente
        ${source.fromSql}
        ${andExtra(source.whereSql, `${agentScope.sql ? `${agentScope.sql.replace(/^WHERE\s+/i, "")} AND ` : ""}NULLIF(${source.columns.agente}, '') IS NOT NULL`)}
      ) s ON s.Cod_Agente = a.Cod_Agente
    `);
    params.push(...source.params, ...agentScope.params);
  } else {
    selects.push(`
      SELECT 2 AS sort_group, 'agente' AS kind, NULL AS value, ${source.columns.agente} AS codigo, MIN(${source.columns.agente}) AS nombre
      ${source.fromSql}
      ${andExtra(source.whereSql, `${agentScope.sql ? `${agentScope.sql.replace(/^WHERE\s+/i, "")} AND ` : ""}NULLIF(${source.columns.agente}, '') IS NOT NULL`)}
      GROUP BY ${source.columns.agente}
    `);
    params.push(...source.params, ...agentScope.params);
  }

  selects.push(`
    SELECT 3 AS sort_group, 'grupo' AS kind, ${source.columns.grupo} AS value, NULL AS codigo, NULL AS nombre
    ${source.fromSql}
    ${andExtra(source.whereSql, `${groupScope.sql ? `${groupScope.sql.replace(/^WHERE\s+/i, "")} AND ` : ""}NULLIF(${source.columns.grupo}, '') IS NOT NULL`)}
    GROUP BY ${source.columns.grupo}
  `);
  params.push(...source.params, ...groupScope.params);

  selects.push(`
    SELECT 4 AS sort_group, 'marca' AS kind, ${source.columns.marca} AS value, NULL AS codigo, NULL AS nombre
    ${source.fromSql}
    ${andExtra(source.whereSql, `${brandScope.sql ? `${brandScope.sql.replace(/^WHERE\s+/i, "")} AND ` : ""}NULLIF(${source.columns.marca}, '') IS NOT NULL`)}
    GROUP BY ${source.columns.marca}
  `);
  params.push(...source.params, ...brandScope.params);

  const rows = await queryAll(env, `
    SELECT sort_group, kind, value, codigo, nombre
    FROM (
      ${selects.join("\nUNION ALL\n")}
    ) state_options_bundle
    ORDER BY
      sort_group ASC,
      COALESCE(value, nombre, '') COLLATE NOCASE ASC,
      COALESCE(codigo, '') COLLATE NOCASE ASC
  `, params);

  const grouped = { coordinadores: [], agentes: [], grupos: [], marcas: [] };
  for (const row of (rows || [])) {
    if (row?.kind === 'coordinador') grouped.coordinadores.push({ value: String(row.value || '') });
    else if (row?.kind === 'agente') grouped.agentes.push({ codigo: String(row.codigo || ''), nombre: String(row.nombre || row.codigo || '') });
    else if (row?.kind === 'grupo') grouped.grupos.push({ value: String(row.value || '') });
    else if (row?.kind === 'marca') grouped.marcas.push({ value: String(row.value || '') });
  }

  return grouped;
}

export async function queryCurrentMonthClientOptionsLazy(env, runtime, f, search = "", limit = 25, forceSelected = false) {
  const source = buildCurrentScopedSource(runtime, f, ["coordinador", "agente"], { factAlias: "m", dimAlias: "ms" });
  const filterSearch = !forceSelected && String(search || "").trim();
  const selectedSearch = forceSelected ? String(search || "").trim() : "";
  const activeSearch = forceSelected ? selectedSearch : filterSearch;

  if (!runtime.hasClientesCatalogo) {
    const searchSpec = buildCatalogSearchClause(activeSearch, [source.columns.cliente]);
    return queryAll(env, `
      SELECT ${source.columns.cliente} AS codigo, MIN(${source.columns.cliente}) AS nombre
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.cliente}, '') IS NOT NULL`)}
      ${searchSpec.sql ? `AND ${searchSpec.sql}` : ""}
      GROUP BY ${source.columns.cliente}
      ORDER BY nombre COLLATE NOCASE ASC, codigo COLLATE NOCASE ASC
      LIMIT ?
    `, [...source.params, ...searchSpec.params, limit]);
  }

  const searchSpec = buildCatalogSearchClause(activeSearch, ["c.Cod_Cliente", "c.Cliente"]);
  return queryAll(env, `
    SELECT c.Cod_Cliente AS codigo, c.Cliente AS nombre
    FROM clientes_catalogo c
    JOIN (
      SELECT DISTINCT ${source.columns.cliente} AS Cod_Cliente
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.cliente}, '') IS NOT NULL`)}
    ) s ON s.Cod_Cliente = c.Cod_Cliente
    ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
    ORDER BY c.Cliente COLLATE NOCASE ASC, c.Cod_Cliente COLLATE NOCASE ASC
    LIMIT ?
  `, [...source.params, ...searchSpec.params, limit]);
}

export async function queryCurrentMonthProductOptionsLazy(env, runtime, f, search = "", limit = 25, forceSelected = false) {
  const source = buildCurrentScopedSource(runtime, f, ["coordinador", "agente", "cliente", "grupo", "marca"], { factAlias: "m", dimAlias: "ms" });
  const filterSearch = !forceSelected && String(search || "").trim();
  const selectedSearch = forceSelected ? String(search || "").trim() : "";
  const activeSearch = forceSelected ? selectedSearch : filterSearch;

  if (!runtime.hasProductosCatalogo) {
    const searchSpec = buildCatalogSearchClause(activeSearch, [source.columns.codProd]);
    return queryAll(env, `
      SELECT ${source.columns.codProd} AS codigo, MIN(${source.columns.codProd}) AS nombre
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.codProd}, '') IS NOT NULL`)}
      ${searchSpec.sql ? `AND ${searchSpec.sql}` : ""}
      GROUP BY ${source.columns.codProd}
      ORDER BY codigo COLLATE NOCASE ASC, nombre COLLATE NOCASE ASC
      LIMIT ?
    `, [...source.params, ...searchSpec.params, limit]);
  }

  const searchSpec = buildCatalogSearchClause(activeSearch, ["p.Cod_Producto", "p.Producto_Desc"]);
  return queryAll(env, `
    SELECT p.Cod_Producto AS codigo, p.Producto_Desc AS nombre
    FROM productos_catalogo p
    JOIN (
      SELECT DISTINCT ${source.columns.codProd} AS Cod_Producto
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.codProd}, '') IS NOT NULL`)}
    ) s ON s.Cod_Producto = p.Cod_Producto
    ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
    ORDER BY p.Cod_Producto COLLATE NOCASE ASC, p.Producto_Desc COLLATE NOCASE ASC
    LIMIT ?
  `, [...source.params, ...searchSpec.params, limit]);
}

export async function queryCurrentMonthSelectedProductRows(env, runtime, f, uniqueCodes) {
  const source = buildCurrentScopedSource(runtime, f, ["coordinador", "agente", "cliente", "grupo", "marca"], { factAlias: "m", dimAlias: "ms" });
  const placeholders = uniqueCodes.map(() => "?").join(",");

  if (!runtime.hasProductosCatalogo) {
    return queryAll(env, `
      SELECT ${source.columns.codProd} AS codigo, MIN(${source.columns.codProd}) AS nombre
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.codProd}, '') IS NOT NULL AND ${source.columns.codProd} IN (${placeholders})`)}
      GROUP BY ${source.columns.codProd}
    `, [...source.params, ...uniqueCodes]);
  }

  return queryAll(env, `
    SELECT p.Cod_Producto AS codigo, p.Producto_Desc AS nombre
    FROM productos_catalogo p
    JOIN (
      SELECT DISTINCT ${source.columns.codProd} AS Cod_Producto
      ${source.fromSql}
      ${andExtra(source.whereSql, `NULLIF(${source.columns.codProd}, '') IS NOT NULL`)}
    ) s ON s.Cod_Producto = p.Cod_Producto
    WHERE p.Cod_Producto IN (${placeholders})
  `, [...source.params, ...uniqueCodes]);
}

export async function queryStateOptionsBundle(env, runtime, f) {
  if (!runtime.hasVentas && !canUseMaterializedScope(runtime, f) && !canUseCurrentPeriodScope(runtime, f)) {
    return {
      coordinadores: [],
      agentes: [],
      grupos: [],
      marcas: []
    };
  }

  const selects = [];
  const params = [];
  const materializedScope = canUseMaterializedScope(runtime, f);
  const currentPeriodScope = canUseCurrentPeriodScope(runtime, f);

  if (materializedScope) {
    const agentScope = buildBusinessWhere(f, ["coordinador"]);
    const groupScope = buildBusinessWhere(f, ["coordinador", "agente", "cliente"]);
    const brandScope = buildBusinessWhere(f, ["coordinador", "agente", "cliente", "grupo"]);

    selects.push(`
      SELECT 1 AS sort_group, 'coordinador' AS kind, Coordinador AS value, NULL AS codigo, NULL AS nombre
      FROM scope_catalogo
      WHERE NULLIF(Coordinador, '') IS NOT NULL
      GROUP BY Coordinador
    `);

    if (runtime.hasAgentesCatalogo) {
      if (!agentScope.sql) {
        selects.push(`
          SELECT 2 AS sort_group, 'agente' AS kind, NULL AS value, Cod_Agente AS codigo, Agente AS nombre
          FROM agentes_catalogo
        `);
      } else {
        selects.push(`
          SELECT 2 AS sort_group, 'agente' AS kind, NULL AS value, a.Cod_Agente AS codigo, a.Agente AS nombre
          FROM agentes_catalogo a
          JOIN (
            SELECT DISTINCT Cod_Agente
            FROM scope_catalogo
            ${andExtra(agentScope.sql, `NULLIF(Cod_Agente, '') IS NOT NULL`)}
          ) s ON s.Cod_Agente = a.Cod_Agente
        `);
        params.push(...agentScope.params);
      }
    } else {
      const fallbackAgentScope = buildWhere(f, ["coordinador"]);
      selects.push(`
        SELECT 2 AS sort_group, 'agente' AS kind, NULL AS value, Cod_Agente AS codigo, MIN(Agente) AS nombre
        FROM ventas
        ${andExtra(fallbackAgentScope.sql, `NULLIF(Cod_Agente, '') IS NOT NULL`)}
        GROUP BY Cod_Agente
      `);
      params.push(...fallbackAgentScope.params);
    }

    selects.push(`
      SELECT 3 AS sort_group, 'grupo' AS kind, Grupo_Familia AS value, NULL AS codigo, NULL AS nombre
      FROM scope_catalogo
      ${andExtra(groupScope.sql, `NULLIF(Grupo_Familia, '') IS NOT NULL`)}
      GROUP BY Grupo_Familia
    `);
    params.push(...groupScope.params);

    selects.push(`
      SELECT 4 AS sort_group, 'marca' AS kind, Marca AS value, NULL AS codigo, NULL AS nombre
      FROM scope_catalogo
      ${andExtra(brandScope.sql, `NULLIF(Marca, '') IS NOT NULL`)}
      GROUP BY Marca
    `);
    params.push(...brandScope.params);
  } else if (currentPeriodScope) {
    return queryCurrentMonthStateOptionsBundle(env, runtime, f);
  } else {
    const coordScope = buildWhere(f, []);
    const agentScope = buildWhere(f, ["coordinador"]);
    const groupScope = buildWhere(f, ["coordinador", "agente", "cliente"]);
    const brandScope = buildWhere(f, ["coordinador", "agente", "cliente", "grupo"]);

    selects.push(`
      SELECT 1 AS sort_group, 'coordinador' AS kind, Coordinador AS value, NULL AS codigo, NULL AS nombre
      FROM ventas
      ${andExtra(coordScope.sql, `NULLIF(Coordinador, '') IS NOT NULL`)}
      GROUP BY Coordinador
    `);
    params.push(...coordScope.params);

    selects.push(`
      SELECT 2 AS sort_group, 'agente' AS kind, NULL AS value, Cod_Agente AS codigo, MIN(Agente) AS nombre
      FROM ventas
      ${andExtra(agentScope.sql, `NULLIF(Cod_Agente, '') IS NOT NULL`)}
      GROUP BY Cod_Agente
    `);
    params.push(...agentScope.params);

    selects.push(`
      SELECT 3 AS sort_group, 'grupo' AS kind, Grupo_Familia AS value, NULL AS codigo, NULL AS nombre
      FROM ventas
      ${andExtra(groupScope.sql, `NULLIF(Grupo_Familia, '') IS NOT NULL`)}
      GROUP BY Grupo_Familia
    `);
    params.push(...groupScope.params);

    selects.push(`
      SELECT 4 AS sort_group, 'marca' AS kind, Marca AS value, NULL AS codigo, NULL AS nombre
      FROM ventas
      ${andExtra(brandScope.sql, `NULLIF(Marca, '') IS NOT NULL`)}
      GROUP BY Marca
    `);
    params.push(...brandScope.params);
  }

  const rows = await queryAll(env, `
    SELECT sort_group, kind, value, codigo, nombre
    FROM (
      ${selects.join("\nUNION ALL\n")}
    ) state_options_bundle
    ORDER BY
      sort_group ASC,
      COALESCE(value, nombre, '') COLLATE NOCASE ASC,
      COALESCE(codigo, '') COLLATE NOCASE ASC
  `, params);

  const grouped = {
    coordinadores: [],
    agentes: [],
    grupos: [],
    marcas: []
  };

  for (const row of (rows || [])) {
    if (row?.kind === "coordinador") grouped.coordinadores.push({ value: String(row.value || "") });
    else if (row?.kind === "agente") grouped.agentes.push({ codigo: String(row.codigo || ""), nombre: String(row.nombre || row.codigo || "") });
    else if (row?.kind === "grupo") grouped.grupos.push({ value: String(row.value || "") });
    else if (row?.kind === "marca") grouped.marcas.push({ value: String(row.value || "") });
  }

  return grouped;
}

export async function queryStateSimpleOptions(env, runtime, f) {
  const bundle = await queryStateOptionsBundle(env, runtime, f);
  return {
    coordinadores: bundle.coordinadores,
    grupos: bundle.grupos,
    marcas: bundle.marcas
  };
}

export async function queryCoordinatorOptions(env, runtime, f) {
  if (canUseMaterializedScope(runtime, f)) {
    return queryAll(env, `
      SELECT DISTINCT Coordinador AS value
      FROM scope_catalogo
      WHERE NULLIF(Coordinador, '') IS NOT NULL
      ORDER BY Coordinador COLLATE NOCASE ASC
    `);
  }

  const scope = buildWhere(f, []);
  return queryAll(env, `
    SELECT DISTINCT Coordinador AS value
    FROM ventas
    ${andExtra(scope.sql, `NULLIF(Coordinador, '') IS NOT NULL`)}
    ORDER BY Coordinador COLLATE NOCASE ASC
  `, scope.params);
}

export async function queryAgentOptions(env, runtime, f) {
  const bundle = await queryStateOptionsBundle(env, runtime, f);
  return bundle.agentes;
}

export async function querySelectedClientOptions(env, runtime, f) {
  if (!f.cliente) return [];
  return queryClientOptionsLazy(env, runtime, f, f.cliente, 10, true);
}

export async function querySelectedProductOptions(env, runtime, f) {
  if (!Array.isArray(f.codProd) || !f.codProd.length) return [];

  const inputList = f.codProd.slice(0, 50).map(codigo => String(codigo));
  const uniqueCodes = [...new Set(inputList)];
  if (!uniqueCodes.length) return [];

  let rows = [];

  if (canUseCurrentPeriodScope(runtime, f)) {
    rows = await queryCurrentMonthSelectedProductRows(env, runtime, f, uniqueCodes);
  } else if (canUseMaterializedScope(runtime, f) && runtime.hasProductosCatalogo) {
    const scope = buildBusinessWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca"]);
    const placeholders = uniqueCodes.map(() => "?").join(",");

    if (!scope.sql) {
      rows = await queryAll(env, `
        SELECT Cod_Producto AS codigo, Producto_Desc AS nombre
        FROM productos_catalogo
        WHERE Cod_Producto IN (${placeholders})
      `, uniqueCodes);
    } else {
      rows = await queryAll(env, `
        SELECT p.Cod_Producto AS codigo, p.Producto_Desc AS nombre
        FROM productos_catalogo p
        JOIN (
          SELECT DISTINCT Cod_Producto
          FROM scope_catalogo
          ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL`)}
        ) s ON s.Cod_Producto = p.Cod_Producto
        WHERE p.Cod_Producto IN (${placeholders})
      `, [...scope.params, ...uniqueCodes]);
    }
  } else {
    const scope = buildWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca"]);
    const placeholders = uniqueCodes.map(() => "?").join(",");

    if (!runtime.hasProductosCatalogo) {
      rows = await queryAll(env, `
        SELECT Cod_Producto AS codigo, MIN(Producto_Desc) AS nombre
        FROM ventas
        ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL AND Cod_Producto IN (${placeholders})`)}
        GROUP BY Cod_Producto
      `, [...scope.params, ...uniqueCodes]);
    } else if (!scope.sql) {
      rows = await queryAll(env, `
        SELECT Cod_Producto AS codigo, Producto_Desc AS nombre
        FROM productos_catalogo
        WHERE Cod_Producto IN (${placeholders})
      `, uniqueCodes);
    } else {
      rows = await queryAll(env, `
        SELECT p.Cod_Producto AS codigo, p.Producto_Desc AS nombre
        FROM productos_catalogo p
        JOIN (
          SELECT DISTINCT Cod_Producto
          FROM ventas
          ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL`)}
        ) v ON v.Cod_Producto = p.Cod_Producto
        WHERE p.Cod_Producto IN (${placeholders})
      `, [...scope.params, ...uniqueCodes]);
    }
  }

  const mapByCode = new Map();
  for (const row of (rows || [])) {
    const key = String(row?.codigo || "");
    if (!mapByCode.has(key)) {
      mapByCode.set(key, {
        codigo: String(row?.codigo || ""),
        nombre: String(row?.nombre || row?.codigo || "")
      });
    }
  }

  return inputList.map(codigo => {
    const key = String(codigo);
    return mapByCode.get(key) || { codigo: key, nombre: key };
  });
}

export async function queryClientOptionsLazy(env, runtime, f, search = "", limit = 25, forceSelected = false) {
  const filterSearch = !forceSelected && String(search || "").trim();
  const selectedSearch = forceSelected ? String(search || "").trim() : "";
  if (canUseCurrentPeriodScope(runtime, f)) {
    return queryCurrentMonthClientOptionsLazy(env, runtime, f, search, limit, forceSelected);
  }
  if (canUseMaterializedScope(runtime, f) && runtime.hasClientesCatalogo) {
    const scope = buildBusinessWhere(f, ["coordinador", "agente"]);
    const searchSpec = buildCatalogSearchClause(forceSelected ? selectedSearch : filterSearch, scope.sql ? ["c.Cod_Cliente", "c.Cliente"] : ["Cod_Cliente", "Cliente"]);
    if (!scope.sql) {
      return queryAll(env, `
        SELECT Cod_Cliente AS codigo, Cliente AS nombre
        FROM clientes_catalogo
        ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
        ORDER BY Cliente COLLATE NOCASE ASC, Cod_Cliente COLLATE NOCASE ASC
        LIMIT ?
      `, [...searchSpec.params, limit]);
    }

    return queryAll(env, `
      SELECT c.Cod_Cliente AS codigo, c.Cliente AS nombre
      FROM clientes_catalogo c
      JOIN (
        SELECT DISTINCT Cod_Cliente
        FROM scope_catalogo
        ${andExtra(scope.sql, `NULLIF(Cod_Cliente, '') IS NOT NULL`)}
      ) s ON s.Cod_Cliente = c.Cod_Cliente
      ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
      ORDER BY c.Cliente COLLATE NOCASE ASC, c.Cod_Cliente COLLATE NOCASE ASC
      LIMIT ?
    `, [...scope.params, ...searchSpec.params, limit]);
  }

  const scope = buildWhere(f, ["coordinador", "agente"]);
  const searchSpec = buildCatalogSearchClause(forceSelected ? selectedSearch : filterSearch, runtime.hasClientesCatalogo ? ["c.Cod_Cliente", "c.Cliente"] : ["Cod_Cliente", "Cliente"]);

  if (!runtime.hasClientesCatalogo) {
    return queryAll(env, `
      SELECT Cod_Cliente AS codigo, MIN(Cliente) AS nombre
      FROM ventas
      ${andExtra(scope.sql, `NULLIF(Cod_Cliente, '') IS NOT NULL`)}
      ${searchSpec.sql ? `AND ${searchSpec.sql}` : ""}
      GROUP BY Cod_Cliente
      ORDER BY nombre COLLATE NOCASE ASC, codigo COLLATE NOCASE ASC
      LIMIT ?
    `, [...scope.params, ...searchSpec.params, limit]);
  }

  if (!scope.sql) {
    return queryAll(env, `
      SELECT Cod_Cliente AS codigo, Cliente AS nombre
      FROM clientes_catalogo c
      ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
      ORDER BY Cliente COLLATE NOCASE ASC, Cod_Cliente COLLATE NOCASE ASC
      LIMIT ?
    `, [...searchSpec.params, limit]);
  }

  return queryAll(env, `
    SELECT c.Cod_Cliente AS codigo, c.Cliente AS nombre
    FROM clientes_catalogo c
    JOIN (
      SELECT DISTINCT Cod_Cliente
      FROM ventas
      ${andExtra(scope.sql, `NULLIF(Cod_Cliente, '') IS NOT NULL`)}
    ) v ON v.Cod_Cliente = c.Cod_Cliente
    ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
    ORDER BY c.Cliente COLLATE NOCASE ASC, c.Cod_Cliente COLLATE NOCASE ASC
    LIMIT ?
  `, [...scope.params, ...searchSpec.params, limit]);
}

export async function queryProductOptionsLazy(env, runtime, f, search = "", limit = 25, forceSelected = false) {
  const filterSearch = !forceSelected && String(search || "").trim();
  const selectedSearch = forceSelected ? String(search || "").trim() : "";
  if (canUseCurrentPeriodScope(runtime, f)) {
    return queryCurrentMonthProductOptionsLazy(env, runtime, f, search, limit, forceSelected);
  }
  if (canUseMaterializedScope(runtime, f) && runtime.hasProductosCatalogo) {
    const scope = buildBusinessWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca"]);
    const searchSpec = buildCatalogSearchClause(forceSelected ? selectedSearch : filterSearch, scope.sql ? ["p.Cod_Producto", "p.Producto_Desc"] : ["Cod_Producto", "Producto_Desc"]);

    if (!scope.sql) {
      return queryAll(env, `
        SELECT Cod_Producto AS codigo, Producto_Desc AS nombre
        FROM productos_catalogo
        ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
        ORDER BY Cod_Producto COLLATE NOCASE ASC, Producto_Desc COLLATE NOCASE ASC
        LIMIT ?
      `, [...searchSpec.params, limit]);
    }

    return queryAll(env, `
      SELECT p.Cod_Producto AS codigo, p.Producto_Desc AS nombre
      FROM productos_catalogo p
      JOIN (
        SELECT DISTINCT Cod_Producto
        FROM scope_catalogo
        ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL`)}
      ) s ON s.Cod_Producto = p.Cod_Producto
      ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
      ORDER BY p.Cod_Producto COLLATE NOCASE ASC, p.Producto_Desc COLLATE NOCASE ASC
      LIMIT ?
    `, [...scope.params, ...searchSpec.params, limit]);
  }

  const scope = buildWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca"]);
  const searchSpec = buildCatalogSearchClause(forceSelected ? selectedSearch : filterSearch, runtime.hasProductosCatalogo ? ["p.Cod_Producto", "p.Producto_Desc"] : ["Cod_Producto", "Producto_Desc"]);
  if (!runtime.hasProductosCatalogo) {
    return queryAll(env, `
      SELECT Cod_Producto AS codigo, MIN(Producto_Desc) AS nombre
      FROM ventas
      ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL`)}
      ${searchSpec.sql ? `AND ${searchSpec.sql}` : ""}
      GROUP BY Cod_Producto
      ORDER BY codigo COLLATE NOCASE ASC, nombre COLLATE NOCASE ASC
      LIMIT ?
    `, [...scope.params, ...searchSpec.params, limit]);
  }

  if (!scope.sql) {
    return queryAll(env, `
      SELECT Cod_Producto AS codigo, Producto_Desc AS nombre
      FROM productos_catalogo p
      ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
      ORDER BY Cod_Producto COLLATE NOCASE ASC, Producto_Desc COLLATE NOCASE ASC
      LIMIT ?
    `, [...searchSpec.params, limit]);
  }

  return queryAll(env, `
    SELECT p.Cod_Producto AS codigo, p.Producto_Desc AS nombre
    FROM productos_catalogo p
    JOIN (
      SELECT DISTINCT Cod_Producto
      FROM ventas
      ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL`)}
    ) v ON v.Cod_Producto = p.Cod_Producto
    ${searchSpec.sql ? `WHERE ${searchSpec.sql}` : ""}
    ORDER BY p.Cod_Producto COLLATE NOCASE ASC, p.Producto_Desc COLLATE NOCASE ASC
    LIMIT ?
  `, [...scope.params, ...searchSpec.params, limit]);
}

export async function queryClientOptions(env, runtime, f) {
  if (canUseMaterializedScope(runtime, f) && runtime.hasClientesCatalogo) {
    const scope = buildBusinessWhere(f, ["coordinador", "agente"]);

    if (!scope.sql) {
      return queryAll(env, `
        SELECT Cod_Cliente AS codigo, Cliente AS nombre
        FROM clientes_catalogo
        ORDER BY Cliente COLLATE NOCASE ASC, Cod_Cliente COLLATE NOCASE ASC
      `);
    }

    return queryAll(env, `
      SELECT c.Cod_Cliente AS codigo, c.Cliente AS nombre
      FROM clientes_catalogo c
      JOIN (
        SELECT DISTINCT Cod_Cliente
        FROM scope_catalogo
        ${andExtra(scope.sql, `NULLIF(Cod_Cliente, '') IS NOT NULL`)}
      ) s ON s.Cod_Cliente = c.Cod_Cliente
      ORDER BY c.Cliente COLLATE NOCASE ASC, c.Cod_Cliente COLLATE NOCASE ASC
    `, scope.params);
  }

  const scope = buildWhere(f, ["coordinador", "agente"]);
  if (!runtime.hasClientesCatalogo) {
    return queryAll(env, `
      SELECT Cod_Cliente AS codigo, MIN(Cliente) AS nombre
      FROM ventas
      ${andExtra(scope.sql, `NULLIF(Cod_Cliente, '') IS NOT NULL`)}
      GROUP BY Cod_Cliente
      ORDER BY nombre COLLATE NOCASE ASC, codigo COLLATE NOCASE ASC
    `, scope.params);
  }

  if (!scope.sql) {
    return queryAll(env, `
      SELECT Cod_Cliente AS codigo, Cliente AS nombre
      FROM clientes_catalogo
      ORDER BY Cliente COLLATE NOCASE ASC, Cod_Cliente COLLATE NOCASE ASC
    `);
  }

  return queryAll(env, `
    SELECT c.Cod_Cliente AS codigo, c.Cliente AS nombre
    FROM clientes_catalogo c
    JOIN (
      SELECT DISTINCT Cod_Cliente
      FROM ventas
      ${andExtra(scope.sql, `NULLIF(Cod_Cliente, '') IS NOT NULL`)}
    ) v ON v.Cod_Cliente = c.Cod_Cliente
    ORDER BY c.Cliente COLLATE NOCASE ASC, c.Cod_Cliente COLLATE NOCASE ASC
  `, scope.params);
}

export async function queryGroupOptions(env, runtime, f) {
  if (canUseMaterializedScope(runtime, f)) {
    const scope = buildBusinessWhere(f, ["coordinador", "agente", "cliente"]);
    return queryAll(env, `
      SELECT DISTINCT Grupo_Familia AS value
      FROM scope_catalogo
      ${andExtra(scope.sql, `NULLIF(Grupo_Familia, '') IS NOT NULL`)}
      ORDER BY Grupo_Familia COLLATE NOCASE ASC
    `, scope.params);
  }

  const scope = buildWhere(f, ["coordinador", "agente", "cliente"]);
  return queryAll(env, `
    SELECT DISTINCT Grupo_Familia AS value
    FROM ventas
    ${andExtra(scope.sql, `NULLIF(Grupo_Familia, '') IS NOT NULL`)}
    ORDER BY Grupo_Familia COLLATE NOCASE ASC
  `, scope.params);
}

export async function queryBrandOptions(env, runtime, f) {
  if (canUseMaterializedScope(runtime, f)) {
    const scope = buildBusinessWhere(f, ["coordinador", "agente", "cliente", "grupo"]);
    return queryAll(env, `
      SELECT DISTINCT Marca AS value
      FROM scope_catalogo
      ${andExtra(scope.sql, `NULLIF(Marca, '') IS NOT NULL`)}
      ORDER BY Marca COLLATE NOCASE ASC
    `, scope.params);
  }

  const scope = buildWhere(f, ["coordinador", "agente", "cliente", "grupo"]);
  return queryAll(env, `
    SELECT DISTINCT Marca AS value
    FROM ventas
    ${andExtra(scope.sql, `NULLIF(Marca, '') IS NOT NULL`)}
    ORDER BY Marca COLLATE NOCASE ASC
  `, scope.params);
}

export async function queryProductOptions(env, runtime, f) {
  if (canUseMaterializedScope(runtime, f) && runtime.hasProductosCatalogo) {
    const scope = buildBusinessWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca"]);

    if (!scope.sql) {
      return queryAll(env, `
        SELECT Cod_Producto AS codigo, Producto_Desc AS nombre
        FROM productos_catalogo
        ORDER BY Cod_Producto COLLATE NOCASE ASC, Producto_Desc COLLATE NOCASE ASC
      `);
    }

    return queryAll(env, `
      SELECT p.Cod_Producto AS codigo, p.Producto_Desc AS nombre
      FROM productos_catalogo p
      JOIN (
        SELECT DISTINCT Cod_Producto
        FROM scope_catalogo
        ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL`)}
      ) s ON s.Cod_Producto = p.Cod_Producto
      ORDER BY p.Cod_Producto COLLATE NOCASE ASC, p.Producto_Desc COLLATE NOCASE ASC
    `, scope.params);
  }

  const scope = buildWhere(f, ["coordinador", "agente", "cliente", "grupo", "marca"]);
  if (!runtime.hasProductosCatalogo) {
    return queryAll(env, `
      SELECT Cod_Producto AS codigo, MIN(Producto_Desc) AS nombre
      FROM ventas
      ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL`)}
      GROUP BY Cod_Producto
      ORDER BY codigo COLLATE NOCASE ASC, nombre COLLATE NOCASE ASC
    `, scope.params);
  }

  if (!scope.sql) {
    return queryAll(env, `
      SELECT Cod_Producto AS codigo, Producto_Desc AS nombre
      FROM productos_catalogo
      ORDER BY Cod_Producto COLLATE NOCASE ASC, Producto_Desc COLLATE NOCASE ASC
    `);
  }

  return queryAll(env, `
    SELECT p.Cod_Producto AS codigo, p.Producto_Desc AS nombre
    FROM productos_catalogo p
    JOIN (
      SELECT DISTINCT Cod_Producto
      FROM ventas
      ${andExtra(scope.sql, `NULLIF(Cod_Producto, '') IS NOT NULL`)}
    ) v ON v.Cod_Producto = p.Cod_Producto
    ORDER BY p.Cod_Producto COLLATE NOCASE ASC, p.Producto_Desc COLLATE NOCASE ASC
  `, scope.params);
}

export async function queryMonthStateOptionsFastPath(env, runtime, f) {
  const yearMonth = getExactYearMonthKey(f);
  if (!runtime.hasStateOptionsMonthGlobal || !yearMonth) {
    return queryStateOptionsBundle(env, runtime, f);
  }

  const rows = await queryAll(env, `
    SELECT sort_group, kind, value, codigo, nombre
    FROM state_options_month_global
    WHERE YearMonth = ?
    ORDER BY
      sort_group ASC,
      COALESCE(value, nombre, '') COLLATE NOCASE ASC,
      COALESCE(codigo, '') COLLATE NOCASE ASC
  `, [yearMonth]);

  const grouped = {
    coordinadores: [],
    agentes: [],
    grupos: [],
    marcas: []
  };

  for (const row of (rows || [])) {
    if (row?.kind === "coordinador") grouped.coordinadores.push({ value: String(row.value || "") });
    else if (row?.kind === "agente") grouped.agentes.push({ codigo: String(row.codigo || ""), nombre: String(row.nombre || row.codigo || "") });
    else if (row?.kind === "grupo") grouped.grupos.push({ value: String(row.value || "") });
    else if (row?.kind === "marca") grouped.marcas.push({ value: String(row.value || "") });
  }

  return grouped;
}

// ─── queryRegionOptions ───────────────────────────────────────────────────────
// Devuelve la lista de regiones disponibles para el contexto de filtros activo.
// Region NO existe en scope_catalogo ni en ventas_mes_scope, por lo que siempre
// se consulta directamente contra la tabla ventas (la única que tiene la columna).
// Se aplican los filtros de dimensión activos (coordinador, agente, cliente,
// grupo, marca) para acotar la lista al contexto del usuario.
// El propio filtro de región NO se aplica para no auto-filtrar la lista.
// Retorna: Array<{ value: string }> — mismo shape que coordinadores/grupos/marcas.

export async function queryRegionOptions(env, runtime, f) {
  if (!runtime.hasVentas) return [];

  const scope = buildWhere(
    { ...f, region: "" },
    ["coordinador", "agente", "cliente", "grupo", "marca"]
  );

  const rows = await queryAll(env, `
    SELECT DISTINCT Region AS value
    FROM ventas
    ${andExtra(scope.sql, "NULLIF(TRIM(Region), '') IS NOT NULL")}
    ORDER BY Region COLLATE NOCASE ASC
  `, scope.params);

  return (rows || [])
    .filter(r => r?.value != null && String(r.value).trim() !== "")
    .map(r => ({ value: String(r.value).trim() }));
}
