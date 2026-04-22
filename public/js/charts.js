/* charts.js — v24 PRO visual upgrade
   - Gradient horizontal bars
   - Donut with center label
   - Smooth bezier line charts
   - Enhanced daily compare with area fills
*/

function formatSharePct(value) {
  const pct = Number(value || 0);
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  return `${pct.toFixed(1)}%`;
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function installDailyTouchTooltip(host) {
  const shell = host?.querySelector?.('.daily-compare-shell');
  const svg = shell?.querySelector?.('.daily-compare-svg');
  const hits = svg ? [...svg.querySelectorAll('.daily-dot-hit')] : [];
  if (!shell || !svg || !hits.length) return;
  const prefersTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none), (pointer: coarse)')?.matches;
  if (!prefersTouch) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'daily-touch-tooltip';
  tooltip.hidden = true;
  shell.appendChild(tooltip);

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const showTooltip = (target) => {
    if (!(target instanceof SVGElement)) return;
    const label = target.getAttribute('data-tooltip') || '';
    const cx = Number(target.getAttribute('cx') || 0);
    const cy = Number(target.getAttribute('cy') || 0);
    const viewBox = svg.viewBox?.baseVal;
    const svgRect = svg.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const scaleX = viewBox?.width ? svgRect.width / viewBox.width : 1;
    const scaleY = viewBox?.height ? svgRect.height / viewBox.height : 1;

    tooltip.textContent = label;
    tooltip.hidden = false;
    shell.classList.add('has-active-tooltip');
    hits.forEach(hit => hit.classList.toggle('is-active', hit === target));

    const left = (svgRect.left - shellRect.left) + (cx * scaleX);
    const top = (svgRect.top - shellRect.top) + (cy * scaleY);
    const tooltipWidth = Math.min(tooltip.offsetWidth || 180, Math.max(120, shellRect.width - 20));
    const x = clamp(left - (tooltipWidth / 2), 10, Math.max(10, shellRect.width - tooltipWidth - 10));
    const y = Math.max(10, top - 44);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.style.maxWidth = `${Math.max(140, shellRect.width - 20)}px`;
  };

  const hideTooltip = () => {
    tooltip.hidden = true;
    shell.classList.remove('has-active-tooltip');
    hits.forEach(hit => hit.classList.remove('is-active'));
  };

  hits.forEach(hit => {
    hit.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      showTooltip(hit);
    }, { passive: false });
    hit.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      showTooltip(hit);
    });
  });

  shell.addEventListener('pointerdown', event => {
    const target = event.target;
    if (target instanceof Element && target.closest('.daily-dot-hit')) return;
    hideTooltip();
  });

  window.addEventListener('resize', hideTooltip, { passive: true });
  window.addEventListener('orientationchange', hideTooltip, { passive: true });
}

export function renderHBars(id, entries, colorOffset = 0, deps = {}, options = {}) {
  const { el, escHtml, fmtK, palette = [] } = deps;
  const {
    showShare = false,
    shareTotal = null
  } = options || {};
  const host = el?.(id);
  if (!host) return;
  if (!entries.length) {
    host.innerHTML = '<div class="chart-empty">Sin datos</div>';
    return;
  }
  const max = Number(entries[0].kilos || 0) || 1;
  const total = Number(shareTotal);
  const safeTotal = Number.isFinite(total) && total > 0
    ? total
    : (entries || []).reduce((acc, item) => acc + Number(item?.kilos || 0), 0);
  host.innerHTML = entries.slice(0, 10).map((item, i) => {
    const col = palette[(i + colorOffset) % palette.length] || 'var(--acc)';
    const kilos = Number(item.kilos || 0);
    const w = max > 0 && kilos > 0 ? Math.max((kilos / max * 100), 2) : 0;
    const name = item.name || item.nombre || item.codigo || '';
    const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    const sharePct = safeTotal > 0 ? (kilos / safeTotal) * 100 : 0;
    const shareHtml = showShare
      ? `<div class="hb-share" title="Participación sobre el total filtrado">${formatSharePct(sharePct)}</div>`
      : '';
    return `<div class="hb-row">
      <div class="hb-name" title="${escHtml(name)}">${rankIcon ? `<span style="margin-right:3px">${rankIcon}</span>` : ''}<span>${escHtml(name)}</span></div>
      <div class="hb-track">
        <div class="hb-fill" style="width:${w.toFixed(1)}%;background:linear-gradient(90deg,${col}aa,${col})"></div>
      </div>
      <div class="hb-metrics">
        <div class="hb-val" style="color:${col}">${fmtK(kilos)}</div>
        ${shareHtml}
      </div>
    </div>`;
  }).join('');
}

