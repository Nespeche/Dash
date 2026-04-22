/* theme-toggle.js — v30
 * Toggle entre dark y light mode.
 * Persiste preferencia en localStorage.
 * Respeta prefers-color-scheme la primera vez.
 */

const STORAGE_KEY = "ventasDashTheme";
const ICONS = { dark: "🌙", light: "☀️" };
const META_THEME_COLORS = { dark: "#0a0d16", light: "#f7f8fc" };

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch (_) {}
  return null;
}

function detectInitial() {
  const stored = readStored();
  if (stored) return stored;
  if (typeof window !== "undefined" && window.matchMedia) {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    if (prefersLight) return "light";
  }
  return "dark";
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
  // Update <meta name="theme-color"> for mobile browsers
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", META_THEME_COLORS[theme] || META_THEME_COLORS.dark);
  // Update toggle button icon
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.textContent = theme === "light" ? ICONS.light : ICONS.dark;
    btn.setAttribute("aria-label", theme === "light" ? "Cambiar a tema oscuro" : "Cambiar a tema claro");
    btn.title = theme === "light" ? "Modo claro activo · click para oscuro" : "Modo oscuro activo · click para claro";
  }
}

export function initThemeToggle() {
  const initial = detectInitial();
  applyTheme(initial);
  let current = initial;

  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    current = current === "light" ? "dark" : "light";
    try { localStorage.setItem(STORAGE_KEY, current); } catch (_) {}
    applyTheme(current);
  });
}
