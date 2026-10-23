import type { PluginTheme, RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { footprintReportRpc } from "../shared/report";

// The daemon caches the report and refreshes it after each finished turn; polling only picks
// that up, so there is no point polling faster.
const REPORT_REFRESH_MS = 30_000;

export type FootprintReport = RpcOutput<typeof footprintReportRpc>;
export type PeriodKind = "daily" | "weekly" | "monthly";
export type FootprintPeriod = FootprintReport["daily"][number];
export type Impacts = FootprintPeriod["impacts"];
export type ModelImpacts = FootprintPeriod["models"][number];

// The daemon groups days in the timezone we send, so "today" is where the
// user lives, not where the daemon runs.
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function useFootprintReport() {
  const getReport = useRpc(footprintReportRpc);
  return useQuery({
    queryKey: ["footprint-report", TIMEZONE],
    queryFn: () => getReport({ timezone: TIMEZONE }),
    refetchInterval: REPORT_REFRESH_MS,
    staleTime: REPORT_REFRESH_MS / 2,
  });
}

// Days before today that define a typical day for the sidebar meter: four weeks, so weekly
// rhythms even out and enough active days remain once idle ones are skipped.
export const TYPICAL_DAYS = 28;

/** A typical day in CO2e grams, the same measure the sidebar meter shows. */
export interface TypicalDay {
  /** Median CO2e per active day; 0 when there is no history yet. */
  co2eG: number;
  /** Active days the figure is drawn from; 0 when there is no history yet. */
  activeDays: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Median CO2e per active day over the TYPICAL_DAYS before today. Idle days are skipped so
 * weekends and time off do not drag the typical day down, and the median keeps one marathon day,
 * or a day with a single prompt, from moving it far. With no history there is no typical day:
 * the meter tick is hidden rather than invented.
 */
export function typicalDay(daily: readonly FootprintPeriod[]): TypicalDay {
  const values = daily.slice(-TYPICAL_DAYS - 1, -1).map((day) => day.impacts.gwpGco2eq);
  const active = values.filter((value) => value > 0);
  if (active.length === 0) {
    return { co2eG: 0, activeDays: 0 };
  }
  return { co2eG: median(active), activeDays: active.length };
}

/** Named series before the rest fold into "Other". */
export const MAX_NAMED_MODELS = 4;
export const OTHER_MODEL = "other";

export interface Swatch {
  color: string;
  opacity: number;
}

/**
 * Model identity colors. The theme offers one accent and neutrals; the status colors mean
 * health, not identity, so models get accent and muted steps instead. The order comes from the
 * report (heaviest model across all history first), so a model keeps its color across every
 * view, and every swatch sits next to a text label.
 */
export function modelSwatch(theme: PluginTheme, order: readonly string[], model: string): Swatch {
  const steps: Swatch[] = [
    { color: theme.colors.accent, opacity: 1 },
    { color: theme.colors.accent, opacity: 0.5 },
    { color: theme.colors.foregroundMuted, opacity: 0.9 },
    { color: theme.colors.foregroundMuted, opacity: 0.45 },
  ];
  const index = order.indexOf(model);
  if (index < 0 || index >= MAX_NAMED_MODELS) return { color: theme.colors.border, opacity: 1 };
  return steps[index] ?? { color: theme.colors.border, opacity: 1 };
}

export const EMPTY_IMPACTS: Impacts = {
  usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
  energyWh: 0,
  gwpGco2eq: 0,
  gwpEmbodiedGco2eq: 0,
};

function addImpacts(a: Impacts, b: Impacts): Impacts {
  return {
    usage: {
      inputTokens: a.usage.inputTokens + b.usage.inputTokens,
      cachedInputTokens: a.usage.cachedInputTokens + b.usage.cachedInputTokens,
      outputTokens: a.usage.outputTokens + b.usage.outputTokens,
      totalTokens: a.usage.totalTokens + b.usage.totalTokens,
    },
    energyWh: a.energyWh + b.energyWh,
    gwpGco2eq: a.gwpGco2eq + b.gwpGco2eq,
    gwpEmbodiedGco2eq: a.gwpEmbodiedGco2eq + b.gwpEmbodiedGco2eq,
  };
}

/** A period's models in report order, with anything past the named slots folded into "Other". */
export interface FoldedModel {
  model: string;
  /** True when the model (or any model folded into "Other") used the default size fallback. */
  estimated: boolean;
  impacts: Impacts;
}

export function foldModels(models: readonly ModelImpacts[], order: readonly string[]): FoldedModel[] {
  const named: FoldedModel[] = [];
  let other: FoldedModel | null = null;
  for (const model of models) {
    const rank = order.indexOf(model.model);
    if (rank >= 0 && rank < MAX_NAMED_MODELS) {
      named.push({ model: model.model, estimated: model.estimated, impacts: model.impacts });
    } else {
      other ??= { model: OTHER_MODEL, estimated: false, impacts: EMPTY_IMPACTS };
      other = {
        model: OTHER_MODEL,
        estimated: other.estimated || model.estimated,
        impacts: addImpacts(other.impacts, model.impacts),
      };
    }
  }
  named.sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model));
  return other ? [...named, other] : named;
}
