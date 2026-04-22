import { createCatalogStore } from "./catalog-store.js";
import { createClientSearchController } from "./client-search-controller.js";
import { createProductSelectorController } from "./product-selector-controller.js";
import { createFilterPillsController } from "./filter-pills-controller.js";

export function createFilterController(ctx) {
  const {
    constants,
    helpers,
    stores,
    ui,
    callbacks,
    apis,
    runtime
  } = ctx;

  function getPeriodo() {
    return stores.getPeriodo();
  }

  function setPeriodo(next) {
    stores.setPeriodo(next);
    return next;
  }

  function getFiltros() {
    return stores.getFiltros();
  }

  function setFiltros(next) {
    stores.setFiltros(next);
    return next;
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

  function closeSearchDropdown(id) {
    const dropdown = helpers.el(id);
    if (!dropdown) return;
    if (id === "clientDropdown") ui.getClientCombobox()?.close();
    if (id === "productDropdown") ui.getProductCombobox()?.close();
    dropdown.innerHTML = "";
    dropdown.classList.remove("open");
    dropdown.parentElement?.classList.remove("is-open");
  }

  function setHiddenSelectOptions(id, items, placeholder, selectedValues = []) {
    const select = helpers.el(id);
    if (!select) return;
    const selectedSet = new Set((selectedValues || []).map(String));
    select.innerHTML = `<option value="">${helpers.escHtml(placeholder)}</option>` +
      (items || []).map(item => {
        const value = helpers.escHtml(item.codigo);
        const text = helpers.escHtml(item.label || item.nombre || item.codigo);
        const selected = selectedSet.has(String(item.codigo)) ? " selected" : "";
        return `<option value="${value}"${selected}>${text}</option>`;
      }).join("");
  }

  function fillSel(id, items, placeholder, currentValue = "") {
    const select = helpers.el(id);
    if (!select) return;
    select.innerHTML = `<option value="">${placeholder}</option>` +
      items.map(item => `<option value="${helpers.escHtml(item)}">${helpers.escHtml(item)}</option>`).join("");
    select.value = currentValue;
  }

  let clientSearchController = null;
  let productSelectorController = null;

  const catalogStore = createCatalogStore({
    constants,
    stores,
    apis,
    runtime,
    invalidateClientOptionCache: () => clientSearchController?.invalidateClientOptionCache?.(),
    invalidateProductOptionCache: () => productSelectorController?.invalidateProductOptionCache?.()
  });

  productSelectorController = createProductSelectorController({
    constants,
    helpers,
    stores,
    ui,
    callbacks,
    catalogStore,
    closeSearchDropdown,
    setHiddenSelectOptions
  });

  clientSearchController = createClientSearchController({
    constants,
    helpers,
    stores,
    ui,
    callbacks,
    catalogStore,
    closeSearchDropdown,
    setHiddenSelectOptions,
    clearProductInputSilent: () => productSelectorController.clearProductInputSilent()
  });

  const pillsController = createFilterPillsController({
    constants,
    helpers,
    stores,
    callbacks,
    getSelectedProducts: () => productSelectorController.getSelectedProducts(),
    hasProductFilter: () => productSelectorController.hasProductFilter(),
    getSelectedClientLabel: () => clientSearchController.getSelectedClientLabel(),
    getProductLabel: code => productSelectorController.getLabel(code)
  });

  function resetFilters() {
    setFiltros({ coordinador: "", agente: "", cliente: "", grupo: "", marca: "", region: "", codProd: [] });
    const productInput = helpers.el("iProd");
    if (productInput) productInput.value = "";
    const clientInput = helpers.el("iClie");
    if (clientInput) clientInput.value = "";
    const regionSelect = helpers.el("sReg");
    if (regionSelect) regionSelect.value = "";
    closeSearchDropdown("productDropdown");
    closeSearchDropdown("clientDropdown");
    productSelectorController.renderSelectedProducts();
    setKeepProductDropdownOpenState(false);
    clientSearchController.syncClientSearchUI();
    productSelectorController.syncProductSearchUI();
  }

  function scheduleClientDropdownLoad(term = "", immediate = false) {
    catalogStore.scheduleClientLoad(term, immediate, async () => {
      try {
        await catalogStore.fetchCatalogOptions("clientes", term);
        clientSearchController.renderClientDropdown(clientSearchController.filterClientOptions(term));
      } catch (error) {
        if (error?.name !== "AbortError" && !/Autenticacion requerida/i.test(String(error?.message || ""))) {
          console.warn("[catalog.clientes]", error);
        }
      }
    });
  }

  function scheduleProductDropdownLoad(term = "", immediate = false) {
    catalogStore.scheduleProductLoad(term, immediate, async () => {
      try {
        await catalogStore.fetchCatalogOptions("productos", term);
        productSelectorController.renderProductDropdown(productSelectorController.filterProductOptions(term));
      } catch (error) {
        if (error?.name !== "AbortError" && !/Autenticacion requerida/i.test(String(error?.message || ""))) {
          console.warn("[catalog.productos]", error);
        }
      }
    });
  }

  function rebuildSelects() {
    const dashboardState = getDashboardState();
    const filtros = getFiltros();
    const opt = dashboardState.options || stores.createEmptyDashboardOptions();
    const catalogState = getCatalogState();
    const clientScopeKey = catalogStore.buildCatalogScopeKey("clientes");
    const productScopeKey = catalogStore.buildCatalogScopeKey("productos");

    if (catalogState.clientes.scopeKey !== clientScopeKey) {
      catalogStore.setCatalogItems("clientes", opt.clientes || [], clientScopeKey);
    } else {
      catalogStore.mergeCatalogItems("clientes", opt.clientes || []);
    }

    if (catalogState.productos.scopeKey !== productScopeKey) {
      catalogStore.setCatalogItems("productos", opt.productos || [], productScopeKey);
    } else {
      catalogStore.mergeCatalogItems("productos", opt.productos || []);
    }

    fillSel("sCoord", opt.coordinadores || [], "Todos los coordinadores", filtros.coordinador);

    const agentSelect = helpers.el("sAgte");
    if (agentSelect) {
      agentSelect.innerHTML = `<option value="">Todos los agentes</option>` +
        (opt.agentes || []).map(item =>
          `<option value="${helpers.escHtml(item.codigo)}">${helpers.escHtml(item.nombre)} — Cód: ${helpers.escHtml(item.codigo)}</option>`
        ).join("");
      agentSelect.value = filtros.agente;
    }

    fillSel("sGrp", opt.grupos || [], "Todos los grupos", filtros.grupo);
    fillSel("sMrc", opt.marcas || [], "Todas las marcas", filtros.marca);
    fillSel("sReg", opt.regiones || [], "Todas las regiones", filtros.region || "");

    clientSearchController.syncClientSearchUI();
    productSelectorController.syncProductSearchUI();

    [
      ["sn1", "coordinador"], ["sn2", "agente"], ["sn3", "cliente"],
      ["sn4", "grupo"], ["sn5", "marca"], ["sn6", "codProd"]
    ].forEach(([id, key]) => {
      const node = helpers.el(id);
      if (!node) return;
      const active = key === "codProd" ? productSelectorController.hasProductFilter() : !!filtros[key];
      node.classList.toggle("on", active);
    });

    // v40: badge activo para Región (snReg) — estaba ausente en la versión anterior
    const snReg = helpers.el("snReg");
    if (snReg) snReg.classList.toggle("on", !!filtros.region);
  }

  function clearTransientCaches() {
    catalogStore.clearTransientCaches();
    clientSearchController.clearLabelCache();
    productSelectorController.clearLabelCache();
  }

  return {
    getPeriodo,
    setPeriodo,
    getFiltros,
    setFiltros,
    setFiltersCollapsed: pillsController.setFiltersCollapsed,
    applyPeriod: pillsController.applyPeriod,
    resetFilters,
    getSelectedProducts: () => productSelectorController.getSelectedProducts(),
    hasProductFilter: () => productSelectorController.hasProductFilter(),
    countBusinessFilters: pillsController.countBusinessFilters,
    shouldShowSummaryTable: pillsController.shouldShowSummaryTable,
    getSelectedClientLabel: () => clientSearchController.getSelectedClientLabel(),
    clearClientSelectionState: options => clientSearchController.clearClientSelectionState(options),
    syncClientSearchUI: () => clientSearchController.syncClientSearchUI(),
    renderClientDropdown: result => clientSearchController.renderClientDropdown(result),
    setClientSelection: (codigo, nombre, silent) => clientSearchController.setClientSelection(codigo, nombre, silent),
    clearClientSelection: silent => clientSearchController.clearClientSelection(silent),
    clearProductInputSilent: () => productSelectorController.clearProductInputSilent(),
    buildCatalogScopeKey: kind => catalogStore.buildCatalogScopeKey(kind),
    mergeCatalogItems: (kind, items) => catalogStore.mergeCatalogItems(kind, items),
    setCatalogItems: (kind, items, scopeKey) => catalogStore.setCatalogItems(kind, items, scopeKey),
    fetchCatalogOptions: (kind, term, options) => catalogStore.fetchCatalogOptions(kind, term, options),
    scheduleClientDropdownLoad,
    scheduleProductDropdownLoad,
    filterClientOptions: term => clientSearchController.filterClientOptions(term),
    closeSearchDropdown,
    syncProductSearchUI: () => productSelectorController.syncProductSearchUI(),
    renderProductDropdown: result => productSelectorController.renderProductDropdown(result),
    addProductSelection: (codigo, nombre, silent) => productSelectorController.addProductSelection(codigo, nombre, silent),
    removeProductSelection: (codigo, silent) => productSelectorController.removeProductSelection(codigo, silent),
    clearProductSelection: silent => productSelectorController.clearProductSelection(silent),
    renderSelectedProducts: () => productSelectorController.renderSelectedProducts(),
    rebuildSelects,
    updatePills: () => pillsController.updatePills(),
    filterProductOptions: term => productSelectorController.filterProductOptions(term),
    clearTransientCaches,
    getKeepProductDropdownOpenState,
    setKeepProductDropdownOpenState
  };
}
