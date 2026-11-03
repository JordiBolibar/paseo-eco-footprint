import {
  computeLlmImpacts,
  electricityMixes,
  isParametersMoE,
  llmImpacts,
  lowerBound,
  models,
  PROVIDER_CONFIG_MAP,
  type Energy,
  type GWP,
  type Model,
} from "@ecologits/ecologits.js";
import type { EcoSettings } from "./settings";

// Vibe models run on Mistral's infrastructure; Claude Code models on
// Anthropic's. Everything else (local models, unknown names) is assumed
// to run on Mistral's.
type Provider = "mistralai" | "anthropic";

/** The provider a model name runs on. */
export function providerForModel(model: string): Provider {
  return model.startsWith("claude") ? "anthropic" : "mistralai";
}

// The package models the latency from the parameter count and caps it at
// requestLatency. A huge value lets that regression decide; we never invent
// a latency ourselves.
const UNBOUNDED_LATENCY_S = 1e9;

export interface ModelImpacts {
  /** Electrical energy, usage phase only, in watt-hours. */
  energyWh: number;
  /** Greenhouse gases, total (usage + embodied), in grams CO2eq. */
  gwpGco2eq: number;
  /** The embodied share of gwpGco2eq, in grams CO2eq. */
  gwpEmbodiedGco2eq: number;
  /** True when the model is not registered and the default parameter count
   * from settings was used instead. */
  estimated: boolean;
}

/** Model name to EcoLogits model name. */
function ecologitsModelName(model: string, provider: Provider): string {
  // GLM 5.3 is registered under the name of Mistral's deployment of it.
  if (provider === "mistralai" && model === "glm-5-3") return "zai-glm-5-3";
  return model;
}

/** The zone used for the estimates: the setting when registered, else the
 * EcoLogits default for the provider (SWE for Mistral, USA for Anthropic). */
export function resolveZone(settingZone: string, provider: Provider = "mistralai"): string {
  const zone = settingZone.trim().toUpperCase();
  if (zone !== "" && electricityMixes.findElectricityMix(zone)) return zone;
  return PROVIDER_CONFIG_MAP[provider].datacenterLocation ?? "WOR";
}

/** True when the resolved zone is the provider default: the setting is
 * empty or not a registered zone. A valid zone the user chose counts as
 * their choice, even when it equals the provider default. */
export function zoneIsProviderDefault(settingZone: string): boolean {
  const zone = settingZone.trim().toUpperCase();
  return !(zone !== "" && electricityMixes.findElectricityMix(zone));
}

function numbersOf(
  energy: Energy | null,
  gwp: GWP | null,
  embodiedGwp: GWP | null,
): Omit<ModelImpacts, "estimated"> {
  // Energy is usage-only and comes back in kWh; GWP in kg CO2eq.
  return {
    energyWh: energy ? lowerBound(energy.value) * 1000 : 0,
    gwpGco2eq: gwp ? lowerBound(gwp.value) * 1000 : 0,
    gwpEmbodiedGco2eq: embodiedGwp ? lowerBound(embodiedGwp.value) * 1000 : 0,
  };
}

// Real-world deployment stats for registered models whose EcoLogits entry
// ships none (tps null). Without them the package estimates the generation
// latency with a regression that assumes ~15 tokens/s for a 40B-active model,
// far below the ~100 tokens/s these deployments really serve, which inflates
// the server energy and embodied shares of every estimate. Impacts are
// computed from the ledger at read time, so the correction also applies to
// past sessions.
// Source: OpenRouter endpoint stats of Mistral's own endpoints, p50
// throughput and time to first token over 30-minute windows, retrieved
// 2026-10-30; the median endpoint is used. GLM 5.3 (z-ai/glm-5.3-20260816):
// 105.5 / 114 / 116 tok/s, 0.64 / 0.75 / 0.99 s. GLM 5.2
// (z-ai/glm-5.2-20260616): 81.0 / 117.0 tok/s, 1.19 / 0.67 s; the vendored
// glm-5-2 twin entry keeps EcoLogits' own older measurement (57.5 tok/s).
// GLM 5 has no Mistral endpoints on OpenRouter, so it and zai-glm-latest (a
// moving pointer at 5.3 today) borrow the 5.3 measurement.
const DEPLOYMENT_STATS_OVERRIDES: Record<string, { tps: number; ttft: number }> = {
  "zai-glm-5-3": { tps: 114, ttft: 0.75 },
  "zai-glm-5-2": { tps: 99, ttft: 0.93 },
  "zai-glm-5": { tps: 114, ttft: 0.75 },
  "zai-glm-latest": { tps: 114, ttft: 0.75 },
};

// Public specs for models the vendored EcoLogits data does not know yet
// (synced 2026-10-02). Mistral Large 4 was released 2026-10-06 with open
// weights, so its architecture is public: a granular MoE with 1.05T total /
// 52B active parameters (docs.mistral.ai/models/mistral-large-4-0; HF config
// of mistralai/Mistral-Large-4-1T-A52B: 128 routed experts + 1 shared, 4
// experts per token). Throughput: median p50 of Mistral's own OpenRouter
// endpoint (mistralai/mistral-large-4-0-20261006) over three 30-minute
// windows, 89 / 98 / 104 tok/s and 1.68 / 1.18 / 1.48 s, retrieved 2026-11-03.
const KNOWN_SPECS: Record<string, { total: number; active: number; tps: number; ttft: number }> = {
  "mistral-large-4": { total: 1050, active: 52, tps: 98, ttft: 1.48 },
  "mistral-large-4-0": { total: 1050, active: 52, tps: 98, ttft: 1.48 },
};

