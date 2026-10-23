import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import type { PeriodKind } from "./data";
import { Legend, PaceBar, PERIOD_OPTIONS, PeriodBars, Segmented, modelSegments } from "./charts";
import { TYPICAL_DAYS, typicalDay, useFootprintReport } from "./data";
import { formatAgo, formatCo2e, formatEnergy, formatPercent } from "./format";
import { FONT, Headline, ModelList } from "./summary";

// Geometry follows the built-in usage summary and host-monitor in the same footer.
const ICON_SIZE = 14;
const ICON_GAP = 6;
const TEXT_GAP = 8;
const MIN_METER_WIDTH = 24;
// Below these widths the meter, then the CO2e value, drop out. Estimated from 12px tabular digits.
const WIDTH_FOR_CO2E = 120;
const WIDTH_FOR_METER = 170;
// Columns shown in the popover for each period kind.
const POPOVER_PERIODS: Record<PeriodKind, number> = { daily: 14, weekly: 8, monthly: 6 };

type HoverState = PressableStateCallbackType & { hovered?: boolean };

function triggerStyle(theme: PluginTheme) {
  return ({ hovered }: HoverState) => ({
    width: "100%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
    minHeight: 28,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: hovered ? theme.colors.surface2 : undefined,
  });
}

function todayOf(report: ReturnType<typeof useFootprintReport>["data"]) {
  return report ? report.daily[report.daily.length - 1] : undefined;
}

export function FootprintSidebarItem({ theme, openPopover }: PluginSidebarItemProps) {
  const { data, error } = useFootprintReport();
  const [available, setAvailable] = useState<number | null>(null);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setAvailable(event.nativeEvent.layout.width),
    [],
  );

  // Like the built-in usage summary: nothing until there is something to show.
  if (!data && !error) return null;
  const today = todayOf(data);
  const typical = data ? typicalDay(data.daily) : null;
  const width = available ?? WIDTH_FOR_CO2E;
  const pace =
    today && typical && typical.activeDays > 0
      ? `, ${formatPercent(today.impacts.gwpGco2eq / typical.co2eG)} of a typical day`
      : "";
  const label = today
    ? `Eco footprint today: ${formatEnergy(today.impacts.energyWh)} energy, ${formatCo2e(today.impacts.gwpGco2eq)} CO2e${pace}`
    : "Eco footprint unavailable";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => openPopover(FootprintPopover)}
      style={triggerStyle(theme)}
    >
      <View
        onLayout={onLayout}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <Icon name="Leaf" size={ICON_SIZE} color={theme.colors.foregroundMuted} />
        {today && data ? (
          <>
            <Text
              numberOfLines={1}
              style={{
                marginLeft: ICON_GAP,
                fontSize: FONT.body,
                color: theme.colors.foreground,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatEnergy(today.impacts.energyWh)}
            </Text>
            {width >= WIDTH_FOR_METER ? (
              <View style={{ flex: 1, minWidth: MIN_METER_WIDTH, marginLeft: TEXT_GAP }}>
                <PaceBar
                  theme={theme}
                  segments={modelSegments(theme, data.models, today)}
                  typical={typical && typical.activeDays > 0 ? typical.co2eG : null}
                />
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {width >= WIDTH_FOR_CO2E ? (
              <Text
                numberOfLines={1}
                style={{
                  marginLeft: TEXT_GAP,
                  fontSize: FONT.body,
                  color: theme.colors.foregroundMuted,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatCo2e(today.impacts.gwpGco2eq)}
              </Text>
            ) : null}
          </>
        ) : (
          <Text
            numberOfLines={1}
            style={{
              marginLeft: ICON_GAP,
              fontSize: FONT.body,
              color: theme.colors.foregroundMuted,
            }}
          >
            Footprint unavailable
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function FootprintPopover({ theme, layout, openScreen }: PluginPopoverProps) {
  const { data, error, isPending } = useFootprintReport();
  const [kind, setKind] = useState<PeriodKind>("daily");
  const [picked, setPicked] = useState<number | null>(null);
  const rootStyle = {
    gap: 12,
    padding: layout.compact ? 16 : 12,
    width: layout.compact ? undefined : 320,
    backgroundColor: theme.colors.surface1,
  };

  if (!data) {
    return (
      <View style={rootStyle}>
        <Text style={{ fontSize: FONT.title, color: theme.colors.foreground }}>Eco footprint</Text>
        <Text
          style={{
            fontSize: FONT.body,
            color: isPending ? theme.colors.foregroundMuted : theme.colors.statusDanger,
          }}
        >
          {isPending ? "Computing footprint..." : (error?.message ?? "Footprint is unavailable.")}
        </Text>
      </View>
    );
  }

  const periods = data[kind].slice(-POPOVER_PERIODS[kind]);
  const typical = typicalDay(data.daily);
  const selected = picked !== null && picked < periods.length ? picked : periods.length - 1;
  const changeKind = (next: PeriodKind) => {
    setKind(next);
    setPicked(null);
  };

  return (
    <View style={rootStyle}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: FONT.title, color: theme.colors.foreground }}>
          Eco footprint
        </Text>
        <Segmented
          theme={theme}
          options={PERIOD_OPTIONS}
          value={kind}
          onChange={changeKind}
          accessibilityLabel="Period"
        />
      </View>
      <Headline theme={theme} kind={kind} periods={periods} index={selected} heroSize={22} />
      {kind === "daily" && typical.activeDays > 0 ? (
        <>
          <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>
            {`Typical day ${formatCo2e(typical.co2eG)} · median of ${typical.activeDays} active days in ${TYPICAL_DAYS}`}
          </Text>
          <Text style={{ fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>
            Sidebar bar: the fill is today's CO2e, split by model; the line marks the typical day.
          </Text>
        </>
      ) : null}
      <PeriodBars
        theme={theme}
        kind={kind}
        periods={periods}
        order={data.models}
        selected={selected}
        onSelect={setPicked}
        height={52}
        labelEvery={kind === "daily" ? 7 : kind === "weekly" ? 4 : 3}
      />
      <Legend theme={theme} order={data.models} periods={periods} />
      <View style={{ height: 1, backgroundColor: theme.colors.border }} />
      <ModelList theme={theme} order={data.models} period={periods[selected]} />
      <Footer theme={theme} report={data} onMore={() => openScreen({ screenId: "footprint" })} />
    </View>
  );
}

function Footer({
  theme,
  report,
  onMore,
}: {
  theme: PluginTheme;
  report: NonNullable<ReturnType<typeof useFootprintReport>["data"]>;
  onMore(): void;
}) {
  return (
    <View style={{ gap: 6 }}>
      {report.refreshError ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="TriangleAlert" size={12} color={theme.colors.statusWarning} />
          <Text
            numberOfLines={2}
            style={{ flex: 1, fontSize: FONT.caption, color: theme.colors.statusWarning }}
          >
            Showing older numbers: {report.refreshError}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, fontSize: FONT.caption, color: theme.colors.foregroundMuted }}>
          Updated {formatAgo(report.generatedAt)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open footprint details"
          onPress={onMore}
          style={({ hovered }: HoverState) => ({
            flexDirection: "row" as const,
            alignItems: "center" as const,
            gap: 2,
            paddingVertical: 3,
            paddingLeft: 8,
            paddingRight: 4,
            borderRadius: 6,
            backgroundColor: hovered ? theme.colors.surface2 : undefined,
          })}
        >
          <Text style={{ fontSize: FONT.body, color: theme.colors.foreground }}>Details</Text>
          <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
    </View>
  );
}
