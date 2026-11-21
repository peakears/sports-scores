import type { PlayerBio, PlayerDetail, PlayerGameLine, PlayerSeasonLine } from "../domain";

/**
 * Text for the player page. Pure (no React Native imports), so it is unit tested.
 */

const POSITIONS: Record<string, string> = { C: "Centre", L: "Left wing", R: "Right wing", D: "Defence", G: "Goalie" };

/** "Centre"; an unknown code is shown as sent. */
export function positionLabel(code: string | undefined): string | undefined {
  return code === undefined ? undefined : (POSITIONS[code] ?? code);
}

/** Whole years between a YYYY-MM-DD birth date and `today` (YYYY-MM-DD, local). */
export function ageOn(birthDate: string, today: string): number | undefined {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!b || !t) return undefined;
  const [by, bm, bd] = b.slice(1).map(Number);
  const [ty, tm, td] = t.slice(1).map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 19" from YYYY-MM-DD (no time zone involved: the date is the game's own). */
export function shortDate(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${MONTHS[Number(m[1]) - 1] ?? m[1]} ${Number(m[2])}`;
}

/** "Dec 8, 1989". */
export function longDate(date: string): string {
  const year = /^(\d{4})-/.exec(date)?.[1];
  return year ? `${shortDate(date)}, ${year}` : date;
}

/** Height in both systems: 6′1″ (185 cm). Either part may be missing. */
export function heightLabel(bio: PlayerBio): string | undefined {
  const imperial = bio.heightIn === undefined ? undefined : `${Math.floor(bio.heightIn / 12)}′${bio.heightIn % 12}″`;
  const metric = bio.heightCm === undefined ? undefined : `${bio.heightCm} cm`;
  if (imperial && metric) return `${imperial} (${metric})`;
  return imperial ?? metric;
}

/** 210 lb (95 kg). */
export function weightLabel(bio: PlayerBio): string | undefined {
  const lb = bio.weightLb === undefined ? undefined : `${bio.weightLb} lb`;
  const kg = bio.weightKg === undefined ? undefined : `${bio.weightKg} kg`;
  if (lb && kg) return `${lb} (${kg})`;
  return lb ?? kg;
}

/** "Shoots right" for skaters, "Catches left" for goalies. */
export function handednessLabel(handedness: string | undefined, goalie: boolean): string | undefined {
  const side = handedness === "L" ? "left" : handedness === "R" ? "right" : undefined;
  return side && `${goalie ? "Catches" : "Shoots"} ${side}`;
}

/** "2008, round 1, #2 overall by LAK", or "Undrafted" when the league has no draft record. */
export function draftLabel(bio: PlayerBio): string {
  const d = bio.draft;
  if (!d) return "Undrafted";
  return `${d.year}, round ${d.round}, #${d.overallPick} overall by ${d.teamId}`;
}

/** The facts under the player's name, each as label and value, leaving out what is unknown. */
export function bioRows(detail: PlayerDetail, today: string): { label: string; value: string }[] {
  const { bio } = detail;
  const age = bio.birthDate ? ageOn(bio.birthDate, today) : undefined;
  const rows: { label: string; value: string | undefined }[] = [
    {
      label: "Born",
      value: bio.birthDate ? `${longDate(bio.birthDate)}${age !== undefined ? ` (age ${age})` : ""}` : undefined,
    },
    { label: "Birthplace", value: bio.birthPlace },
    { label: "Height", value: heightLabel(bio) },
    { label: "Weight", value: weightLabel(bio) },
    {
      label: detail.goalie ? "Catches" : "Shoots",
      value: handednessLabel(bio.handedness, detail.goalie)?.split(" ")[1],
    },
    { label: "Draft", value: draftLabel(bio) },
  ];
  return rows.filter((r): r is { label: string; value: string } => r.value !== undefined);
}

/** "LAK · #8 · Defence", or "Not on a team" for a player without one. */
export function playerSubtitle(detail: PlayerDetail): string {
  const parts = [
    detail.team?.abbrev,
    detail.sweaterNumber !== undefined ? `#${detail.sweaterNumber}` : undefined,
    positionLabel(detail.player.position),
  ].filter(Boolean);
  if (!detail.active) parts.push("Inactive");
  return parts.join(" · ");
}

/** "Nov 19 @ TOR" for a road game, "Nov 19 vs TOR" at home (or when unknown). */
export function gameLineLabel(game: PlayerGameLine): string {
  return `${shortDate(game.date)} ${game.home === false ? "@" : "vs"} ${game.opponentId}`;
}

export interface SeasonFilter {
  playoffs: boolean;
  /** Show seasons outside the app's league (junior, minor leagues, international). */
  allLeagues: boolean;
}

/** The season lines to show: regular season or playoffs, this league only unless `allLeagues`. */
export function filterSeasons(rows: PlayerSeasonLine[], filter: SeasonFilter): PlayerSeasonLine[] {
  return rows.filter((r) => r.playoffs === filter.playoffs && (filter.allLeagues || r.inLeague));
}

/** True when the player has seasons outside the app's league, so the "All leagues" switch is worth showing. */
export function hasOtherLeagues(rows: PlayerSeasonLine[]): boolean {
  return rows.some((r) => !r.inLeague);
}

/** The first column of a season line: "2026-27 Kings", with the league added outside this app's league. */
export function seasonLineLabel(row: PlayerSeasonLine): { label: string; detail?: string } {
  return { label: `${row.season} ${row.team}`, detail: row.inLeague ? undefined : row.league };
}
