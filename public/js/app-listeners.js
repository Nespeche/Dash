import { createAccessibleCombobox } from "./accessible-combobox.js";
import { initAccessibleTabs } from "./accessible-tabs.js";

export function setupAppListeners({
  el,
  documentRef = document,
  activeTab,
  onTabChange,
  filterController,
  onFilterChange,
  scheduleStateLoad,
  setProjectionConfig,
  getProjectionConfig,
  persistProjectionConfig,
  renderProjectionPage,
  setTabsController,
  setClientCombobox,
  setProductCombobox,
  getFiltersCollapsed,
  setFiltersCollapsed,
  syncTabsTop,
  setKeepProductDropdownOpen,
  getKeepProductDropdownOpen,
  onClearAll
} = {}) {
  const tabsController = initAccessibleTabs({
    root: el("tabsBar"),
    initialTab: activeTab,
    onChange: onTabChange
  });
  setTabsController?.(tabsController);

  const clientCombobox = createAccessibleCombobox({
    input: el("iClie"),
    dropdown: el("clientDropdown"),
    wrap: el("clientSearchWrap"),
    optionSelector: '[data-role="client-option"]',
    onSelect: option => {
      filterController.setClientSelection(option.dataset.codigo || "", option.dataset.nombre || "");
    }
  });
  setClientCombobox?.(clientCombobox);

  const productCombobox = createAccessibleCombobox({
    input: el("iProd"),
    dropdown: el("productDropdown"),
    wrap: el("productSearchWrap"),
    optionSelector: '[data-role="product-option"]',
    onSelect: option => {
      filterController.addProductSelection(option.dataset.codigo || "", option.dataset.nombre || "");
    }
  });
  setProductCombobox?.(productCombobox);

  let projectionInputTimer = 0;
  const scheduleProjectionRefresh = (delay = 180) => {
    if (projectionInputTimer) clearTimeout(projectionInputTimer);
    projectionInputTimer = window.setTimeout(() => {
      projectionInputTimer = 0;
      persistProjectionConfig();
      renderProjectionPage();
    }, delay);
  };

  documentRef.querySelectorAll(".pbtn").forEach(button => {
    button.addEventListener("click", () => {
      documentRef.querySelectorAll(".pbtn").forEach(node => node.classList.remove("on"));
      button.classList.add("on");
      filterController.applyPeriod(button.dataset.p);
      scheduleStateLoad();
      if (window.matchMedia('(max-width: 860px)').matches) {
        setFiltersCollapsed(true);
      }
    });
  });

  el("fDesde")?.addEventListener("change", event => {
    const current = { ...filterController.getPeriodo?.() };
    current.desde = event.target.value;
    filterController.setPeriodo?.(current);
    documentRef.querySelectorAll(".pbtn").forEach(node => node.classList.remove("on"));
    scheduleStateLoad();
  });

  el("fHasta")?.addEventListener("change", event => {
    const current = { ...filterController.getPeriodo?.() };
    current.hasta = event.target.value;
    filterController.setPeriodo?.(current);
    documentRef.querySelectorAll(".pbtn").forEach(node => node.classList.remove("on"));
    scheduleStateLoad();
  });

  el("btnClrAll")?.addEventListener("click", () => {
    if (window.matchMedia('(max-width: 860px)').matches) {
      if (!window.confirm('¿Limpiar todos los filtros y el período seleccionado?')) return;
    }
    const next = { desde: "", hasta: "" };
    filterController.setPeriodo?.(next);
    const fromInput = el("fDesde");
    const untilInput = el("fHasta");
    if (fromInput) fromInput.value = "";
    if (untilInput) untilInput.value = "";
    documentRef.querySelectorAll(".pbtn").forEach(node => node.classList.remove("on"));
    filterController.resetFilters();
    onClearAll?.();
    scheduleStateLoad();
  });

  // Debounce 80ms: respuesta rápida sin disparar N llamadas API consecutivas
  let _cascadeDebounceTimer = 0;
  function debouncedFilterChange(key, value, delay = 80) {
    clearTimeout(_cascadeDebounceTimer);
    _cascadeDebounceTimer = window.setTimeout(() => { _cascadeDebounceTimer = 0; onFilterChange(key, value); }, delay);
  }
  // Visual feedback inmediato + debounce de 60ms para evitar llamadas API consecutivas
  function withFeedback(el, key, value) {
    el.style.borderColor = "rgba(245,166,35,.55)";
    clearTimeout(el.__fbTimer);
    el.__fbTimer = setTimeout(() => { el.style.borderColor = ""; }, 180);
    debouncedFilterChange(key, value, 60);
  }
  el("sCoord")?.addEventListener("change", ev => withFeedback(ev.target, "coordinador", ev.target.value));
  el("sAgte")?.addEventListener("change",  ev => withFeedback(ev.target, "agente",      ev.target.value));
  el("sGrp")?.addEventListener("change",   ev => withFeedback(ev.target, "grupo",       ev.target.value));
  el("sMrc")?.addEventListener("change",   ev => withFeedback(ev.target, "marca",       ev.target.value));
  el("sReg")?.addEventListener("change",   ev => withFeedback(ev.target, "region",      ev.target.value));

  const clientInput = el("iClie");
  clientInput?.addEventListener("focus", () => {
    filterController.renderClientDropdown(filterController.filterClientOptions(clientInput.value));
    filterController.scheduleClientDropdownLoad(clientInput.value, true);
  });
  clientInput?.addEventListener("input", () => {
    const clearButton = el("btnClieClr");
    const raw = String(clientInput.value || "");
    const trimmed = raw.trim();
    const selectedLabel = filterController.getSelectedClientLabel();
    const filtros = filterController.getFiltros?.() || {};
    const divergedFromSelection = Boolean(filtros.cliente) && raw.normalize("NFD") !== (selectedLabel || "").normalize("NFD");

    if (!trimmed) {
      if (filtros.cliente) {
        filterController.clearClientSelection();
        return;
      }
      if (clearButton) clearButton.hidden = true;
      filterController.renderClientDropdown(filterController.filterClientOptions(""));
      filterController.scheduleClientDropdownLoad("", true);
      return;
    }

    if (divergedFromSelection) {
      filterController.clearClientSelectionState({ clearDependents: true });
      filterController.rebuildSelects();
      filterController.updatePills();
      setFiltersCollapsed(getFiltersCollapsed(), false);
    }

    if (clearButton) clearButton.hidden = false;
    filterController.renderClientDropdown(filterController.filterClientOptions(raw));
    filterController.scheduleClientDropdownLoad(raw);
  });
  clientInput?.addEventListener("keydown", event => {
    clientCombobox?.handleKeydown(event);
  });
  el("btnClieClr")?.addEventListener("click", () => {
    const input = el("iClie");
    const filtros = filterController.getFiltros?.() || {};
    if (input?.value && !filtros.cliente) {
      input.value = "";
      filterController.renderClientDropdown(filterController.filterClientOptions(""));
      filterController.scheduleClientDropdownLoad("", true);
      input.focus();
      return;
    }
    filterController.clearClientSelection();
  });

  el("btnToggleFilters")?.addEventListener("click", () => {
    setFiltersCollapsed(!getFiltersCollapsed());
  });

  const productInput = el("iProd");
  productInput?.addEventListener("focus", () => {
    setKeepProductDropdownOpen(true);
    filterController.renderProductDropdown(filterController.filterProductOptions(productInput.value));
    filterController.scheduleProductDropdownLoad(productInput.value, true);
  });
  productInput?.addEventListener("input", () => {
    setKeepProductDropdownOpen(true);
    const clearButton = el("btnProdClr");
    if (clearButton) clearButton.hidden = !productInput.value && !filterController.hasProductFilter();
    filterController.renderProductDropdown(filterController.filterProductOptions(productInput.value));
    filterController.scheduleProductDropdownLoad(productInput.value);
  });
  productInput?.addEventListener("keydown", event => {
    if (event.key === "Escape") setKeepProductDropdownOpen(false);
    productCombobox?.handleKeydown(event);
  });
  el("btnProdClr")?.addEventListener("click", () => {
    const input = el("iProd");
    if (input?.value) {
      input.value = "";
      setKeepProductDropdownOpen(true);
      filterController.renderProductDropdown(filterController.filterProductOptions(""));
      filterController.scheduleProductDropdownLoad("", true);
      input.focus();
      return;
    }
    filterController.clearProductSelection();
  });

  ["pHabiles", "pTranscurridos"].forEach(id => {
    const input = el(id);
    input?.addEventListener("input", event => {
      const current = getProjectionConfig();
      setProjectionConfig({
        ...current,
        [id === "pHabiles" ? "habiles" : "transcurridos"]: event.target.value
      });
      scheduleProjectionRefresh(180);
    });
    input?.addEventListener("change", () => {
      scheduleProjectionRefresh(0);
    });
    input?.addEventListener("blur", () => {
      scheduleProjectionRefresh(0);
    });
  });

  el("btnProjReset")?.addEventListener("click", () => {
    if (projectionInputTimer) {
      clearTimeout(projectionInputTimer);
      projectionInputTimer = 0;
    }
    setProjectionConfig({ habiles: "", transcurridos: "" });
    persistProjectionConfig();
    renderProjectionPage();
  });

  documentRef.addEventListener("click", event => {
    const productWrap = el("productSearchWrap");
    if (productWrap && !productWrap.contains(event.target)) {
      setKeepProductDropdownOpen(false);
      filterController.closeSearchDropdown("productDropdown");
    }

    const clientWrap = el("clientSearchWrap");
    if (clientWrap && !clientWrap.contains(event.target)) {
      filterController.closeSearchDropdown("clientDropdown");
    }
  });

  el("pills")?.addEventListener("click", event => {
    const target = event.target.closest(".ax");
    const key = target?.dataset.k;
    if (!key) return;

    if (key === "fecha") {
      filterController.setPeriodo?.({ desde: "", hasta: "" });
      const fromInput = el("fDesde");
      const untilInput = el("fHasta");
      if (fromInput) fromInput.value = "";
      if (untilInput) untilInput.value = "";
      documentRef.querySelectorAll(".pbtn").forEach(node => node.classList.remove("on"));
      scheduleStateLoad();
      return;
    }

    if (key === "codProd") {
      filterController.removeProductSelection(target.dataset.v || "");
      return;
    }

    const filtros = filterController.getFiltros?.() || {};
    const order = ["coordinador", "agente", "cliente", "grupo", "marca"];
    order.slice(order.indexOf(key)).forEach(name => {
      filtros[name] = "";
    });
    filtros.codProd = [];
    filterController.clearProductInputSilent();
    scheduleStateLoad();
  });

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(syncTabsTop);
    const header = documentRef.querySelector(".hdr");
    const panel = el("filterPanel");
    if (header) observer.observe(header);
    if (panel) observer.observe(panel);
  }
  syncTabsTop();

  return {
    tabsController,
    clientCombobox,
    productCombobox,
    isProductDropdownPinnedOpen() {
      return getKeepProductDropdownOpen();
    }
  };
}
