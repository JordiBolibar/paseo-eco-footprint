import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Token counts as recorded by Vibe session journals, plus the impacts computed
// by EcoLogits. The estimate is driven by output tokens only; input and cached
// tokens are carried for display.
const usageSchema = z.object({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});

const impactsSchema = z.object({
  usage: usageSchema,
  /** Electrical energy, usage phase only, in watt-hours. */
  energyWh: z.number(),
  /** Greenhouse gases, total (usage + embodied), in grams CO2eq. */
  gwpGco2eq: z.number(),
  /** The embodied (hardware manufacturing) share of gwpGco2eq. */
  gwpEmbodiedGco2eq: z.number(),
});

const modelImpactsSchema = z.object({
  /** Model name as recorded (e.g. "glm-5-3") or "unknown". */
  model: z.string(),
  /** False when the model was not registered in EcoLogits and the default
   * parameter count from settings was used instead. */
  estimated: z.boolean(),
  impacts: impactsSchema,
});

const periodSchema = z.object({
  /** "2026-10-12" for days and weeks (the Monday), "2026-10" for months. */
  period: z.string(),
  impacts: impactsSchema,
  models: z.array(modelImpactsSchema),
});

export const footprintReportRpc = defineRpc({
  name: "footprint.report",
  input: z.object({
    /** The viewer's IANA timezone, so days group where the user lives, not
     * where the daemon runs. Empty falls back to the daemon's timezone. */
    timezone: z.string().default(""),
  }),
  output: z.object({
    /** When the report was last computed, in epoch milliseconds. */
    generatedAt: z.number(),
    /** The viewer's local date, the calendar days are grouped by. */
    today: z.string(),
    timezone: z.string(),
    /** ISO 3166-1 alpha-3 electricity mix zone used for the estimates. */
    zone: z.string(),
    /** True when the zone is EcoLogits's default for the providers (the
     * setting is empty or not a registered zone), false when the user set
     * a valid zone in the plugin settings. */
    zoneIsDefault: z.boolean(),
    /** Model assumed for sessions that do not record one. */
    defaultModel: z.string(),
    /** Every model seen in the report, heaviest first: stable order for colors. */
    models: z.array(z.string()),
    /** Contiguous series, oldest first; the last entry is the current period. */
    daily: z.array(periodSchema),
    weekly: z.array(periodSchema),
    monthly: z.array(periodSchema),
    /** True when the report includes backfilled history that has no daily
     * split (attributed to session start dates). */
    historyEstimated: z.boolean(),
    /** Set when the latest refresh failed and an older report is served. */
    refreshError: z.string().nullable(),
  }),
});
