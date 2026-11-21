import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import type { FetchOptions } from "../../src/data";
import { Segmented } from "../../src/ui/components/Segmented";
import { ErrorView, Loading, OfflineBanner, UpdatedAt } from "../../src/ui/components/States";
import { TeamLogo } from "../../src/ui/components/TeamLogo";
import { statValue } from "../../src/ui/format";
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
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("skaters");

  const leaders = usePolled(`leaders:${kind}`, async (o: FetchOptions) => {
    if (kind === "skaters") return sports.getLeaders(LEAGUE, {}, o);
    const results = await Promise.all(GOALIE_CATEGORIES.map((category) => sports.getLeaders(LEAGUE, { category }, o)));
    const combined = combineFetched(results);
    return { data: combined.data.flat(), meta: combined.meta };
  });

  const sections = (leaders.data ?? []).map((b) => ({ title: b.label, key: b.category, data: b.entries }));

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
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: "/player/[id]", params: { id: item.player.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${item.rank}. ${item.player.name}, ${item.team.abbrev}, ${statValue(item.value)}. Open player page`}
              style={[styles.row, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
            >
              <Text style={[styles.rank, tabular, { color: colors.muted }]}>{item.rank}</Text>
              <TeamLogo team={item.team} size={24} />
              <View style={styles.who}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15 }}>
                  {item.player.name}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{item.team.abbrev}</Text>
              </View>
              <Text style={[styles.value, tabular, { color: colors.text }]}>{statValue(item.value)}</Text>
            </Pressable>
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
});
