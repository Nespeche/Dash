export function createProjectionView(deps = {}) {
  const {
    el,
    setText,
    fmt,
    fmtK,
    fmtSigned,
    fmtSignedPct,
    escHtml,
    toNum,
    parseIsoDateParts,
    monthNameEs,
    PAL = [],
    formatProjectionDateLabel,
    projectRankEntries,
    projectValue,
    projectionDetailedRowHtml,
    projectionSummaryRowHtml,
    projectionTableColspan,
    projectionTableHeaders,
    projectionTotalRowHtml,
    getProjectionMeta,
    getProjectionConfig,
    getProjectionCompareContext,
    getProjectionCurrentKpis,
    getProjectionSelectedGroups,
    hasProjectionGroupSelection,
    getProjectionComparison,
    shouldShowProjectionSummaryTable,
    renderAgentKpiValue,
    projectionController,
    onToggleGroup,
    onLoadMoreDetail,
    onLoadAllDetail,
    pageSize
  } = deps;

  function syncInputs() {
    const projectionConfig = getProjectionConfig?.() || {};
    const inHabiles = el?.("pHabiles");
    const inTrans = el?.("pTranscurridos");
    if (inHabiles && document.activeElement !== inHabiles) inHabiles.value = projectionConfig.habiles || "";
    if (inTrans && document.activeElement !== inTrans) inTrans.value = projectionConfig.transcurridos || "";
  }

  function isTableExpanded() {
    const detailState = projectionController?.getDetailState?.();
    return (detailState?.viewMode || "") === "detail" || hasProjectionGroupSelection?.();
  }

  function setTableHead(expanded = isTableExpanded()) {
    const head = el?.("pthead");
    if (!head) return;
    head.innerHTML = `<tr>${projectionTableHeaders(expanded).map((label, idx) => `<th${idx >= (expanded ? 5 : 2) ? ' class="r"' : ""}>${label}</th>`).join("")}</tr>`;
  }

  function setTrendCardState(id, trend = "neutral") {
    const card = el?.(id);
    if (!card) return;
    card.classList.remove("positive", "negative", "neutral");
    card.classList.add(trend || "neutral");
  }

  function renderCompareKpis(meta = getProjectionMeta?.()) {
    const projectionCompareState = projectionController?.getCompareState?.() || {};
    const context = getProjectionCompareContext?.() || {};
    const comparison = getProjectionComparison?.(meta) || {};
    const latestDate = projectionCompareState.latestDate || "";
    const latestLabel = latestDate ? formatProjectionDateLabel(latestDate, { parseIsoDateParts, monthNameEs }) : "Última fecha con ventas";
    const compareLabel = projectionCompareState.compareLabel || context.compareLabel || "";
    const currentLabel = projectionCompareState.currentLabel || context.currentLabel || "—";
    const compareMode = projectionCompareState.compareMode || context.mode || "month";
    const baseTitle = compareLabel
      ? `${compareMode === "range" ? "Acumulado" : "Cierre"} ${compareLabel}`
      : (compareMode === "range" ? "Acumulado 2025" : "Cierre mes 2025");
    const baseSubReady = compareLabel
      ? `${compareMode === "range" ? "Total acumulado" : "Mes cerrado"} ${compareLabel}`
      : (compareMode === "range" ? "Total acumulado 2025" : "Mes cerrado 2025");
    const baseSubLoading = compareMode === "range" ? "Buscando acumulado 2025" : "Buscando cierre 2025";

    setText?.("pcBaseLbl", baseTitle);
    setText?.("pcMonth", currentLabel);
    setText?.("pcMonthSub", compareLabel ? `Comparando contra ${compareLabel}` : "Referencia histórica");
    setText?.("pcCompareBadge", compareLabel ? `Contra ${compareLabel}` : "Sin base 2025");
    setText?.("pcDeltaKgSub", compareLabel ? `vs ${compareLabel}` : "vs 2025");
    setText?.("pcDeltaPctSub", compareLabel ? `vs ${compareLabel}` : "vs 2025");
    setText?.("pcLatestLbl", latestLabel);
    setText?.("pkKSub", meta?.ok ? `Total proyectado para ${currentLabel || "el período"}` : "Total proyectado del período");

    const currentKpis = getProjectionCurrentKpis?.() || {};
    if (meta?.ok && projectionCompareState.loading && hasProjectionGroupSelection?.() && !projectionCompareState.loaded) {
      setText?.("pkK", "...");
    } else if (meta?.ok) {
      setText?.("pkK", fmt(projectValue(currentKpis.kilos || 0, meta)));
    } else {
      setText?.("pkK", "—");
    }

    if (projectionCompareState.loading && !projectionCompareState.loaded) {
      setText?.("pcBase", "...");
      setText?.("pcBaseSub", baseSubLoading);
      setText?.("pcLatest", "...");
      setText?.("pcLatestSub", "Buscando último día disponible");
    } else if (projectionCompareState.available) {
      setText?.("pcBase", fmt(projectionCompareState.kilos));
      setText?.("pcBaseSub", baseSubReady);
      setText?.("pcLatest", latestDate ? fmt(projectionCompareState.latestKilos) : "—");
      setText?.("pcLatestSub", latestDate ? "Kilos vendidos en la última fecha disponible" : "Sin ventas en el período filtrado");
    } else {
      setText?.("pcBase", "—");
      setText?.("pcBaseSub", projectionCompareState.message || context.message || "Sin base histórica");
      setText?.("pcLatest", latestDate ? fmt(projectionCompareState.latestKilos) : "—");
      setText?.("pcLatestSub", latestDate ? "Kilos vendidos en la última fecha disponible" : "Sin ventas en el período filtrado");
    }

    if (comparison.ready) {
      setText?.("pcDeltaKg", fmtSigned(comparison.deltaKg));
      setText?.("pcDeltaPct", comparison.deltaPctLabel);
      setTrendCardState("pcDeltaKgCard", comparison.trend);
      setTrendCardState("pcDeltaPctCard", comparison.trend);
      return;
    }

    setText?.("pcDeltaKg", "—");
    setText?.("pcDeltaPct", "—");
    setTrendCardState("pcDeltaKgCard", "neutral");
    setTrendCardState("pcDeltaPctCard", "neutral");
  }

  function renderSummary(meta = getProjectionMeta?.()) {
    const projectionCompareState = projectionController?.getCompareState?.() || {};
    const note = el?.("projNote");
    const badge = el?.("projBadge");
    const currentKpis = getProjectionCurrentKpis?.() || {};
    const baseKilos = Number(currentKpis?.kilos || 0);
    const comparison = getProjectionComparison?.(meta) || {};
    const latestDate = projectionCompareState.latestDate ? formatProjectionDateLabel(projectionCompareState.latestDate, { parseIsoDateParts, monthNameEs }) : "sin ventas cargadas";
    const latestKilos = projectionCompareState.latestDate ? fmt(projectionCompareState.latestKilos) : "0";
    const context = getProjectionCompareContext?.() || {};
    const compareLabel = projectionCompareState.compareLabel || context.compareLabel || "";
    const compareMode = projectionCompareState.compareMode || context.mode || "month";
    const compareFallback = compareMode === "range" ? "el acumulado 2025" : "2025";

    if (badge) badge.textContent = meta?.ok ? `${meta.transcurridos}/${meta.habiles} días · ${meta.porcentaje.toFixed(1)}%` : "Pendiente";
    if (!note) return;

    if (!meta?.ok) {
      note.className = "proj-note err";
      note.textContent = meta?.message || "Proyección pendiente.";
      return;
    }

    if (comparison.ready) {
      note.className = `proj-note ${comparison.trend === "positive" ? "pos" : comparison.trend === "negative" ? "neg" : "neutral"}`;
      note.innerHTML = `${comparison.currentLabel}: <strong>${fmt(comparison.projectedKilos)}</strong> proyectados · ${comparison.compareLabel}: <strong>${fmt(comparison.baseKilos)}</strong> · Variación: <strong>${fmtSigned(comparison.deltaKg)}</strong> (<strong>${comparison.deltaPctLabel}</strong>) · Última venta cargada: <strong>${latestDate}</strong> con <strong>${latestKilos}</strong> kilos`;
      return;
    }

    if (projectionCompareState.loading && !projectionCompareState.loaded) {
      note.className = "proj-note info";
      note.innerHTML = `Coeficiente: <strong>${meta.coef.toFixed(3)}</strong> · Multiplicador: <strong>${meta.multiplier.toFixed(3)}</strong> · Kilos actuales: <strong>${fmt(baseKilos)}</strong> · Kilos proyectados: <strong>${fmt(projectValue(baseKilos, meta))}</strong> · Comparando con <strong>${compareLabel || compareFallback}</strong>...`;
      return;
    }

    note.className = "proj-note ok";
    note.innerHTML = `Coeficiente: <strong>${meta.coef.toFixed(3)}</strong> · Multiplicador: <strong>${meta.multiplier.toFixed(3)}</strong> · Kilos actuales: <strong>${fmt(baseKilos)}</strong> · Kilos proyectados: <strong>${fmt(projectValue(baseKilos, meta))}</strong> · Última venta cargada: <strong>${latestDate}</strong> con <strong>${latestKilos}</strong> kilos${projectionCompareState.message ? ` · ${escHtml(projectionCompareState.message)}` : ""}`;
  }

  function renderKpiBlock(meta = getProjectionMeta?.()) {
    const projectionCompareState = projectionController?.getCompareState?.() || {};
    const sourceKpis = getProjectionCurrentKpis?.() || {};
    if (projectionCompareState.loading && hasProjectionGroupSelection?.() && !projectionCompareState.loaded) {
      setText?.("pkC", "...");
      setText?.("pkA", "...");
      setText?.("pkR", "...");
      return;
    }

    setText?.("pkC", fmt(sourceKpis.clientes));
    renderAgentKpiValue?.("pkA", sourceKpis);
    setText?.("pkR", fmt(sourceKpis.registros));
  }

  function renderGroupHint() {
    const hint = el?.("pGroupHint");
    if (!hint) return;
    const selected = getProjectionSelectedGroups?.() || [];
    if (!selected.length) {
      hint.textContent = "Hacé click en uno o más grupos para filtrar el comparativo y abrir el detalle completo. Volvé a hacer click para regresar al resumen por cliente.";
      return;
    }
    hint.textContent = `Filtro activo en comparativo y detalle para: ${selected.join(", ")}. Hacé click nuevamente sobre un grupo para ocultarlo.`;
  }

  function renderStrip(meta = getProjectionMeta?.()) {
    const cont = el?.("pGrupoStrip");
    if (!cont) return;
    renderGroupHint();

    if (!meta?.ok) {
      cont.innerHTML = `<div class="gk"><div class="gk-name" style="color:var(--mut)">Proyección pendiente</div><div class="gk-val">—</div></div>`;
      return;
    }

    const rankings = deps.getDashboardState?.()?.rankings?.grupos || [];
    const entries = projectRankEntries(rankings, meta);
    const total = (entries || []).reduce((acc, item) => acc + Number(item.kilos || 0), 0) || 1;
    const maxK = Number(entries?.[0]?.kilos || 0) || 1;
    const selected = new Set(getProjectionSelectedGroups?.() || []);

    if (!entries.length) {
      cont.innerHTML = `<div class="gk"><div class="gk-name" style="color:var(--mut)">Sin datos</div><div class="gk-val">—</div></div>`;
      return;
    }

    cont.innerHTML = entries.map((item, i) => {
      const col = PAL[i % PAL.length];
      const kg = Number(item.kilos || 0);
      const pct = ((kg / total) * 100).toFixed(1);
      const bw = ((kg / maxK) * 100).toFixed(1);
      const active = selected.has(String(item.name || ""));
      return `<button type="button" class="gk clickable${active ? ' active' : ''}" data-proj-group="${escHtml(item.name)}" aria-pressed="${active ? 'true' : 'false'}" title="${active ? 'Ocultar detalle de ' : 'Mostrar detalle de '}${escHtml(item.name)}" style="border-color:${active ? `${col}88` : `${col}22`};background:${active ? `${col}14` : `${col}08`}">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${col}"></div>
        <div class="gk-name" style="color:${col}aa">${escHtml(item.name)}</div>
        <div class="gk-val" style="color:${col}">${fmtK(kg)}</div>
        <div class="gk-pct" style="color:${col}88">${pct}%</div>
        <div class="gk-bar" style="width:${bw}%;background:${col}"></div>
      </button>`;
    }).join("");

    cont.querySelectorAll("[data-proj-group]").forEach(node => {
      node.addEventListener("click", () => onToggleGroup?.(node.getAttribute("data-proj-group")));
    });
  }

  function renderTable(meta = getProjectionMeta?.()) {
    const projectionDetailState = projectionController?.getDetailState?.() || {};
    const body = el?.("ptbody");
    if (!body) return;
    const title = el?.("pdetailTitle");
    const expanded = isTableExpanded();
    const colspan = projectionTableColspan(expanded);
    const totalKnown = projectionDetailState.totalKnown !== false;
    const totalLabel = projectionDetailState.total || projectionDetailState.summary?.totalRows || 0;
    const selectedGroups = getProjectionSelectedGroups?.() || [];

    setTableHead(expanded);
    setText?.("ptbadge", !meta?.ok || !shouldShowProjectionSummaryTable?.()
      ? "Proyección"
      : expanded
        ? `${fmt(totalLabel)}${totalKnown ? '' : '+'} filas detalladas`
        : `${fmt(totalLabel)}${totalKnown ? '' : '+'} clientes resumidos`);

    if (title) {
      title.textContent = expanded
        ? `Detalle proyectado · ${selectedGroups.join(", ")}`
        : "Detalle proyectado · Resumen por cliente";
    }

    const subtitle = el?.("psubtitle");
    if (subtitle) {
      subtitle.textContent = expanded
        ? (totalKnown
          ? `Vista inicial optimizada para ${fmt(totalLabel)} filas potenciales. Usá “Ver más” si necesitás expandir el detalle completo.`
          : "Vista inicial optimizada. El total completo se sigue cargando mientras navegás por el detalle.")
        : "Resumen por cliente según los filtros activos.";
    }

    if (!meta?.ok) {
      body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">🧮</div><p>${escHtml(meta?.message || "Proyección pendiente")}</p></div></td></tr>`;
      const note = el?.("psnote");
      if (note) note.style.display = "none";
      return;
    }

    if (!shouldShowProjectionSummaryTable?.()) {
      body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">🎯</div><p>Aplicá al menos un filtro de negocio o seleccioná uno o más grupos proyectados para ver el detalle.</p></div></td></tr>`;
      const note = el?.("psnote");
      if (note) note.style.display = "none";
      return;
    }

    if ((!projectionDetailState.loaded && !projectionDetailState.rows?.length) || (projectionDetailState.loading && !projectionDetailState.loaded)) {
      body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">⏳</div><p>${expanded ? 'Cargando detalle proyectado filtrado...' : 'Cargando resumen por cliente...'}</p></div></td></tr>`;
      const note = el?.("psnote");
      if (note) note.style.display = "none";
      return;
    }

    if (!projectionDetailState.rows?.length) {
      body.innerHTML = `<tr><td colspan="${colspan}"><div class="empty"><div class="eico">🔍</div><p>${escHtml(projectionDetailState.message || "Sin resultados para los filtros actuales")}</p></div></td></tr>`;
      const note = el?.("psnote");
      if (note) note.style.display = "none";
      return;
    }

    const rowRenderer = expanded
      ? row => projectionDetailedRowHtml(row, meta, { toNum, escHtml, fmt, fmtSigned, fmtSignedPct })
      : row => projectionSummaryRowHtml(row, meta, { toNum, escHtml, fmt, fmtSigned, fmtSignedPct });

    body.innerHTML = projectionDetailState.rows.map(rowRenderer).join("")
      + projectionTotalRowHtml(projectionDetailState?.summary || {}, meta, expanded, { toNum, fmt, fmtSigned, fmtSignedPct });

    renderPaginator(meta);
  }

  function renderPaginator(meta = getProjectionMeta?.()) {
    const projectionDetailState = projectionController?.getDetailState?.() || {};
    const note = el?.("psnote");
    if (!note) return;

    if (!meta?.ok || !shouldShowProjectionSummaryTable?.()) {
      note.style.display = "none";
      return;
    }

    const totalKnown = projectionDetailState.totalKnown !== false;
    const rem = totalKnown ? (projectionDetailState.total - projectionDetailState.rows.length) : null;
    if (!projectionDetailState.hasMore && (!totalKnown || rem <= 0)) {
      note.style.display = "none";
      return;
    }

    const expanded = isTableExpanded();
    const noun = expanded ? "filas detalladas" : "clientes resumidos";
    const currentPageSize = typeof pageSize === "function" ? pageSize() : 0;
    note.style.display = "flex";
    note.innerHTML = `
      <span style="color:var(--mut)">${totalKnown
        ? `Mostrando <strong>${fmt(projectionDetailState.rows.length)}</strong> de <strong>${fmt(projectionDetailState.total)}</strong> ${noun}`
        : `Mostrando <strong>${fmt(projectionDetailState.rows.length)}</strong> ${noun}. Hay más resultados disponibles.`}</span>
      <button id="pbtnMore" style="background:var(--card);border:1px solid var(--brd);border-radius:7px;color:var(--acc);font-size:11px;font-family:'DM Sans',sans-serif;padding:5px 14px;cursor:pointer;margin:0 4px" ${projectionDetailState.loading ? "disabled" : ""}>
        ${projectionDetailState.loading ? "Cargando..." : `+ Ver ${fmt(totalKnown ? Math.min(currentPageSize, Math.max(rem || 0, 0)) : currentPageSize)} más`}
      </button>
      <button id="pbtnAll" style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:7px;color:var(--acc);font-size:11px;font-family:'DM Sans',sans-serif;padding:5px 14px;cursor:pointer" ${projectionDetailState.loading ? "disabled" : ""}>
        ${projectionDetailState.loading ? "Cargando..." : (totalKnown ? `Ver todos (${fmt(projectionDetailState.total)})` : "Ver todo el resto")}
      </button>`;

    el?.("pbtnMore")?.addEventListener("click", async () => {
      await onLoadMoreDetail?.(currentPageSize);
    });
    el?.("pbtnAll")?.addEventListener("click", async () => {
      await onLoadAllDetail?.();
    });
  }

  function renderPage(meta = getProjectionMeta?.()) {
    syncInputs();
    renderCompareKpis(meta);
    renderSummary(meta);
    renderKpiBlock(meta);
    renderStrip(meta);
    renderTable(meta);
  }

  return {
    syncInputs,
    renderPage,
    renderCompareKpis,
    renderSummary,
    renderKpiBlock,
    renderStrip,
    renderTable,
    renderPaginator,
    setTableHead,
    isTableExpanded
  };
}
