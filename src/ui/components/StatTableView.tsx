import { useRouter } from "expo-router";
import type { StatTable } from "../../domain";
import { StatGrid } from "./StatGrid";

/**
 * A table of players (box score, team season stats). Each name opens that player's page, unless
 * `linkPlayers` is false.
 */
export function StatTableView({ table, linkPlayers = true }: { table: StatTable; linkPlayers?: boolean }) {
  const router = useRouter();
  return (
    <StatGrid
      title={table.title}
      columns={table.columns}
      rows={table.rows.map((row) => ({
        key: row.player.id,
        label: row.player.name,
        values: row.values,
        onPress: linkPlayers
          ? () => router.push({ pathname: "/player/[id]", params: { id: row.player.id } })
          : undefined,
        accessibilityLabel: `${row.player.name}, open player page`,
      }))}
    />
  );
}
