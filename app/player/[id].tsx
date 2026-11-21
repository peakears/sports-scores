import { Stack, useLocalSearchParams, useRouter, type ErrorBoundaryProps } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { StatItem } from "../../src/domain";
import { PlayerHeadshot } from "../../src/ui/components/PlayerHeadshot";
import { Segmented } from "../../src/ui/components/Segmented";
import { StatGrid } from "../../src/ui/components/StatGrid";
import { CrashScreen, ErrorView, Loading, OfflineBanner, UpdatedAt } from "../../src/ui/components/States";
import { TeamLogo } from "../../src/ui/components/TeamLogo";
import { localDate } from "../../src/ui/format";
import {
  bioRows,
  filterSeasons,
  gameLineLabel,
  hasOtherLeagues,
  playerSubtitle,
  seasonLineLabel,
} from "../../src/ui/player";
import { LEAGUE, useSportsData } from "../../src/ui/sports-data-context";
import { tabular, useColors } from "../../src/ui/theme";
import { usePolled } from "../../src/ui/use-polled";

/** A player page that fails to render keeps the header, so Back still returns to where you came from. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CrashScreen error={error} retry={retry} />;
}

/** A row of stats, each value over its label. Nothing when empty. */
function Tiles({ items }: { items: StatItem[] }) {
  const colors = useColors();
  if (items.length === 0) return null;
  return (
    <View style={styles.tiles}>
      {items.map((item) => (
        <View key={item.label} style={styles.tile} accessible accessibilityLabel={`${item.value} ${item.label}`}>
          <Text style={[styles.tileValue, tabular, { color: colors.text }]}>{item.value}</Text>
          <Text style={[styles.tileLabel, { color: colors.muted }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionTitle, { color: colors.muted }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sports = useSportsData();
  const colors = useColors();
  const router = useRouter();
  const detail = usePolled(`player:${id}`, (o) => sports.getPlayer(LEAGUE, id, o));
  const [playoffs, setPlayoffs] = useState(false);
  const [allLeagues, setAllLeagues] = useState(false);

  if (detail.loading) return <Loading />;
  if (!detail.data) {
    return (
      <ErrorView
        title="Couldn't load this player"
        error={detail.error ?? new Error("Unknown error")}
        onRetry={detail.refresh}
      />
    );
  }

  const d = detail.data;
  const { team } = d;
  const bio = bioRows(d, localDate());
  const hasPlayoffs = d.seasons.rows.some((r) => r.playoffs);
  const seasons = filterSeasons(d.seasons.rows, { playoffs: playoffs && hasPlayoffs, allLeagues });

  return (
    <>
      <Stack.Screen options={{ title: d.player.name }} />
      <OfflineBanner meta={detail.meta} />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={detail.refreshing} onRefresh={detail.refresh} colors={[colors.accent]} />
        }
      >
        <View style={[styles.card, styles.header, { backgroundColor: colors.card }]}>
          <PlayerHeadshot player={d.player} size={88} />
          <View style={styles.headerText}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={2} accessibilityRole="header">
              {d.player.name}
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>{playerSubtitle(d)}</Text>
            {team && (
              <Pressable
                onPress={() => router.push({ pathname: "/team/[id]", params: { id: team.id } })}
                accessibilityRole="button"
                accessibilityLabel={`${team.name}, open team page`}
                style={styles.teamLink}
                hitSlop={6}
              >
                <TeamLogo team={team} size={22} />
                <Text style={[styles.teamName, { color: colors.accent }]} numberOfLines={1}>
                  {team.name}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {d.season.length > 0 && (
          <>
            <SectionTitle>{d.seasonLabel ? `${d.seasonLabel} season` : "This season"}</SectionTitle>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <Tiles items={d.season} />
            </View>
          </>
        )}

        {d.lastGames.games.length > 0 && (
          <>
            <SectionTitle>Last games</SectionTitle>
            <StatGrid
              title="Game"
              columns={d.lastGames.columns}
              rows={d.lastGames.games.map((g) => ({
                key: g.gameId,
                label: gameLineLabel(g),
                values: g.values,
                onPress: () => router.push({ pathname: "/game/[id]", params: { id: g.gameId } }),
                accessibilityLabel: `${gameLineLabel(g)}, open game`,
              }))}
            />
          </>
        )}

        {bio.length > 0 && (
          <>
            <SectionTitle>Bio</SectionTitle>
            <View style={[styles.card, styles.list, { backgroundColor: colors.card }]}>
              {bio.map((row, i) => (
                <View
                  key={row.label}
                  style={[
                    styles.bioRow,
                    i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  <Text style={[styles.bioLabel, { color: colors.muted }]}>{row.label}</Text>
                  <Text style={[styles.bioValue, { color: colors.text }]}>{row.value}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {(d.career.regularSeason.length > 0 || d.career.playoffs.length > 0) && (
          <>
            <SectionTitle>Career</SectionTitle>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              {d.career.regularSeason.length > 0 && (
                <>
                  <Text style={[styles.careerLabel, { color: colors.muted }]}>Regular season</Text>
                  <Tiles items={d.career.regularSeason} />
                </>
              )}
              {d.career.playoffs.length > 0 && (
                <View style={d.career.regularSeason.length > 0 && [styles.divided, { borderTopColor: colors.border }]}>
                  <Text style={[styles.careerLabel, { color: colors.muted }]}>Playoffs</Text>
                  <Tiles items={d.career.playoffs} />
                </View>
              )}
            </View>
          </>
        )}

        {d.seasons.rows.length > 0 && (
          <>
            <SectionTitle>By season</SectionTitle>
            {hasPlayoffs && (
              <Segmented
                options={[
                  { value: "regular", label: "Regular season" },
                  { value: "playoffs", label: "Playoffs" },
                ]}
                value={playoffs ? "playoffs" : "regular"}
                onChange={(v) => setPlayoffs(v === "playoffs")}
              />
            )}
            {hasOtherLeagues(d.seasons.rows) && (
              <View style={styles.switchRow}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>Include other leagues</Text>
                <Switch value={allLeagues} onValueChange={setAllLeagues} accessibilityLabel="Include other leagues" />
              </View>
            )}
            {seasons.length === 0 ? (
              <Text style={[styles.none, { color: colors.muted }]}>
                {playoffs ? "No playoff games." : "No seasons to show."}
              </Text>
            ) : (
              <StatGrid
                title="Season"
                columns={d.seasons.columns}
                rows={seasons.map((s, i) => ({
                  key: `${s.season}-${s.league}-${s.team}-${i}`,
                  ...seasonLineLabel(s),
                  values: s.values,
                }))}
              />
            )}
          </>
        )}
        <UpdatedAt meta={detail.meta} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginTop: 8, marginBottom: 4, borderRadius: 12, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 12 },
  headerText: { flex: 1, gap: 4 },
  name: { fontSize: 22, fontWeight: "800" },
  subtitle: { fontSize: 13 },
  teamLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  teamName: { flexShrink: 1, fontSize: 14, fontWeight: "600" },
  sectionTitle: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginHorizontal: 16, marginTop: 14 },
  tiles: { flexDirection: "row", flexWrap: "wrap", rowGap: 12 },
  tile: { width: "25%", alignItems: "center" },
  tileValue: { fontSize: 18, fontWeight: "700" },
  tileLabel: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  list: { paddingVertical: 4 },
  bioRow: { flexDirection: "row", paddingVertical: 10, gap: 12 },
  bioLabel: { width: 82, fontSize: 13, fontWeight: "600" },
  bioValue: { flex: 1, fontSize: 14 },
  careerLabel: { fontSize: 12, fontWeight: "600", marginBottom: 8 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 12 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginVertical: 4,
  },
  switchLabel: { fontSize: 14 },
  none: { fontSize: 14, marginHorizontal: 16, marginVertical: 12 },
});
