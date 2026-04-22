import { clamp } from "./db.js";

export function parseIsoDateParts(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return { year, month, day };
}

export function daysInMonthUtc(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function shiftIsoToCompareYear(isoDate, compareYear, anchorYear) {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return "";
  const targetYear = Number(compareYear) + (Number(parts.year) - Number(anchorYear));
  const safeDay = Math.min(parts.day, daysInMonthUtc(targetYear, parts.month));
  return isoFromParts(targetYear, parts.month, safeDay);
}

export function isSingleMonthRange(desdeIso, hastaIso) {
  const desde = parseIsoDateParts(desdeIso);
  const hasta = parseIsoDateParts(hastaIso);
  if (!desde || !hasta) return false;
  return desde.year === hasta.year && desde.month === hasta.month;
}

export function isFullMonthRange(desdeIso, hastaIso) {
  const desde = parseIsoDateParts(desdeIso);
  const hasta = parseIsoDateParts(hastaIso);
  if (!desde || !hasta) return false;
  if (desde.day !== 1) return false;
  return hasta.day === daysInMonthUtc(hasta.year, hasta.month);
}

export function yearMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function getYearMonthKeysForRange(desdeIso, hastaIso) {
  if (!isFullMonthRange(desdeIso, hastaIso)) return null;
  const desde = parseIsoDateParts(desdeIso);
  const hasta = parseIsoDateParts(hastaIso);
  if (!desde || !hasta) return null;

  const keys = [];
  let year = desde.year;
  let month = desde.month;
  while (year < hasta.year || (year === hasta.year && month <= hasta.month)) {
    keys.push(yearMonthKey(year, month));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (keys.length > 36) return null;
  }
  return keys;
}

export function monthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    desde: start.toISOString().slice(0, 10),
    hasta: end.toISOString().slice(0, 10)
  };
}

export function monthNameEs(month) {
  return [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ][Math.max(1, Math.min(12, Number(month || 1))) - 1];
}

export function formatProjectionRangeLabel(desdeIso, hastaIso) {
  const desde = parseIsoDateParts(desdeIso);
  const hasta = parseIsoDateParts(hastaIso);
  if (!desde || !hasta) return "";

  const fullMonthRange = isFullMonthRange(desdeIso, hastaIso);
  if (fullMonthRange && desde.year === hasta.year && desde.month === hasta.month) {
    return `${monthNameEs(desde.month)} ${desde.year}`;
  }
  if (fullMonthRange && desde.year === hasta.year) {
    return `${monthNameEs(desde.month)}-${monthNameEs(hasta.month)} ${desde.year}`;
  }
  if (fullMonthRange) {
    return `${monthNameEs(desde.month)} ${desde.year}-${monthNameEs(hasta.month)} ${hasta.year}`;
  }
  if (desde.year === hasta.year && desde.month === hasta.month) {
    return `${desde.day}-${hasta.day} ${monthNameEs(desde.month)} ${desde.year}`;
  }
  if (desde.year === hasta.year) {
    return `${desde.day} ${monthNameEs(desde.month)}-${hasta.day} ${monthNameEs(hasta.month)} ${desde.year}`;
  }
  return `${desde.day} ${monthNameEs(desde.month)} ${desde.year}-${hasta.day} ${monthNameEs(hasta.month)} ${hasta.year}`;
}

export function getExactYearMonthKey(f) {
  if (!f?.desde || !f?.hasta) return null;
  const desde = parseIsoDateParts(f.desde);
  const hasta = parseIsoDateParts(f.hasta);
  if (!desde || !hasta) return null;
  if (desde.year !== hasta.year || desde.month !== hasta.month) return null;
  const fullMonth = monthRange(desde.year, desde.month);
  if (f.desde !== fullMonth.desde || f.hasta !== fullMonth.hasta) return null;
  return yearMonthKey(desde.year, desde.month);
}

export function getCurrentYearMonthKeys(f) {
  if (!f?.desde || !f?.hasta) return null;
  return getYearMonthKeysForRange(f.desde, f.hasta);
}

export function parseProjectionCompareContext(url, filters) {
  const sp = url.searchParams;
  const todayIso = new Date().toISOString().slice(0, 10);
  const fallbackDate = filters?.hasta || filters?.desde || todayIso;
  const baseIso = /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate) ? fallbackDate : todayIso;
  const baseYear = Number(baseIso.slice(0, 4));
  const baseMonth = Number(baseIso.slice(5, 7));
  const compareYear = clamp(parseInt(sp.get("compareYear") || "", 10), 2025, 2000, 2100);

  let currentDesde = filters?.desde || "";
  let currentHasta = filters?.hasta || "";
  if (!currentDesde || !currentHasta) {
    const fallbackRange = monthRange(baseYear, baseMonth);
    currentDesde = currentDesde || fallbackRange.desde;
    currentHasta = currentHasta || fallbackRange.hasta;
  }

  const currentDesdeParts = parseIsoDateParts(currentDesde);
  const currentHastaParts = parseIsoDateParts(currentHasta);
  const anchorYear = currentDesdeParts?.year || baseYear;
  const compareDesdeFromQuery = String(sp.get("compareDesde") || "").trim();
  const compareHastaFromQuery = String(sp.get("compareHasta") || "").trim();
  const compareDesde = /^\d{4}-\d{2}-\d{2}$/.test(compareDesdeFromQuery)
    ? compareDesdeFromQuery
    : shiftIsoToCompareYear(currentDesde, compareYear, anchorYear);
  const compareHasta = /^\d{4}-\d{2}-\d{2}$/.test(compareHastaFromQuery)
    ? compareHastaFromQuery
    : shiftIsoToCompareYear(currentHasta, compareYear, anchorYear);

  const currentSingleMonth = isSingleMonthRange(currentDesde, currentHasta);
  const currentFullMonth = currentSingleMonth && isFullMonthRange(currentDesde, currentHasta);
  const isSingleFullMonth = Boolean(currentFullMonth);
  const compareMode = String(sp.get("compareMode") || "").trim() || (isSingleFullMonth ? "month" : "range");
  const yearMonthKeys = getYearMonthKeysForRange(compareDesde, compareHasta);
  const compareDesdeParts = parseIsoDateParts(compareDesde);
  const compareMonthYear = compareDesdeParts?.year || compareYear;
  const compareMonthNumber = compareDesdeParts?.month || baseMonth || 1;
  const compareYearMonthKey = yearMonthKey(compareMonthYear, compareMonthNumber);
  const historicalClosedMonth = Boolean(currentSingleMonth && compareYearMonthKey);
  const historicalClosedMonthRange = historicalClosedMonth ? monthRange(compareMonthYear, compareMonthNumber) : null;

  return {
    baseYear,
    baseMonth,
    currentDesde,
    currentHasta,
    currentSingleMonth,
    currentFullMonth,
    compareYear: compareMonthYear,
    compareMonth: compareMonthNumber,
    compareYearMonthKey,
    historicalClosedMonth,
    historicalClosedMonthDesde: historicalClosedMonthRange?.desde || "",
    historicalClosedMonthHasta: historicalClosedMonthRange?.hasta || "",
    desde: compareDesde,
    hasta: compareHasta,
    mode: compareMode === "month" && !isSingleFullMonth ? "range" : compareMode,
    yearMonthKeys,
    label: formatProjectionRangeLabel(compareDesde, compareHasta)
  };
}
