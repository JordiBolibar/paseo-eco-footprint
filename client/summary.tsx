import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { FootprintPeriod, PeriodKind } from "./data";
import { foldModels, modelSwatch } from "./data";
import { SwatchDot } from "./charts";
import {
  CURRENT_LABEL,
  formatCo2e,
  formatEnergy,
  formatPercent,
  formatPeriodLong,
  formatTokens,
  modelLabel,
  PREVIOUS_LABEL,
} from "./format";

export const FONT = { caption: 11, body: 12, title: 13, hero: 24 } as const;

/** The period's headline: a label, then CO2e with energy beside it, and the change below. */
export function Headline({
  theme,
  kind,
  periods,
  index,
  heroSize = FONT.hero,
}: {
  theme: PluginTheme;
  kind: PeriodKind;
  periods: readonly FootprintPeriod[];
  index: number;
  heroSize?: number;
}) {
  const period = periods[index];
  if (!period) return null;
  const previous = periods[index - 1];
  const isCurrent = index === periods.length - 1;
  const label = isCurrent ? CURRENT_LABEL[kind] : formatPeriodLong(kind, period.period);
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>{label}</Text>
      <View
        style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 8 }}
      >
        <Text
          style={{
            fontSize: heroSize,
            fontWeight: "600",
            color: theme.colors.foreground,
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatCo2e(period.impacts.gwpGco2eq)}
        </Text>
        <Text style={{ fontSize: FONT.body, color: theme.colors.foregroundMuted }}>CO2e</Text>
        <Text
          style={{
            fontSize: FONT.title,
            color: theme.colors.foreground,
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatEnergy(period.impacts.energyWh)}
        </Text>
        <Text style={{ fontSize: FONT.body, color: theme.colors.foregroundMuted }}>energy</Text>
      </View>
      {previous ? (
        <Change
          theme={theme}
          current={period.impacts.gwpGco2eq}
          previous={previous.impacts.gwpGco2eq}
          against={isCurrent ? PREVIOUS_LABEL[kind] : "the period before"}
        />
      ) : null}
    </View>
  );
}

/** Change against the previous period, in muted ink: a footprint is information, not a fault. */
function Change({
  theme,
  current,
  previous,
  against,
}: {
  theme: PluginTheme;
  current: number;
  previous: number;
  against: string;
}) {
  let icon = "Minus";
  let text = `Same as ${against}`;
  if (previous === 0) {
    if (current === 0) return null;
    icon = "TrendingUp";
    text = `Nothing ${against}`;
  } else if (current !== previous) {
    const ratio = current / previous - 1;
    icon = ratio > 0 ? "TrendingUp" : "TrendingDown";
    text = `${ratio > 0 ? "+" : "−"}${formatPercent(Math.abs(ratio))} vs ${against} (${formatCo2e(previous)})`;
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name={icon} size={12} color={theme.colors.foregroundMuted} />
      <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>{text}</Text>
    </View>
  );
}

/**
 * One row per model: swatch, name, an "est." tag when the default size stood in, share of the
 * period's CO2e, output tokens, energy, CO2e.
 */
export function ModelList({
  theme,
  order,
  period,
}: {
  theme: PluginTheme;
  order: readonly string[];
  period: FootprintPeriod | undefined;
}) {
  const models = period ? foldModels(period.models, order) : [];
  if (!period || models.length === 0) {
    return (
      <Text style={{ fontSize: FONT.body, color: theme.colors.foregroundMuted }}>
        No usage recorded in this period.
      </Text>
    );
  }
  const total = Math.max(period.impacts.gwpGco2eq, 1);
  return (
    <View style={{ gap: 2 }}>
      {models.map((model) => (
        <View key={model.model} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
          <SwatchDot swatch={modelSwatch(theme, order, model.model)} />
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, fontSize: FONT.body, color: theme.colors.foreground }}
          >
            {modelLabel(model.model)}
          </Text>
          {model.estimated ? (
            <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>
              est.
            </Text>
          ) : null}
          <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>
            {formatPercent(model.impacts.gwpGco2eq / total)}
          </Text>
          <View style={{ flex: 1 }} />
          <Text
            style={{
              fontSize: FONT.body,
              color: theme.colors.foreground,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatTokens(model.impacts.usage.outputTokens)}
          </Text>
          <Text
            style={{
              width: 56,
              textAlign: "right",
              fontSize: FONT.body,
              color: theme.colors.foregroundMuted,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatEnergy(model.impacts.energyWh)}
          </Text>
          <Text
            style={{
              width: 52,
              textAlign: "right",
              fontSize: FONT.body,
              color: theme.colors.foregroundMuted,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatCo2e(model.impacts.gwpGco2eq)}
          </Text>
        </View>
      ))}
    </View>
  );
}