export function renderDonut(entries, deps = {}) {
  const { el, escHtml, fmtK, palette = [] } = deps;
  const host = el?.('gDonut');
  if (!host) return;
  if (!entries.length) {
    host.innerHTML = '<div class="chart-empty">Sin datos</div>';
    return;
  }
  const top = entries.slice(0, 7);
  const total = top.reduce((a, x) => a + Number(x.kilos || 0), 0);
  if (!total) {
    host.innerHTML = '<div class="chart-empty">Sin datos</div>';
    return;
  }

  const R = 46;
  const cx = 58;
  const cy = 58;
  const sw = 18;
  const circ = 2 * Math.PI * R;
  const gap = 0.01;
  let offset = 0;
  const slices = top.map((item, i) => {
    const p = Number(item.kilos || 0) / total;
    const effectiveP = Math.max(p - gap, 0.005);
    const dash = effectiveP * circ;
    const gapArc = circ - dash;
    const col = palette[i % palette.length] || 'var(--acc)';
    // Rotate so it starts at the top (-90 deg = circ/4 offset added)
    const startOffset = -(offset * circ) + circ * 0.25;
    const s = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${col}" stroke-width="${sw}"
      stroke-dasharray="${dash.toFixed(2)} ${gapArc.toFixed(2)}"
      stroke-dashoffset="${startOffset.toFixed(2)}"
      style="transition:stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)"/>`;
    offset += p;
    return { s, name: item.name, col, pct: (p * 100).toFixed(1), kilos: item.kilos };
  });

  const topKilos = Number(slices[0]?.kilos || 0);

  host.innerHTML = `
    <div class="donut-wrap">
      <svg class="donut-svg" viewBox="0 0 116 116" style="width:130px;height:130px">
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="${sw}"/>
        ${slices.map(x => x.s).join('')}
        <text x="${cx}" y="${cy - 5}" text-anchor="middle" style="fill:var(--chart-text-strong)" font-family="Manrope,Inter,sans-serif" font-size="10.5" font-weight="800">${fmtK(topKilos)}</text>
        <text x="${cx}" y="${cy + 9}" text-anchor="middle" style="fill:var(--chart-text-soft)" font-family="Inter,sans-serif" font-size="7.5">kg lider</text>
      </svg>
      <div class="dlegend">
        ${slices.map(({ name, col, pct }) => `
          <div class="dl">
            <div class="dl-dot" style="background:${col}"></div>
            <div class="dl-name" title="${escHtml(name)}">${escHtml(name)}</div>
            <div class="dl-val" style="color:${col}">${pct}%</div>
          </div>`).join('')}
      </div>
    </div>`;
}

// Smooth bezier curve path
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev[0] + curr[0]) / 2;
    d += ` C${cpx.toFixed(1)},${prev[1].toFixed(1)} ${cpx.toFixed(1)},${curr[1].toFixed(1)} ${curr[0].toFixed(1)},${curr[1].toFixed(1)}`;
  }
  return d;
}

export function renderLineChart(entries, deps = {}) {
  const { el, fmt, fmtK } = deps;
  const host = el?.('gLinea');
  const badge = el?.('lcBadge');
  if (!host) return;
  if (!entries.length) {
    host.innerHTML = '<div class="chart-empty">Sin datos</div>';
    if (badge) badge.textContent = '—';
    return;
  }
  if (entries.length < 2) {
    host.innerHTML = '<div class="chart-empty">Necesitás al menos 2 meses de datos</div>';
    if (badge) badge.textContent = `${entries.length} mes`;
    return;
  }
  if (badge) badge.textContent = `${entries.length} meses`;

  const W = 760;
  const H = 200;
  const pL = 56;
  const pR = 20;
  const pT = 18;
  const pB = 36;
  const vals = entries.map(x => Number(x.kilos || 0));
  const maxV = Math.max(...vals) * 1.12 || 1;
  const xP = i => pL + (i / (entries.length - 1)) * (W - pL - pR);
  const yP = v => pT + (1 - v / maxV) * (H - pT - pB);

  const gridTicks = [0, 0.25, 0.5, 0.75, 1];
  const grid = gridTicks.map(t => {
    const yg = pT + t * (H - pT - pB);
    return `<line class="lc-grid" x1="${pL}" y1="${yg.toFixed(1)}" x2="${W - pR}" y2="${yg.toFixed(1)}"/>
            <text class="lc-lbl" x="${(pL - 6).toFixed(1)}" y="${(yg + 3.5).toFixed(1)}" text-anchor="end">${fmtK(maxV * (1 - t))}</text>`;
  }).join('');

  const pts = entries.map((x, i) => [xP(i), yP(Number(x.kilos || 0))]);
  const line = smoothPath(pts);
  const area = line + `L${pts[pts.length-1][0].toFixed(1)},${(H-pB).toFixed(1)}L${pL},${(H-pB).toFixed(1)}Z`;

  const step = Math.ceil(entries.length / 7);
  const xlbls = entries.map((x, i) => {
    if (i % step !== 0 && i !== entries.length - 1) return '';
    const [y, mo] = String(x.periodo || '').split('-');
    const mns = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `<text class="lc-lbl" x="${xP(i).toFixed(1)}" y="${H - pB + 16}" text-anchor="middle">${mns[(+mo||1)-1]} ${String(y||'').slice(2)}</text>`;
  }).join('');

  const dots = pts.map(([x, y], i) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(--chart-accent)" stroke="var(--chart-dot-stroke)" stroke-width="2.5"><title>${entries[i].periodo}: ${fmt(entries[i].kilos)} kg</title></circle>`
  ).join('');

  host.innerHTML = `
    <svg class="lc-svg" viewBox="0 0 ${W} ${H}" style="height:${H}px;width:100%;overflow:visible">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--acc)" stop-opacity=".45"/>
          <stop offset="100%" stop-color="var(--acc)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}${xlbls}
      <path d="${area}" fill="url(#lg)" class="lc-area"/>
      <path class="lc-line" d="${line}" stroke="var(--chart-accent)"/>
      ${dots}
    </svg>`;
}

export function renderDailyCompareChart(id, payload, deps = {}) {
  const { el, fmt, fmtK, escHtml, palette = [] } = deps;
  const host = el?.(id);
  if (!host) return;

  const series = Array.isArray(payload?.series)
    ? payload.series.filter(item => Array.isArray(item?.values) && item.values.length)
    : [];
  const dayStart = Number(payload?.dayWindow?.start || 1);
  const dayEnd = Number(payload?.dayWindow?.end || 31);
  const days = Array.from({ length: Math.max(dayEnd - dayStart + 1, 0) }, (_, index) => dayStart + index);

  if (!series.length || !days.length) {
    host.innerHTML = '<div class="chart-empty">Sin datos temporales</div>';
    return;
  }

  const W = 860;
  const H = 260;
  const pL = 56;
  const pR = 20;
  const pT = 18;
  const pB = 40;
  const yMax = Math.max(1, ...series.flatMap(item => item.values.map(p => Number(p.kilos || 0)))) * 1.14;
  const xAt = day => pL + ((day - dayStart) / Math.max(dayEnd - dayStart, 1)) * (W - pL - pR);
  const yAt = kilos => pT + (1 - Number(kilos || 0) / yMax) * (H - pT - pB);
  const xTicks = days.filter((_, i) => i === 0 || i === days.length - 1 || i % Math.max(1, Math.ceil(days.length / 6)) === 0);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const grid = yTicks.map(step => {
    const y = pT + step * (H - pT - pB);
    return `<line class="daily-grid" x1="${pL}" y1="${y.toFixed(1)}" x2="${W - pR}" y2="${y.toFixed(1)}"></line>
      <text class="daily-grid-label" x="${(pL - 7).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtK(yMax * (1 - step))}</text>`;
  }).join('');

  const xLabels = xTicks.map(day =>
    `<text class="daily-axis-label" x="${xAt(day).toFixed(1)}" y="${H - pB + 18}" text-anchor="middle">${day}</text>`
  ).join('');

  const gradDefs = series.map((item, index) => {
    const color = palette[index % palette.length] || 'var(--acc)';
    return `<linearGradient id="dc-grad-${index}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="${index === 0 ? '.3' : '.15'}"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>`;
  }).join('');

  const seriesGeometry = series.map((item, index) => {
    const color = palette[index % palette.length] || 'var(--acc)';
    const pointMap = new Map(item.values.map(p => [Number(p.day), Number(p.kilos || 0)]));
    const dotDays = days.filter(day => pointMap.has(day));
    const points = dotDays.map(day => [xAt(day), yAt(pointMap.get(day))]);
    if (!points.length) return null;
    const linePath = smoothPath(points);
    const firstPt = points[0];
    const lastPt = points[points.length - 1];
    const areaPath = linePath + ` L${lastPt[0].toFixed(1)},${(H - pB).toFixed(1)} L${firstPt[0].toFixed(1)},${(H - pB).toFixed(1)} Z`;
    const dots = points.map(([x, y], pi) => {
      const day = dotDays[pi];
      const kilos = pointMap.get(day) || 0;
      const tooltip = `${item.label || item.key || `Serie ${index + 1}`} · día ${day}: ${fmt(kilos)} kg`;
      return `
        <circle class="daily-dot-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="transparent" stroke="transparent" pointer-events="all" data-tooltip="${escapeAttr(tooltip)}">
          <title>${escHtml(tooltip)}</title>
        </circle>
        <circle class="daily-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${index === 0 ? 3.8 : 3}" fill="${color}" pointer-events="none"></circle>`;
    }).join('');
    return {
      index,
      color,
      areaPath,
      linePath,
      dots,
      isCurrent: index === 0,
    };
  }).filter(Boolean);

  const areaLayers = seriesGeometry.map(item =>
    `<path class="daily-area" d="${item.areaPath}" fill="url(#dc-grad-${item.index})" stroke="none" pointer-events="none"/>`
  ).join('');

  const lineLayers = seriesGeometry.map(item =>
    `<path class="daily-line${item.isCurrent ? ' current' : ''}" d="${item.linePath}" stroke="${item.color}" stroke-width="${item.isCurrent ? 3 : 2.2}" pointer-events="none"></path>`
  ).join('');

  const dotLayers = seriesGeometry.map(item => item.dots).join('');

  const legends = series.map((item, index) => {
    const color = palette[index % palette.length] || 'var(--acc)';
    const total = item.values.reduce((acc, p) => acc + Number(p.kilos || 0), 0);
    const latest = item.values[item.values.length - 1];
    return `<div class="daily-legend-item">
      <div class="daily-legend-top">
        <div class="daily-legend-name"><span class="daily-legend-dot" style="background:${color}"></span>${escHtml(item.label || item.key || `Serie ${index + 1}`)}</div>
        ${index === 0 ? '<span class="detail-view-badge">Referencia</span>' : ''}
      </div>
      <div class="daily-legend-kpi" style="color:${color}">${fmt(total)}</div>
      <div class="daily-legend-sub">${latest ? `Último día con dato: ${latest.day} · ${fmt(latest.kilos)} kg` : 'Sin puntos cargados.'}</div>
    </div>`;
  }).join('');

  host.innerHTML = `
    <div class="daily-compare-shell">
      <svg class="daily-compare-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Evolución diaria comparada de kilos" style="overflow:visible">
        <defs>${gradDefs}</defs>
        ${grid}
        <line class="daily-axis" x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}"></line>
        ${xLabels}
        ${areaLayers}${lineLayers}${dotLayers}
      </svg>
      <div class="daily-legend">${legends}</div>
    </div>`;

  installDailyTouchTooltip(host);
}
