export function createClientSearchController({
  constants,
  helpers,
  stores,
  ui,
  callbacks,
  catalogStore,
  closeSearchDropdown,
  setHiddenSelectOptions,
  clearProductInputSilent
} = {}) {
  let clientOptionsSource = null;
  let clientOptionsCache = [];
  const clientLabelMap = new Map();

  function getFiltros() {
    return stores.getFiltros();
  }

  function getDashboardState() {
    return stores.getDashboardState();
  }

  function getCatalogState() {
    return stores.getCatalogState();
  }

  function invalidateClientOptionCache() {
    clientOptionsSource = null;
    clientOptionsCache = [];
  }

  function clearLabelCache() {
    clientLabelMap.clear();
  }

  function getClientOptions() {
    const items = getCatalogState().clientes?.items || getDashboardState().options?.clientes || [];
    if (clientOptionsSource === items) return clientOptionsCache;
    clientOptionsSource = items;
    clientOptionsCache = items.map(item => ({
      codigo: String(item.codigo),
      nombre: String(item.nombre || item.codigo),
      label: `${item.nombre || item.codigo} — Nro: ${item.codigo}`,
      codeSearch: String(item.codigo || "").toLowerCase().trim(),
      nameSearch: helpers.normText(item.nombre || item.codigo)
    }));
    return clientOptionsCache;
  }

  function filterClientOptions(term = "") {
    const all = getClientOptions();
    const qNorm = helpers.normText(term);
    const qCode = String(term || "").trim().toLowerCase();
    const matched = all.filter(item => {
      if (!qNorm && !qCode) return true;
      return item.codeSearch.startsWith(qCode) || item.nameSearch.includes(qNorm);
    });
    matched.sort((a, b) => helpers.localeEs(a.nombre, b.nombre) || helpers.localeEs(a.codigo, b.codigo));
    const items = matched.slice(0, constants.searchDropdownLimit);
    return { items, totalMatched: matched.length, totalAvailable: all.length };
  }

  function getSelectedClientLabel() {
    const filtros = getFiltros();
    return filtros.cliente ? (clientLabelMap.get(filtros.cliente) || filtros.cliente) : "";
  }

  function clearClientSelectionState({ clearDependents = false } = {}) {
    const filtros = getFiltros();
    const hadSelection = Boolean(filtros.cliente);
    filtros.cliente = "";
    if (clearDependents) {
      filtros.grupo = "";
      filtros.marca = "";
      filtros.codProd = [];
      clearProductInputSilent();
    }
    return hadSelection;
  }

  function syncClientSearchUI() {
    const options = getClientOptions();
    const meta = helpers.el("clieMeta");
    const input = helpers.el("iClie");
    const btn = helpers.el("btnClieClr");
    const dashboardState = getDashboardState();
    const catalogState = getCatalogState();
    const filtros = getFiltros();

    for (const item of options) clientLabelMap.set(item.codigo, item.label);
    if (meta) {
      const totalHint = dashboardState.optionsMeta?.clientes?.total;
      const loadedLabel = catalogState.clientes.loaded ? helpers.fmt(options.length) : "0";
      meta.textContent = filtros.cliente
        ? `${getSelectedClientLabel()}`
        : `${loadedLabel} cargados${Number.isFinite(Number(totalHint)) ? ` · ${helpers.fmt(totalHint)} totales` : ""}`;
    }
    if (btn) btn.hidden = !(input?.value || filtros.cliente);
    setHiddenSelectOptions("sClie", options, "Todos los clientes", filtros.cliente ? [filtros.cliente] : []);
    if (input) input.title = filtros.cliente ? getSelectedClientLabel() : "";
    if (input && filtros.cliente && document.activeElement !== input) {
      input.value = getSelectedClientLabel();
    }
  }

  function renderClientDropdown(result) {
    const dropdown = helpers.el("clientDropdown");
    if (!dropdown) return;
    const { items = [], totalMatched = 0, totalAvailable = 0 } = result || {};
    const loading = Boolean(getCatalogState().clientes.loading);
    const truncated = totalMatched > items.length;
    if (!items.length) {
      dropdown.innerHTML = `<div class="search-dd-empty">${loading ? "Buscando clientes..." : "No se encontraron clientes"}</div>`;
      dropdown.classList.add("open");
      ui.getClientCombobox()?.open();
      return;
    }
    dropdown.innerHTML = `
      <div class="search-dd-head">${helpers.fmt(totalMatched)} de ${helpers.fmt(totalAvailable)} clientes${loading ? " · buscando..." : ""}</div>
      ${items.map(item => `
        <button type="button" class="search-dd-item" data-role="client-option" data-codigo="${helpers.escHtml(item.codigo)}" data-nombre="${helpers.escHtml(item.nombre)}">
          <span class="search-dd-main">${helpers.escHtml(item.nombre)}</span>
          <span class="search-dd-side">Nro: ${helpers.escHtml(item.codigo)}</span>
        </button>
      `).join("")}
      ${truncated ? `<div class="search-dd-empty">Escribí más para acotar resultados</div>` : ""}
    `;
    dropdown.classList.add("open");
    ui.getClientCombobox()?.open();
  }

  function setClientSelection(codigo, nombre, silent = false) {
    const filtros = getFiltros();
    const code = String(codigo || "").trim();
    filtros.cliente = code;
    filtros.grupo = "";
    filtros.marca = "";
    filtros.codProd = [];
    clearProductInputSilent();
    if (code && nombre) {
      clientLabelMap.set(code, `${nombre} — Nro: ${code}`);
      catalogStore.mergeCatalogItems("clientes", [{ codigo: code, nombre }]);
    }
    const input = helpers.el("iClie");
    if (input) input.value = code ? (clientLabelMap.get(code) || `${nombre || code} — Nro: ${code}`) : "";
    closeSearchDropdown("clientDropdown");
    syncClientSearchUI();
    if (!silent) callbacks.scheduleStateLoad();
  }

  function clearClientSelection(silent = false) {
    clearClientSelectionState();
    const input = helpers.el("iClie");
    if (input) input.value = "";
    closeSearchDropdown("clientDropdown");
    syncClientSearchUI();
    if (!silent) callbacks.scheduleStateLoad();
  }

  function getLabel(code) {
    return clientLabelMap.get(code) || code;
  }

  return {
    invalidateClientOptionCache,
    clearLabelCache,
    filterClientOptions,
    getSelectedClientLabel,
    clearClientSelectionState,
    syncClientSearchUI,
    renderClientDropdown,
    setClientSelection,
    clearClientSelection,
    getLabel
  };
}
