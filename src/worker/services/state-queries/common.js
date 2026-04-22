import { SUMMARY_COLS } from "../../config.js";

export function normalizeRankList(rows) {
  return (rows || []).map(r => ({
    name: String(r.name || ""),
    kilos: Number(r.kilos || 0)
  }));
}

export function summaryTo2D(rows) {
  return (rows || []).map(r => SUMMARY_COLS.map(c => c === "Kilos" ? Number(r[c] || 0) : (r[c] ?? "")));
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
