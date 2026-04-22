export const AUTH_REALM = "Ventas Dash";

export function authConfigured(env) {
  return Boolean(String(env.APP_AUTH_USER || "").trim() && String(env.APP_AUTH_PASS || "").trim());
}

export async function authenticateRequest(request, env, { unauthorizedResponse }) {
  if (!authConfigured(env)) return { ok: true };

  const header = String(request.headers.get("authorization") || "").trim();
  if (!header.startsWith("Basic ")) {
    return { ok: false, response: unauthorizedResponse() };
  }

  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch (_) {
    return { ok: false, response: unauthorizedResponse() };
  }

  const sep = decoded.indexOf(":");
  if (sep < 0) return { ok: false, response: unauthorizedResponse() };

  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  if (user !== String(env.APP_AUTH_USER || "") || pass !== String(env.APP_AUTH_PASS || "")) {
    return { ok: false, response: unauthorizedResponse() };
  }

  return { ok: true, user };
}
