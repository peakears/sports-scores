import type { StatColumn } from "../../domain";

export const LEAGUE = "nhl" as const;
export const DEFAULT_BASE_URL = "https://api-web.nhle.com/v1";
export const DEFAULT_TIMEOUT_MS = 10_000;

export const SKATER_COLUMNS: StatColumn[] = [
  { key: "goals", label: "G" },
  { key: "assists", label: "A" },
  { key: "points", label: "PTS" },
  { key: "plusMinus", label: "+/-" },
  { key: "sog", label: "SOG" },
  { key: "hits", label: "HIT" },
  { key: "pim", label: "PIM" },
  { key: "toi", label: "TOI" },
];

export const GOALIE_COLUMNS: StatColumn[] = [
  { key: "saves", label: "SV" },
  { key: "shotsAgainst", label: "SA" },
  { key: "goalsAgainst", label: "GA" },
  { key: "savePctg", label: "SV%" },
  { key: "toi", label: "TOI" },
];

// Season totals on the team page. Keys are the raw response fields, except `toi` (formatted from seconds).
export const SEASON_SKATER_COLUMNS: StatColumn[] = [
  { key: "gamesPlayed", label: "GP" },
  { key: "goals", label: "G" },
  { key: "assists", label: "A" },
  { key: "points", label: "PTS" },
  { key: "plusMinus", label: "+/-" },
  { key: "penaltyMinutes", label: "PIM" },
  { key: "powerPlayGoals", label: "PPG" },
  { key: "shots", label: "SOG" },
  { key: "shootingPctg", label: "S%" },
  { key: "toi", label: "TOI" }, // per game
];

export const SEASON_GOALIE_COLUMNS: StatColumn[] = [
  { key: "gamesPlayed", label: "GP" },
  { key: "gamesStarted", label: "GS" },
  { key: "wins", label: "W" },
  { key: "losses", label: "L" },
  { key: "overtimeLosses", label: "OTL" },
  { key: "goalsAgainstAverage", label: "GAA" },
  { key: "savePercentage", label: "SV%" },
  { key: "shotsAgainst", label: "SA" },
  { key: "shutouts", label: "SO" },
];

/** How many recent and upcoming games the team page keeps. */
export const TEAM_GAMES_SHOWN = 5;

// In display order: points first, as the league and most apps list them.
export const SKATER_LEADER_CATEGORIES = ["points", "goals", "assists"];
export const GOALIE_LEADER_CATEGORIES = ["wins", "savePctg", "goalsAgainstAverage", "shutouts"];

export const LEADER_LABELS: Record<string, string> = {
  goals: "Goals",
  assists: "Assists",
  points: "Points",
  wins: "Wins",
  savePctg: "Save percentage",
  goalsAgainstAverage: "Goals against average",
  shutouts: "Shutouts",
};