/** Real deployment stats for a registered model whose EcoLogits entry has
 * no throughput stats, or null when the entry carries its own or no
 * override exists. The guard is on tps: without throughput the package's
 * latency regression drives the estimate, which is what the override
 * replaces. An override supplies tps and ttft together, so a hypothetical
 * entry with a real ttft but no tps would have both replaced. */
function deploymentStatsOverride(
  registered: Model,
  name: string,
): { tps: number; ttft: number } | null {
  if (registered.deployment?.tps != null) return null;
  return DEPLOYMENT_STATS_OVERRIDES[name] ?? null;
}

/** Impacts of a registered model computed with real deployment stats instead
 * of the latency fallback: the package methodology, one direct call. Null
 * when the computation fails, so the caller can use the registered path. */
function impactsWithDeploymentStats(
  registered: Model,
  outputTokens: number,
  stats: { tps: number; ttft: number },
  mixZone: string,
): Omit<ModelImpacts, "estimated"> | null {
  const mix = electricityMixes.findElectricityMix(mixZone);
  if (!mix) return null;
  const parameters = registered.architecture.parameters;
  const counts = isParametersMoE(parameters)
    ? { active: parameters.active, total: parameters.total }
    : { active: parameters, total: parameters };
  const providerConfig = PROVIDER_CONFIG_MAP[registered.provider];
  try {
    const result = computeLlmImpacts({
      modelActiveParameterCount: counts.active,
      modelTotalParameterCount: counts.total,
      outputTokenCount: outputTokens,
      requestLatency: UNBOUNDED_LATENCY_S,
      tps: stats.tps,
      ttft: stats.ttft,
      ifElectricityMixAdpe: mix.adpe,
      ifElectricityMixPe: mix.pe,
      ifElectricityMixGwp: mix.gwp,
      ifElectricityMixWue: mix.wue,
      datacenterPue: providerConfig.datacenterPue,
      datacenterWue: providerConfig.datacenterWue,
    });
    return numbersOf(result.energy, result.gwp, result.embodied.gwp);
  } catch {
    return null;
  }
}

/** Estimate the impacts of `outputTokens` generated tokens of one model. */
export function computeModelImpacts(
  model: string,
  outputTokens: number,
  settings: EcoSettings,
  zone: string,
): ModelImpacts {
  if (outputTokens <= 0) {
    return { energyWh: 0, gwpGco2eq: 0, gwpEmbodiedGco2eq: 0, estimated: false };
  }
  const provider = providerForModel(model);
  const name = ecologitsModelName(model, provider);
  // The report resolves one zone for display, but when the user did not set
  // one, each provider is estimated with its own default mix.
  const mixZone = zoneIsProviderDefault(settings.electricityMixZone)
    ? resolveZone(settings.electricityMixZone, provider)
    : zone;
  const registered = models.findModel(provider, name);
  if (registered) {
    const stats = deploymentStatsOverride(registered, name);
    if (stats) {
      const impacts = impactsWithDeploymentStats(registered, outputTokens, stats, mixZone);
      if (impacts) {
        return { ...impacts, estimated: false };
      }
    }
    try {
      const result = llmImpacts({
        provider,
        modelName: name,
        outputTokenCount: outputTokens,
        requestLatency: UNBOUNDED_LATENCY_S,
        electricityMixZone: mixZone,
      });
      if (!result.hasErrors) {
        return {
          ...numbersOf(result.energy, result.gwp, result.embodied?.gwp ?? null),
          estimated: false,
        };
      }
    } catch {
      // Fall through to the default parameter count below.
    }
  }
  // Unknown to the EcoLogits data: use the public specs when we have them
  // (open-weight models released after the data sync), else assume a dense
  // model with the configured parameter count.
  const mix = electricityMixes.findElectricityMix(mixZone);
  if (!mix) {
    return { energyWh: 0, gwpGco2eq: 0, gwpEmbodiedGco2eq: 0, estimated: true };
  }
  const providerConfig = PROVIDER_CONFIG_MAP[provider];
  const known = KNOWN_SPECS[name];
  const active = known?.active ?? settings.defaultParameterCountBillions;
  const total = known?.total ?? settings.defaultParameterCountBillions;
  try {
    const result = computeLlmImpacts({
      modelActiveParameterCount: active,
      modelTotalParameterCount: total,
      outputTokenCount: outputTokens,
      requestLatency: UNBOUNDED_LATENCY_S,
      ...(known ? { tps: known.tps, ttft: known.ttft } : {}),
      ifElectricityMixAdpe: mix.adpe,
      ifElectricityMixPe: mix.pe,
      ifElectricityMixGwp: mix.gwp,
      ifElectricityMixWue: mix.wue,
      datacenterPue: providerConfig.datacenterPue,
      datacenterWue: providerConfig.datacenterWue,
    });
    return { ...numbersOf(result.energy, result.gwp, result.embodied.gwp), estimated: !known };
  } catch {
    return { energyWh: 0, gwpGco2eq: 0, gwpEmbodiedGco2eq: 0, estimated: true };
  }
}
