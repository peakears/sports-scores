import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GameStar } from "../../domain";
import { starAccessibilityLabel, starIconCount, starPlayerLine, starStatLine } from "../stars";
import { tabular, useColors } from "../theme";
import { PlayerHeadshot } from "./PlayerHeadshot";

/** The game's three stars: photo, name, team and a short stat line under it for each, first star first. Each opens the player page. */
export function ThreeStars({ stars }: { stars: GameStar[] }) {
  const colors = useColors();
  const router = useRouter();
  if (stars.length === 0) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Text style={[styles.title, { color: colors.muted }]} accessibilityRole="header">
        Three stars
      </Text>
      {stars.map((star, i) => {
        const playerLine = starPlayerLine(star);
        const statLine = starStatLine(star);
        return (
          <Pressable
            key={`${star.rank}-${star.player.id}`}
            onPress={() => router.push({ pathname: "/player/[id]", params: { id: star.player.id } })}
            style={[styles.row, i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
            accessibilityRole="button"
            accessibilityLabel={`${starAccessibilityLabel(star)}. Open player page`}
          >
            {/* One icon for the first star, two for the second, three for the third. */}
            <View style={styles.rank}>
              {Array.from({ length: starIconCount(star.rank) }, (_, n) => (
                <Ionicons key={n} name="star" size={12} color={colors.accent} />
              ))}
            </View>
            <PlayerHeadshot player={star.player} />
            <View style={styles.main}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {star.player.name}
              </Text>
              {playerLine ? (
                <Text style={[styles.detail, { color: colors.muted }]} numberOfLines={1}>
                  {playerLine}
                </Text>
              ) : null}
              {/* On its own line, so the name has the full width and is never cut off for the stats. */}
              {statLine ? (
                <Text style={[styles.stats, tabular, { color: colors.text }]} numberOfLines={2}>
                  {statLine}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  title: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", paddingVertical: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  // Wide enough for three icons, so the photos line up whatever the rank.
  rank: { width: 40, flexDirection: "row", justifyContent: "center", gap: 2 },
  main: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 12, marginTop: 2 },
  stats: { fontSize: 13, fontWeight: "600", marginTop: 3 },
});
