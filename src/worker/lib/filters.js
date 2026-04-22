import { clamp } from "./db.js";

function normalizeDateRange(desde, hasta) {
  const start = desde || null;
  const end = hasta || null;
  if (start && end && start > end) {
    return { desde: end, hasta: start };
  }
  return { desde: start, hasta: end };
}

export function parseFilters(url) {
  const sp = url.searchParams;
  const g = k => String(sp.get(k) || "").trim();
  const d = k => {
    const v = g(k);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const multi = k => {
    const raw = sp.getAll(k).flatMap(v => String(v || "").split(","));
    const cleaned = raw.map(v => v.trim()).filter(Boolean);
    return [...new Set(cleaned)].slice(0, 50);
  };
  const extraColumnFilters = {};
  for (const [key, value] of sp.entries()) {
    if (!String(key).startsWith("xf_")) continue;
    const columnKey = String(key).slice(3).trim();
    if (!columnKey) continue;
    const list = String(value || "").split(",").map(item => item.trim()).filter(Boolean);
    if (!list.length) continue;
    extraColumnFilters[columnKey] = [...new Set([...(extraColumnFilters[columnKey] || []), ...list])].slice(0, 80);
  }

  const normalizedPeriod = normalizeDateRange(d("desde"), d("hasta"));

  return {
    desde: normalizedPeriod.desde,
    hasta: normalizedPeriod.hasta,
    coordinador: g("coordinador"),
    agente: g("agente"),
    cliente: g("cliente"),
    grupo: g("grupo"),
    marca: g("marca"),
    region: g("region"),
    codProd: multi("codProd"),
    projGroups: multi("projGroup"),
    detailGroups: multi("detailGroup"),
    extraColumnFilters
  };
}

export function parseCatalogKind(url) {
  const raw = String(url.searchParams.get("kind") || "").trim().toLowerCase();
  if (raw === "clientes" || raw === "productos") return raw;
  return "";
}

export function parseCatalogSearch(url) {
  return String(url.searchParams.get("q") || "").trim().slice(0, 80);
}

export function parseCatalogLimit(url) {
  return clamp(parseInt(url.searchParams.get("limit") || "", 10), 25, 1, 100);
}

export function parseProjectionDetailGroups(url) {
  return [...new Set(
    url.searchParams
      .getAll("detailGroup")
      .flatMap(v => String(v || "").split(","))
      .map(v => v.trim())
      .filter(Boolean)
  )].slice(0, 20);
}

export function normalizeStringList(values, maxItems = 50) {
  return [...new Set(
    (values || [])
      .flatMap(v => Array.isArray(v) ? v : [v])
      .map(v => String(v || "").trim())
      .filter(Boolean)
  )].slice(0, maxItems);
}

export function hasBusinessFilter(f) {
  return Boolean(
    f.coordinador || f.agente || f.cliente || f.grupo || f.marca || f.region ||
    (Array.isArray(f.codProd) && f.codProd.length)
  );
}

export function hasDetailGroupFilter(f) {
  return Boolean(Array.isArray(f?.detailGroups) && f.detailGroups.length);
}

export function hasDateFilter(f) {
  return Boolean(f?.desde || f?.hasta);
}

export function hasProjectionGroupFilter(f) {
  return Boolean(Array.isArray(f?.projGroups) && f.projGroups.length);
}

export function hasProjectionBusinessFilter(f) {
  return hasBusinessFilter(f) || hasProjectionGroupFilter(f);
}

export function buildWhere(f, dims = []) {
  const where = [];
  const params = [];
  if (f.desde) { where.push("Fecha >= ?"); params.push(f.desde); }
  if (f.hasta) { where.push("Fecha <= ?"); params.push(f.hasta); }
  if (dims.includes("coordinador") && f.coordinador) { where.push("Coordinador = ?"); params.push(f.coordinador); }
  if (dims.includes("agente") && f.agente) { where.push("Cod_Agente = ?"); params.push(f.agente); }
  if (dims.includes("cliente") && f.cliente) { where.push("Cod_Cliente = ?"); params.push(f.cliente); }
  if (dims.includes("grupo") && f.grupo) { where.push("Grupo_Familia = ?"); params.push(f.grupo); }
  if (dims.includes("projGroups") && Array.isArray(f.projGroups) && f.projGroups.length) {
    where.push(`Grupo_Familia IN (${f.projGroups.map(() => "?").join(",")})`);
    params.push(...f.projGroups);
  }
  if (dims.includes("detailGroups") && Array.isArray(f.detailGroups) && f.detailGroups.length) {
    where.push(`Grupo_Familia IN (${f.detailGroups.map(() => "?").join(",")})`);
    params.push(...f.detailGroups);
  }
  if (dims.includes("marca") && f.marca) { where.push("Marca = ?"); params.push(f.marca); }
  if (dims.includes("region") && f.region) { where.push("Region = ?"); params.push(f.region); }
  if (dims.includes("codProd") && Array.isArray(f.codProd) && f.codProd.length) {
    where.push(`Cod_Producto IN (${f.codProd.map(() => "?").join(",")})`);
    params.push(...f.codProd);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export function andExtra(whereSql, extraClause) {
  if (whereSql) return `${whereSql} AND ${extraClause}`;
  return `WHERE ${extraClause}`;
}

export function buildCatalogSearchClause(search, columns = []) {
  const q = String(search || "").trim();
  if (!q) return { sql: "", params: [] };

  const normalized = q.toLowerCase();
  const likeStart = `${normalized}%`;
  const likeAny = `%${normalized}%`;
  const clauses = [];
  const params = [];

  for (const col of columns) {
    clauses.push(`LOWER(COALESCE(${col}, '')) LIKE ?`);
    params.push(likeStart);
    clauses.push(`LOWER(COALESCE(${col}, '')) LIKE ?`);
    params.push(likeAny);
  }

  return { sql: clauses.length ? `(${clauses.join(" OR ")})` : "", params };
}
