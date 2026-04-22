export async function queryAll(env, sql, params = []) {
  const t0 = performance.now();
  const res = await env.DB.prepare(sql).bind(...params).all();
  console.log(`[db] queryAll ${(performance.now() - t0).toFixed(1)}ms`);
  return res?.results || [];
}

export async function queryFirst(env, sql, params = []) {
  const t0 = performance.now();
  const result = await env.DB.prepare(sql).bind(...params).first();
  console.log(`[db] queryFirst ${(performance.now() - t0).toFixed(1)}ms`);
  return result;
}

export function clamp(n, def, min, max) {
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
