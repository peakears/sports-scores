import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import type { FetchOptions } from "../../src/data";
import { Segmented } from "../../src/ui/components/Segmented";
import { ErrorView, Loading, OfflineBanner, UpdatedAt } from "../../src/ui/components/States";
import { TeamLogo } from "../../src/ui/components/TeamLogo";
import { statValue } from "../../src/ui/format";
import { LEADERS_MAX, leaderSectionKey, visibleLeaders } from "../../src/ui/leaders";
import { combineFetched } from "../../src/ui/polling";
import { LEAGUE, useSportsData } from "../../src/ui/sports-data-context";
import { tabular, useColors } from "../../src/ui/theme";
import { usePolled } from "../../src/ui/use-polled";

type Kind = "skaters" | "goalies";

// The adapter's default query returns the skater boards; goalie boards are asked for by category.
// TODO: when a second league arrives, ask the adapter for its leader categories instead.
const GOALIE_CATEGORIES = ["wins", "savePctg", "goalsAgainstAverage", "shutouts"];

export default function LeadersScreen() {
  const sports = useSportsData();
  const colors = useColors();
  const [kind, setKind] = useState<Kind>("skaters");
  // Categories opened with "Show more". Kept while switching between Skaters and Goalies.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const leaders = usePolled(`leaders:${kind}`, async (o: FetchOptions) => {
    if (kind === "skaters") return sports.getLeaders(LEAGUE, { limit: LEADERS_MAX }, o);
    const results = await Promise.all(
      GOALIE_CATEGORIES.map((category) => sports.getLeaders(LEAGUE, { category, limit: LEADERS_MAX }, o)),
    );
    const combined = combineFetched(results);
    return { data: combined.data.flat(), meta: combined.meta };
  });

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sections = (leaders.data ?? []).map((b) => {
    const key = leaderSectionKey(kind, b.category);
    const isExpanded = expanded.has(key);
    const { shown, hasMore } = visibleLeaders(b.entries, isExpanded);
    return { title: b.label, key, data: shown, hasMore, expanded: isExpanded };
  });

  return (
    <View style={styles.screen}>
      <Segmented
        options={[
          { value: "skaters", label: "Skaters" },
          { value: "goalies", label: "Goalies" },
        ]}
        value={kind}
        onChange={setKind}
      />
      <OfflineBanner meta={leaders.meta} />
      {leaders.loading ? (
        <Loading />
      ) : !leaders.data && leaders.error ? (
        <ErrorView title="Couldn't load leaders" error={leaders.error} onRetry={leaders.refresh} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e, i) => `${e.player.id}-${i}`}
          stickySectionHeadersEnabled
          refreshControl={
            <RefreshControl refreshing={leaders.refreshing} onRefresh={leaders.refresh} colors={[colors.accent]} />
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.header, { color: colors.text, backgroundColor: colors.background }]}>
              {section.title}
            </Text>
          )}
          renderSectionFooter={({ section }) =>
            section.hasMore ? (
              <Pressable
                onPress={() => toggle(section.key)}
                hitSlop={4}
                style={({ pressed }) => [styles.toggle, { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityState={{ expanded: section.expanded }}
                accessibilityLabel={`${section.expanded ? "Show fewer" : "Show more"} in ${section.title}`}
              >
                <Text style={[styles.toggleText, { color: colors.accent }]}>
                  {section.expanded ? "Show fewer" : "Show more"}
                </Text>
                <Ionicons name={section.expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.accent} />
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.row, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <Text style={[styles.rank, tabular, { color: colors.muted }]}>{item.rank}</Text>
              <TeamLogo team={item.team} size={24} />
              <View style={styles.who}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15 }}>
                  {item.player.name}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{item.team.abbrev}</Text>
              </View>
              <Text style={[styles.value, tabular, { color: colors.text }]}>{statValue(item.value)}</Text>
            </View>
          )}
          ListFooterComponent={<UpdatedAt meta={leaders.meta} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { fontSize: 15, fontWeight: "700", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 20, textAlign: "right", fontSize: 13 },
  who: { flex: 1 },
  value: { fontSize: 16, fontWeight: "700" },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
  },
  toggleText: { fontSize: 13, fontWeight: "600" },
});
