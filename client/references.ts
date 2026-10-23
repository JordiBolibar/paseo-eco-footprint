import type { FootprintPeriod } from "./data";
import { formatTokens } from "./format";

// Typical published values for France/Europe, used only for the everyday
// equivalents in the popover. They are round numbers on purpose: the goal is
// to give a feeling for the scale, not a precise conversion.
//
// Phone charge: a full charge of a typical smartphone battery (about 12 Wh)
// plus charging losses. Kettle: bringing 1 L of tap water to a boil.
// Coffee, streaming, car: ADEME figures for France (black coffee per cup,
// one hour of HD video streaming, average car in real driving).
export const REFERENCES = {
  phoneChargeWh: 15,
  kettleBoilWh: 110,
  coffeeCupGco2e: 21,
  streamingHourGco2e: 25,
  carKmGco2e: 150,
} as const;

/** "<1", "2.4", "36", "1,240": short counts, one decimal below 10. */
function formatCount(value: number): string {
  if (value < 1) return "<1";
  if (value < 10) return (Math.round(value * 10) / 10).toString();
  return formatTokens(value);
}

export type Equivalent = {
  /** What the period's footprint is compared against, e.g. "phone charges". */
  label: string;
  /** How many of it the period amounts to, already formatted. */
  count: string;
  /** The reference value behind it, e.g. "15 Wh per charge". */
  basis: string;
};

/** Everyday equivalents of one period's totals: energy as charges and boils,
 * CO2e as coffee, streaming and car kilometres. */
export function everydayEquivalents(period: FootprintPeriod): Equivalent[] {
  const { energyWh, gwpGco2eq } = period.impacts;
  return [
    {
      label: "phone charges",
      count: formatCount(energyWh / REFERENCES.phoneChargeWh),
      basis: `${REFERENCES.phoneChargeWh} Wh per charge`,
    },
    {
      label: "kettle boils (1 L of water)",
      count: formatCount(energyWh / REFERENCES.kettleBoilWh),
      basis: `${REFERENCES.kettleBoilWh} Wh per boil`,
    },
    {
      label: "cups of coffee",
      count: formatCount(gwpGco2eq / REFERENCES.coffeeCupGco2e),
      basis: `${REFERENCES.coffeeCupGco2e} g CO2e per cup`,
    },
    {
      label: "hours of HD streaming",
      count: formatCount(gwpGco2eq / REFERENCES.streamingHourGco2e),
      basis: `${REFERENCES.streamingHourGco2e} g CO2e per hour`,
    },
    {
      label: "km by car",
      count: formatCount(gwpGco2eq / REFERENCES.carKmGco2e),
      basis: `${REFERENCES.carKmGco2e} g CO2e per km`,
    },
  ];
}
