import type { PeriodKind } from "./data";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A value in a small unit (Wh, g) that switches to the big unit (kWh, kg) at 1000. Below 100 the
 * value keeps one decimal, above that it rounds to a whole number, so strings stay short.
 */
function formatScaled(value: number, smallUnit: string, bigUnit: string): string {
  const amount = Math.max(value, 0);
  if (amount < 1000) {
    const shown = amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10;
    return `${shown} ${smallUnit}`;
  }
  const big = amount / 1000;
  const shown = big >= 100 ? Math.round(big) : big >= 10 ? Math.round(big * 10) / 10 : Math.round(big * 100) / 100;
  return `${shown} ${bigUnit}`;
}

/** "82.5 Wh", "412 Wh", "1.24 kWh". Usage-phase electrical energy. */
export function formatEnergy(wh: number): string {
  return formatScaled(wh, "Wh", "kWh");
}

/** "135 g", "1.2 kg". CO2e, usage plus embodied. */
export function formatCo2e(g: number): string {
  return formatScaled(g, "g", "kg");
}

/** "1,234,567": token counts with thousands separators. Manual grouping, so it does not depend
 * on the runtime's Intl support. */
export function formatTokens(tokens: number): string {
  const value = Math.max(Math.round(tokens), 0).toString();
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatPercent(fraction: number): string {
  const percent = fraction * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function parseKey(key: string): { year: number; month: number; day: number } {
  const [year = 1970, month = 1, day = 1] = key.split("-").map(Number);
  return { year, month, day };
}

/** Axis labels: "12", "12 Oct", "Oct". */
export function formatPeriodShort(kind: PeriodKind, key: string): string {
  const { month, day } = parseKey(key);
  if (kind === "monthly") return MONTHS[month - 1] ?? key;
  if (kind === "weekly") return `${MONTHS[month - 1]} ${day}`;
  return `${day}`;
}

/** Headline labels: "12 Oct", "Week of 12 Oct", "Oct 2026". */
export function formatPeriodLong(kind: PeriodKind, key: string): string {
  const { year, month, day } = parseKey(key);
  if (kind === "monthly") return `${MONTHS[month - 1]} ${year}`;
  if (kind === "weekly") return `Week of ${MONTHS[month - 1]} ${day}`;
  return `${MONTHS[month - 1]} ${day}`;
}

export const CURRENT_LABEL: Record<PeriodKind, string> = {
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
};

export const PREVIOUS_LABEL: Record<PeriodKind, string> = {
  daily: "yesterday",
  weekly: "last week",
  monthly: "last month",
};

export function formatAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Model names are technical ("glm-5-3"); only the folded bucket gets a friendly label. */
export function modelLabel(model: string): string {
  if (model === "other") return "Other";
  return model;
}
