import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = process.env.POST_DEPLOY_ROOT_DIR
  ? path.resolve(process.env.POST_DEPLOY_ROOT_DIR)
  : path.resolve(MODULE_DIR, "../..");

async function readTextFile(targetPath, description) {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        `${description} no encontrado en '${targetPath}'. Verificá que aplicaste el patch dentro de la raíz real del proyecto Dash.`
      );
    }
    throw error;
  }
}

export async function readWranglerName(rootDir = ROOT_DIR) {
  const targetPath = path.resolve(rootDir, "wrangler.toml");
  const file = await readTextFile(targetPath, "wrangler.toml");
  const match = file.match(/^name\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("No se pudo leer el nombre del Worker desde wrangler.toml.");
  return match[1].trim();
}

export async function readConfiguredApiBase(rootDir = ROOT_DIR) {
  const targetPath = path.resolve(rootDir, "public", "config.js");
  const file = await readTextFile(targetPath, "public/config.js");
  const match = file.match(/apiBase:\s*"([^"]+)"/);
  if (!match) throw new Error("No se pudo leer apiBase desde public/config.js.");
  return match[1].trim().replace(/\/+$/, "");
}

export function resolveApiBase({ configuredApiBase }) {
  const override = String(process.env.POST_DEPLOY_API_BASE || "").trim().replace(/\/+$/, "");
  return override || configuredApiBase;
}

export function resolveBasicAuthHeader() {
  const token = String(process.env.VENTAS_API_BASIC_TOKEN || "").trim();
  if (token) return `Basic ${token}`;

  const user = String(process.env.VENTAS_API_USER || "").trim();
  const pass = String(process.env.VENTAS_API_PASS || "");
  if (user && pass) {
    const encoded = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
    return `Basic ${encoded}`;
  }

  throw new Error(
    "Faltan credenciales para validar el deploy. Definí VENTAS_API_BASIC_TOKEN o VENTAS_API_USER y VENTAS_API_PASS."
  );
}

export function getMonthWindow(monthArg = "") {
  const raw = String(monthArg || process.env.POST_DEPLOY_MONTH || "").trim();
  const base = raw || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(base)) {
    throw new Error(`Mes inválido '${base}'. Usá el formato YYYY-MM.`);
  }
  const [yearStr, monthStr] = base.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Mes inválido '${base}'.`);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    monthKey: base,
    year,
    month,
    desde: `${base}-01`,
    hasta: `${base}-${String(lastDay).padStart(2, "0")}`
  };
}

export function ensureConfigConsistency({ workerName, apiBase }) {
  const host = new URL(apiBase).host;
  if (!host.includes(workerName)) {
    throw new Error(
      `Inconsistencia detectada: apiBase apunta a '${host}' pero wrangler.toml declara '${workerName}'.`
    );
  }
  return { host };
}


export async function readLocalAppVersion(rootDir = ROOT_DIR) {
  const targetPath = path.resolve(rootDir, "src", "shared", "version.js");
  const file = await readTextFile(targetPath, "src/shared/version.js");
  const match = file.match(/APP_VERSION\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("No se pudo leer APP_VERSION desde src/shared/version.js.");
  return match[1].trim();
}
