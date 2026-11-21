import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StatColumn } from "../../domain";
import { statValue } from "../format";
import { tabular, useColors } from "../theme";

const NAME_WIDTH = 150;
const COLUMN_WIDTH = 48;

export interface StatGridRow {
  key: string;
  /** The fixed first column: a player name, a season, a game. */
  label: string;
  /** A smaller second line under the label. */
  detail?: string;
  /** Keyed by StatColumn.key; a missing key shows "-". */
  values: Record<string, string | number>;
  /** Makes the label a link (a player page, a game). */
  onPress?: () => void;
  accessibilityLabel?: string;
}

/**
 * A stats table for any sport: the first column stays put and the stat columns scroll sideways
 * when they do not fit. Rows with `onPress` open something when their label is tapped.
 */
export function StatGrid({ title, columns, rows }: { title: string; columns: StatColumn[]; rows: StatGridRow[] }) {
  const colors = useColors();
  if (rows.length === 0) return null;
  const rowHeight = rows.some((r) => r.detail) ? 44 : 34;
  const rowStyle = [styles.row, { height: rowHeight, borderTopColor: colors.border }];

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.inner}>
        <View style={{ width: NAME_WIDTH }}>
          <Text style={[styles.header, { color: colors.muted }]}>{title}</Text>
          {rows.map((row) => {
            const text = (
              <>
                <Text numberOfLines={1} style={[styles.cell, { color: row.onPress ? colors.accent : colors.text }]}>
                  {row.label}
                </Text>
                {row.detail ? (
                  <Text numberOfLines={1} style={[styles.detail, { color: colors.muted }]}>
                    {row.detail}
                  </Text>
                ) : null}
              </>
            );
            return row.onPress ? (
              <Pressable
                key={row.key}
                onPress={row.onPress}
                style={rowStyle}
                accessibilityRole="button"
                accessibilityLabel={row.accessibilityLabel ?? row.label}
              >
                {text}
              </Pressable>
            ) : (
              <View key={row.key} style={rowStyle}>
                {text}
              </View>
            );
          })}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={styles.cols}>
              {columns.map((c) => (
                <Text key={c.key} style={[styles.header, styles.num, { color: colors.muted }]}>
                  {c.label}
                </Text>
              ))}
            </View>
            {rows.map((row) => (
              <View key={row.key} style={[rowStyle, styles.cols]}>
                {columns.map((c) => (
                  <Text key={c.key} style={[styles.cell, styles.num, tabular, { color: colors.text }]}>
                    {statValue(row.values[c.key])}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, marginHorizontal: 12, marginBottom: 12, paddingVertical: 6, paddingLeft: 12 },
  inner: { flexDirection: "row" },
  cols: { flexDirection: "row", alignItems: "center" },
  header: { fontSize: 12, fontWeight: "700", paddingVertical: 6, textTransform: "uppercase" },
  row: { justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth },
  cell: { fontSize: 14 },
  detail: { fontSize: 11, marginTop: 1 },
  num: { width: COLUMN_WIDTH, textAlign: "right", paddingRight: 8 },
});
