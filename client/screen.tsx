import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import type { FootprintPeriod, PeriodKind } from "./data";
import { Legend, PERIOD_OPTIONS, PeriodBars, Segmented } from "./charts";
import { useFootprintReport, type FootprintReport } from "./data";
import {
  CURRENT_LABEL,
  formatAgo,
  formatCo2e,
  formatEnergy,
  formatPercent,
  formatPeriodLong,
  formatTokens,
} from "./format";
import { FONT, Headline, ModelList } from "./summary";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const MAX_CONTENT_WIDTH = 880;
// History depth on the screen: longer than the popover's window.
const SCREEN_PERIODS: Record<PeriodKind, number> = { daily: 30, weekly: 12, monthly: 12 };

function Card({
  theme,
  title,
  trailing,
  children,
}: {
  theme: PluginTheme;
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          style={{
            flex: 1,
            fontSize: FONT.title,
            fontWeight: "600",
            color: theme.colors.foreground,
          }}
        >
          {title}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

function Stat({
  theme,
  label,
  value,
  detail,
}: {
  theme: PluginTheme;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 120, gap: 2 }}>
      <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>{label}</Text>
      <Text
        style={{
          fontSize: 18,
          fontWeight: "600",
          color: theme.colors.foreground,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      {detail ? (
        <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

/** The period's headline numbers: CO2e with its embodied share, energy, output tokens, models. */
function Stats({ theme, period }: { theme: PluginTheme; period: FootprintPeriod }) {
  const { impacts } = period;
  const embodiedShare =
    impacts.gwpGco2eq > 0 ? formatPercent(impacts.gwpEmbodiedGco2eq / impacts.gwpGco2eq) : "0%";
  const estimated = period.models.filter((model) => model.estimated).length;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12, columnGap: 16 }}>
      <Stat
        theme={theme}
        label="CO2e"
        value={formatCo2e(impacts.gwpGco2eq)}
        detail={`${embodiedShare} embodied, from making the hardware`}
      />
      <Stat
        theme={theme}
        label="Energy"
        value={formatEnergy(impacts.energyWh)}
        detail="usage only, running the servers"
      />
      <Stat
        theme={theme}
        label="Output tokens"
        value={formatTokens(impacts.usage.outputTokens)}
        detail="what drives the estimate"
      />
      <Stat
        theme={theme}
        label="Models"
        value={`${period.models.length}`}
        detail={estimated > 0 ? `${estimated} estimated` : "all in EcoLogits data"}
      />
    </View>
  );
}

/** Plain-word notes about what the numbers are and are not. */
function Methodology({ theme, report }: { theme: PluginTheme; report: FootprintReport }) {
  const lines = [
    "These are estimates from a model, not measurements. Read them as orders of magnitude.",
    "The estimate is driven by output tokens. Input and cached tokens do not count.",
    "Energy and water cover the usage phase only. CO2e also includes the embodied share from making the hardware.",
    report.zoneIsDefault
      ? "Electricity mix zone: each provider's EcoLogits assumption (Sweden for Mistral, USA for Anthropic), not a measured region. Set a zone in the plugin settings to override it."
      : `Electricity mix zone: ${report.zone}, set in the plugin settings.`,
    `Sessions that do not record a model are counted as ${report.defaultModel}.`,
    "Models that are not in the EcoLogits data are estimated from a default size and marked \"est.\".",
  ];
  if (report.historyEstimated) {
    lines.push(
      "History from before the plugin was installed has no daily split. It is attributed to session start dates.",
    );
  }
  lines.push("Local models (for example devstral on llamacpp) run on this machine and are not counted.");
  return (
    <View style={{ gap: 8 }}>
      {lines.map((line) => (
        <View key={line} style={{ flexDirection: "row", gap: 6 }}>
          <Text style={{ fontSize: FONT.body, color: theme.colors.foregroundMuted }}>·</Text>
          <Text style={{ flex: 1, fontSize: FONT.body, color: theme.colors.foregroundMuted }}>
            {line}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Body({
  theme,
  compact,
  report,
}: {
  theme: PluginTheme;
  compact: boolean;
  report: FootprintReport;
}) {
  const [kind, setKind] = useState<PeriodKind>("daily");
  const [picked, setPicked] = useState<number | null>(null);
  const all = report[kind].slice(-SCREEN_PERIODS[kind]);
  // A phone shows half the columns so each stays wide enough to press.
  const periods = compact ? all.slice(-Math.ceil(all.length / 2)) : all;
  const selected = picked !== null && picked < periods.length ? picked : periods.length - 1;
  const period = periods[selected];
  const changeKind = (next: PeriodKind) => {
    setKind(next);
    setPicked(null);
  };
  const periodTitle = period
    ? selected === periods.length - 1
      ? CURRENT_LABEL[kind]
      : formatPeriodLong(kind, period.period)
    : "";

  return (
    <View style={{ gap: compact ? 12 : 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Segmented
          theme={theme}
          options={PERIOD_OPTIONS}
          value={kind}
          onChange={changeKind}
          accessibilityLabel="Period"
        />
        <Text
          style={{
            flex: 1,
            fontSize: FONT.caption,
            color: theme.colors.foregroundMuted,
            textAlign: "right",
          }}
        >
          Updated {formatAgo(report.generatedAt)} · {report.timezone}
        </Text>
      </View>
      {report.refreshError ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="TriangleAlert" size={14} color={theme.colors.statusWarning} />
          <Text style={{ flex: 1, fontSize: FONT.body, color: theme.colors.statusWarning }}>
            Showing older numbers: {report.refreshError}
          </Text>
        </View>
      ) : null}

      <Card theme={theme} title="Footprint">
        <Headline
          theme={theme}
          kind={kind}
          periods={periods}
          index={selected}
          heroSize={compact ? 26 : 30}
        />
        <PeriodBars
          theme={theme}
          kind={kind}
          periods={periods}
          order={report.models}
          selected={selected}
          onSelect={setPicked}
          height={compact ? 110 : 150}
          labelEvery={kind === "daily" ? 7 : kind === "weekly" ? 2 : compact ? 2 : 1}
        />
        <Legend theme={theme} order={report.models} periods={periods} />
      </Card>

      {period ? (
        <>
          <Card theme={theme} title={periodTitle}>
            <Stats theme={theme} period={period} />
          </Card>
          <Card theme={theme} title="By model">
            <ModelList theme={theme} order={report.models} period={period} />
          </Card>
        </>
      ) : null}

      <Card theme={theme} title="Methodology">
        <Methodology theme={theme} report={report} />
      </Card>

      <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>
        Estimated with the EcoLogits methodology from output tokens in local agent logs.
      </Text>
    </View>
  );
}

export function FootprintScreen({ theme, layout }: PluginScreenProps) {
  const { data, error, isPending, refetch, isRefetching } = useFootprintReport();
  const padding = layout.compact ? 16 : 24;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: MAX_CONTENT_WIDTH }}>
        {data ? (
          <Body theme={theme} compact={layout.compact} report={data} />
        ) : (
          <View style={{ gap: 12, paddingVertical: 48, alignItems: "center" }}>
            <Icon
              name={isPending ? "Hourglass" : "CircleAlert"}
              size={20}
              color={isPending ? theme.colors.foregroundMuted : theme.colors.statusDanger}
            />
            <Text
              style={{ fontSize: FONT.title, color: theme.colors.foreground, textAlign: "center" }}
            >
              {isPending ? "Computing footprint..." : "Could not compute footprint"}
            </Text>
            {error ? (
              <Text
                style={{
                  fontSize: FONT.body,
                  color: theme.colors.foregroundMuted,
                  textAlign: "center",
                }}
              >
                {error.message}
              </Text>
            ) : null}
            {!isPending ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try again"
                disabled={isRefetching}
                onPress={() => void refetch()}
                style={({ hovered }: HoverState) => ({
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: hovered ? theme.colors.surface1 : theme.colors.surface2,
                })}
              >
                <Text style={{ fontSize: FONT.body, color: theme.colors.foreground }}>
                  {isRefetching ? "Trying..." : "Try again"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
