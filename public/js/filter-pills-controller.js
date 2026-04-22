export function createFilterPillsController({
  constants,
  helpers,
  stores,
  callbacks,
  getSelectedProducts,
  hasProductFilter,
  getSelectedClientLabel,
  getProductLabel
} = {}) {
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

  function setFiltersCollapsedState(next) {
    stores.setFiltersCollapsed(next);
  }

  function getFiltersCollapsedState() {
    return stores.getFiltersCollapsed();
  }

  function countBusinessFilters() {
    const filtros = getFiltros();
    return ["coordinador", "agente", "cliente", "grupo", "marca"].filter(key => !!filtros[key]).length + (hasProductFilter() ? 1 : 0);
  }

  function shouldShowSummaryTable() {
    const periodo = getPeriodo();
    return countBusinessFilters() > 0 || Boolean(periodo?.desde || periodo?.hasta);
  }

  function setFiltersCollapsed(collapsed, persist = true) {
    const next = !!collapsed;
    setFiltersCollapsedState(next);
    const panel = helpers.el("filterPanel");
    const btn = helpers.el("btnToggleFilters");
    const note = helpers.el("fpCollapsedNote");
    const periodo = getPeriodo();
    const filtros = getFiltros();

    if (panel) panel.classList.toggle("collapsed", next);
    if (btn) {
      btn.textContent = next ? "☰ Mostrar filtros" : "☰ Ocultar filtros";
      btn.setAttribute("aria-expanded", String(!next));
    }
    if (note) {
      const items = [];
      const count = countBusinessFilters();
      if (periodo.desde || periodo.hasta) {
        items.push(`📅 ${periodo.desde || "inicio"} → ${periodo.hasta || "hoy"}`);
      }
      items.push(`${count} filtro${count === 1 ? "" : "s"} activo${count === 1 ? "" : "s"}`);

      const summaries = [];
      if (filtros.coordinador) summaries.push(`Coord. ${filtros.coordinador}`);
      if (filtros.agente) summaries.push(`Agente ${filtros.agente}`);
      if (filtros.cliente) summaries.push(`Cliente ${getSelectedClientLabel() || filtros.cliente}`);
      if (filtros.grupo) summaries.push(`Grupo ${filtros.grupo}`);
      if (filtros.marca) summaries.push(`Marca ${filtros.marca}`);
      if (hasProductFilter()) {
        const selectedProducts = getSelectedProducts();
        summaries.push(selectedProducts.length === 1
          ? `Producto ${getProductLabel(selectedProducts[0])}`
          : `${selectedProducts.length} productos`);
      }

      note.innerHTML = [...items, ...summaries.slice(0, 2)].map(item => `<span class="fp-note-pill">${helpers.escHtml(item)}</span>`).join("");
    }
    if (persist) {
      try {
        localStorage.setItem(constants.filtersPrefKey, next ? "1" : "0");
      } catch (_) {}
    }
    callbacks.syncTabsTop?.();
  }

  function applyPeriod(preset) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const periodo = { ...getPeriodo() };

    if (preset === "todo") {
      periodo.desde = "";
      periodo.hasta = "";
    } else if (preset === "mes") {
      periodo.desde = helpers.toISO(new Date(year, month, 1));
      periodo.hasta = helpers.toISO(new Date(year, month + 1, 0));
    } else {
      const days = parseInt(preset, 10);
      const from = new Date(year, month, today.getDate() - days + 1);
      periodo.desde = helpers.toISO(from);
      periodo.hasta = helpers.toISO(today);
    }

    setPeriodo(periodo);
    const fromInput = helpers.el("fDesde");
    const untilInput = helpers.el("fHasta");
    if (fromInput) fromInput.value = periodo.desde;
    if (untilInput) untilInput.value = periodo.hasta;
  }

  function updatePills() {
    const labels = {
      coordinador: "Coordinador",
      agente: "Agente",
      cliente: "Cliente",
      grupo: "Grupo",
      marca: "Marca"
    };
    const container = helpers.el("pills");
    const periodo = getPeriodo();
    const filtros = getFiltros();
    if (!container) return;
    container.innerHTML = "";

    if (periodo.desde || periodo.hasta) {
      const pill = document.createElement("div");
      pill.className = "ap dp";
      pill.innerHTML = `<span>📅 ${periodo.desde || "inicio"} → ${periodo.hasta || "hoy"}</span><span class="ax" data-k="fecha" role="button" tabindex="0" aria-label="Eliminar filtro de fecha">✕</span>`;
      container.appendChild(pill);
    }

    Object.entries(filtros).forEach(([key, value]) => {
      if (key === "codProd" || !value) return;
      let display = value;
      if (key === "cliente") {
        display = getSelectedClientLabel() || value;
      } else {
        const selectMap = { agente: "sAgte" };
        if (selectMap[key]) {
          const option = document.querySelector(`#${selectMap[key]} option[value="${CSS.escape(value)}"]`);
          if (option) display = option.textContent;
        }
      }
      const pill = document.createElement("div");
      pill.className = "ap";
      pill.innerHTML = `<span>${labels[key]}: <strong>${helpers.escHtml(display)}</strong></span><span class="ax" data-k="${key}" role="button" tabindex="0" aria-label="Eliminar filtro ${helpers.escHtml(String(labels[key] || key))}">✕</span>`;
      container.appendChild(pill);
    });

    for (const code of getSelectedProducts()) {
      const display = getProductLabel(code);
      const pill = document.createElement("div");
      pill.className = "ap";
      pill.innerHTML = `<span>Cód.Prod: <strong>${helpers.escHtml(display)}</strong></span><span class="ax" data-k="codProd" data-v="${helpers.escHtml(code)}" role="button" tabindex="0" aria-label="Eliminar filtro producto ${helpers.escHtml(display)}">✕</span>`;
      container.appendChild(pill);
    }
  }

  return {
    getPeriodo,
    setPeriodo,
    getFiltros,
    countBusinessFilters,
    shouldShowSummaryTable,
    setFiltersCollapsed,
    getFiltersCollapsedState,
    applyPeriod,
    updatePills
  };
}
