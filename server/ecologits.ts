import {
  computeLlmImpacts,
  electricityMixes,
  llmImpacts,
  lowerBound,
  models,
  PROVIDER_CONFIG_MAP,
  type Energy,
  type GWP,
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
  if (models.findModel(provider, name)) {
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
  // Unknown model: assume a dense model with the configured parameter count.
  const mix = electricityMixes.findElectricityMix(mixZone);
  if (!mix) {
    return { energyWh: 0, gwpGco2eq: 0, gwpEmbodiedGco2eq: 0, estimated: true };
  }
  const providerConfig = PROVIDER_CONFIG_MAP[provider];
  const parameters = settings.defaultParameterCountBillions;
  try {
    const result = computeLlmImpacts({
      modelActiveParameterCount: parameters,
      modelTotalParameterCount: parameters,
      outputTokenCount: outputTokens,
      requestLatency: UNBOUNDED_LATENCY_S,
      ifElectricityMixAdpe: mix.adpe,
      ifElectricityMixPe: mix.pe,
      ifElectricityMixGwp: mix.gwp,
      ifElectricityMixWue: mix.wue,
      datacenterPue: providerConfig.datacenterPue,
      datacenterWue: providerConfig.datacenterWue,
    });
    return { ...numbersOf(result.energy, result.gwp, result.embodied.gwp), estimated: true };
  } catch {
    return { energyWh: 0, gwpGco2eq: 0, gwpEmbodiedGco2eq: 0, estimated: true };
  }
}
