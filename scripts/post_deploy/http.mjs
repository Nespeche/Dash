export async function getJson({ name, url, headers }) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "follow",
    cache: "no-store"
  });
  const text = await response.text();
  const elapsedMs = Date.now() - startedAt;

  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`${name}: la respuesta no es JSON válido. Inicio: ${text.slice(0, 220)}`);
  }

  if (!response.ok) {
    const message = payload?.mensaje || payload?.error || text || `HTTP ${response.status}`;
    throw new Error(`${name}: HTTP ${response.status}. ${message}`);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error(`${name}: la respuesta JSON está vacía o no es un objeto.`);
  }

  return {
    payload,
    response,
    elapsedMs
  };
}
