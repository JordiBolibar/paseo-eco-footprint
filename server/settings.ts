import { z } from "zod";

export const settingsSchema = z.object({
  /** ISO 3166-1 alpha-3 electricity mix zone. Empty means the EcoLogits
   * default for the provider (SWE for Mistral). */
  electricityMixZone: z
    .string()
    .describe("Electricity mix zone (ISO alpha-3, empty = provider default)")
    .default(""),
  /** Model assumed for sessions that do not record one. */
  defaultModel: z
    .string()
    .describe("Model assumed for sessions without a recorded model")
    .default("glm-5-3"),
  /** Parameter count in billions for models not registered in EcoLogits. */
  defaultParameterCountBillions: z
    .number()
    .describe("Assumed parameter count in billions for unknown models")
    .default(70),
});

export type EcoSettings = z.output<typeof settingsSchema>;

export const DEFAULT_SETTINGS: EcoSettings = {
  electricityMixZone: "",
  defaultModel: "glm-5-3",
  defaultParameterCountBillions: 70,
};
