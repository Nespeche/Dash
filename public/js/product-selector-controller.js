export function createProductSelectorController({
  constants,
  helpers,
  stores,
  ui,
  callbacks,
  catalogStore,
  closeSearchDropdown,
  setHiddenSelectOptions
} = {}) {
  let productOptionsSource = null;
  let productOptionsCache = [];
  const productLabelMap = new Map();

  function getFiltros() {
    return stores.getFiltros();
  }

  function getDashboardState() {
    return stores.getDashboardState();
  }

  function getCatalogState() {
    return stores.getCatalogState();
  }

  function setKeepProductDropdownOpenState(next) {
    stores.setKeepProductDropdownOpen(!!next);
  }

  function getKeepProductDropdownOpenState() {
    return stores.getKeepProductDropdownOpen();
  }

  function invalidateProductOptionCache() {
    productOptionsSource = null;
    productOptionsCache = [];
  }

  function clearLabelCache() {
    productLabelMap.clear();
  }

  function getSelectedProducts() {
    const filtros = getFiltros();
    return Array.isArray(filtros.codProd) ? filtros.codProd.filter(Boolean) : [];
  }

  function hasProductFilter() {
    return getSelectedProducts().length > 0;
  }

  function getProductOptions() {
    const items = getCatalogState().productos?.items || getDashboardState().options?.productos || [];
    if (productOptionsSource === items) return productOptionsCache;
    productOptionsSource = items;
    productOptionsCache = items.map(item => ({
      codigo: String(item.codigo),
      nombre: String(item.nombre || item.codigo),
      label: `${item.codigo} — ${item.nombre || item.codigo}`,
      codeSearch: String(item.codigo || "").toLowerCase().trim(),
      nameSearch: helpers.normText(item.nombre || item.codigo)
    }));
    return productOptionsCache;
  }

  function matchesPrefixTokens(text, query) {
    if (!query) return true;
    if (text.startsWith(query)) return true;
    return text.split(" ").some(token => token.startsWith(query));
  }

  function filterProductOptions(term = "") {
    const all = getProductOptions();
    const qNorm = helpers.normText(term);
    const qCode = String(term || "").trim().toLowerCase();
    const selected = new Set(getSelectedProducts().map(String));
    const matched = all.filter(item => {
      if (selected.has(String(item.codigo))) return false;
      if (!qNorm && !qCode) return true;
      return item.codeSearch.startsWith(qCode) || matchesPrefixTokens(item.nameSearch, qNorm);
    });
    matched.sort((a, b) => helpers.localeEs(a.codigo, b.codigo) || helpers.localeEs(a.nombre, b.nombre));
    const items = (!qNorm && !qCode) ? matched : matched.slice(0, constants.searchDropdownLimit);
    return { items, totalMatched: matched.length, totalAvailable: all.length };
  }

  function renderSelectedProducts() {
    const wrap = helpers.el("prodChips");
    if (!wrap) return;
    const items = getSelectedProducts();
    if (!items.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = items.map(code => {
      const label = productLabelMap.get(code) || code;
      return `<button type="button" class="search-chip" data-codigo="${helpers.escHtml(code)}"><span>${helpers.escHtml(label)}</span><span class="search-chip-x">✕</span></button>`;
    }).join("");
    wrap.querySelectorAll(".search-chip").forEach(btn => {
      btn.addEventListener("click", () => removeProductSelection(btn.dataset.codigo || ""));
    });
  }

  function syncProductSearchUI() {
    const options = getProductOptions();
    const meta = helpers.el("prodMeta");
    const input = helpers.el("iProd");
    const btn = helpers.el("btnProdClr");
    const dashboardState = getDashboardState();
    const catalogState = getCatalogState();

    for (const item of options) productLabelMap.set(item.codigo, item.label);
    if (meta) {
      const selected = getSelectedProducts().length;
      const totalHint = dashboardState.optionsMeta?.productos?.total;
      const loadedLabel = catalogState.productos.loaded ? helpers.fmt(options.length) : "0";
      meta.textContent = selected
        ? `${selected} seleccionados · ${loadedLabel} cargados${Number.isFinite(Number(totalHint)) ? ` · ${helpers.fmt(totalHint)} totales` : ""}`
        : `${loadedLabel} cargados${Number.isFinite(Number(totalHint)) ? ` · ${helpers.fmt(totalHint)} totales` : ""}`;
    }
    if (btn) btn.hidden = !(input?.value || getSelectedProducts().length);
    setHiddenSelectOptions("sCodProd", options, "Todos los productos", getSelectedProducts());
    renderSelectedProducts();
  }

  function renderProductDropdown(result) {
    const dropdown = helpers.el("productDropdown");
    if (!dropdown) return;
    const { items = [], totalMatched = 0, totalAvailable = 0 } = result || {};
    const loading = Boolean(getCatalogState().productos.loading);
    const truncated = totalMatched > items.length;
    if (!items.length) {
      dropdown.innerHTML = `<div class="search-dd-empty">${loading ? "Buscando productos..." : "No se encontraron productos"}</div>`;
      dropdown.classList.add("open");
      ui.getProductCombobox()?.open();
      return;
    }
    dropdown.innerHTML = `
      <div class="search-dd-head">${helpers.fmt(totalMatched)} de ${helpers.fmt(totalAvailable)} productos${loading ? " · buscando..." : ""}</div>
      ${items.map(item => `
        <button type="button" class="search-dd-item" data-role="product-option" data-codigo="${helpers.escHtml(item.codigo)}" data-nombre="${helpers.escHtml(item.nombre)}">
          <span class="search-dd-main">${helpers.escHtml(item.codigo)}</span>
          <span class="search-dd-side">${helpers.escHtml(item.nombre)}</span>
        </button>
      `).join("")}
      ${truncated ? `<div class="search-dd-empty">Escribí más para acotar resultados</div>` : ""}
    `;
    dropdown.classList.add("open");
    ui.getProductCombobox()?.open();
  }

  function clearProductInputSilent() {
    const filtros = getFiltros();
    const input = helpers.el("iProd");
    if (input) input.value = "";
    filtros.codProd = [];
    setKeepProductDropdownOpenState(false);
    closeSearchDropdown("productDropdown");
    renderSelectedProducts();
    syncProductSearchUI();
  }

  function addProductSelection(codigo, nombre, silent = false) {
    const filtros = getFiltros();
    const code = String(codigo || "").trim();
    if (!code) return;
    const current = getSelectedProducts();
    if (!current.includes(code)) filtros.codProd = current.concat(code);
    if (nombre) {
      productLabelMap.set(code, `${code} — ${nombre}`);
      catalogStore.mergeCatalogItems("productos", [{ codigo: code, nombre }]);
    }
    const input = helpers.el("iProd");
    if (input) {
      input.value = "";
      input.focus();
    }
    setKeepProductDropdownOpenState(true);
    renderSelectedProducts();
    syncProductSearchUI();
    renderProductDropdown(filterProductOptions(""));
    if (!silent) callbacks.scheduleStateLoad();
  }

  function removeProductSelection(codigo, silent = false) {
    const filtros = getFiltros();
    filtros.codProd = getSelectedProducts().filter(item => item !== codigo);
    syncProductSearchUI();
    if (!silent) callbacks.scheduleStateLoad();
  }

  function clearProductSelection(silent = false) {
    const filtros = getFiltros();
    filtros.codProd = [];
    const input = helpers.el("iProd");
    if (input) input.value = "";
    setKeepProductDropdownOpenState(false);
    closeSearchDropdown("productDropdown");
    syncProductSearchUI();
    if (!silent) callbacks.scheduleStateLoad();
  }

  function getLabel(code) {
    return productLabelMap.get(code) || code;
  }

  return {
    invalidateProductOptionCache,
    clearLabelCache,
    getSelectedProducts,
    hasProductFilter,
    filterProductOptions,
    syncProductSearchUI,
    renderProductDropdown,
    addProductSelection,
    removeProductSelection,
    clearProductSelection,
    clearProductInputSilent,
    renderSelectedProducts,
    getLabel,
    getKeepProductDropdownOpenState,
    setKeepProductDropdownOpenState
  };
}
