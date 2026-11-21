// Raw response shapes for the unofficial NHL web API, as zod schemas.
// The TypeScript types below are inferred from them, so there is one source of truth.
//
// Verified against live responses on 2026-11-17 (season 20262027): /score,
// /gamecenter/{id}/boxscore (live and final), /standings/now, and both
// stats-leaders endpoints. /gamecenter/{id}/landing (three stars only): 2026-11-20.
//
// Core fields (plain schemas) throw on mismatch. Minor fields (`minor()`) are
// dropped with a warning. See validate.ts for the policy.

import { z } from "zod";
import { lenientArray, minor } from "./validate";

const num = (field: string) => minor(z.number(), field);
const str = (field: string) => minor(z.string(), field);
const bool = (field: string) => minor(z.boolean(), field);

export const LocalizedSchema = z.object({
  default: z.string(),
  fr: str("fr"),
});
const localized = (field: string) => minor(LocalizedSchema, field);

// ---------- Games (/score, /gamecenter/{id}/boxscore) ----------

export const RawTeamSchema = z.object({
  abbrev: z.string(),
  score: z.number().optional(), // absent before the game starts
  id: num("team.id"),
  name: localized("team.name"), // /score only, e.g. "Bruins"
  commonName: localized("team.commonName"), // boxscore only, e.g. "Bruins"
  placeName: localized("team.placeName"), // boxscore only, e.g. "Boston"
  sog: num("team.sog"), // absent before the game starts
  logo: str("team.logo"), // light-background SVG
  darkLogo: str("team.darkLogo"), // boxscore only
  record: str("team.record"), // scheduled games in /score only, "8-10-3"
});

export const RawPeriodDescriptorSchema = z.object({
  number: z.number(),
  periodType: z.string(), // "REG" | "OT" | "SO"
  maxRegulationPeriods: num("periodDescriptor.maxRegulationPeriods"),
});

export const RawClockSchema = z.object({
  // During an intermission this counts down the intermission, not the period.
  timeRemaining: str("clock.timeRemaining"), // "03:05"
  secondsRemaining: num("clock.secondsRemaining"),
  running: bool("clock.running"),
  inIntermission: bool("clock.inIntermission"),
});

// One TV listing. "N" national, "H" home team's feed, "A" away team's. Seen countries: "CA", "US".
export const RawBroadcastSchema = z.object({
  network: z.string(), // "SN", "TNT", "NESN", sometimes with a trailing space ("ABTV ")
  countryCode: z.string(),
  market: z.string(),
  sequenceNumber: num("tvBroadcasts.sequenceNumber"),
});

// One goal of the scoring summary in /score (the box score has none). Seen strength: "ev", "pp"
// ("sh" unverified); seen goalModifier: "none", "empty-net" ("penalty-shot" unverified).
export const RawGoalAssistSchema = z.object({
  playerId: z.number(),
  name: LocalizedSchema, // abbreviated, "E. Gustafsson"
});

export const RawGoalSchema = z.object({
  period: z.number(),
  periodDescriptor: minor(RawPeriodDescriptorSchema, "goals.periodDescriptor"),
  timeInPeriod: z.string(), // elapsed, "15:46"
  playerId: z.number(),
  name: LocalizedSchema, // abbreviated scorer, "M. Zuccarello"
  teamAbbrev: z.string(),
  goalModifier: str("goals.goalModifier"),
  strength: str("goals.strength"),
  assists: lenientArray(RawGoalAssistSchema, "goals.assists"),
  homeScore: num("goals.homeScore"),
  awayScore: num("goals.awayScore"),
});

export const RawGameSchema = z.object({
  id: z.number(),
  startTimeUTC: z.string(),
  // Seen: "FUT", "LIVE", "FINAL", "OFF". "PRE", "CRIT" and postponed values unverified.
  gameState: z.string(),
  homeTeam: RawTeamSchema,
  awayTeam: RawTeamSchema,
  season: num("season"), // 20262027
  gameType: num("gameType"), // 1 preseason, 2 regular season, 3 playoffs
  gameDate: str("gameDate"), // league calendar date, YYYY-MM-DD
  venue: localized("venue"), // arena, "TD Garden"
  venueLocation: localized("venueLocation"), // box score only: city, "Boston" (no state or province)
  gameScheduleState: str("gameScheduleState"), // "OK"
  periodDescriptor: minor(RawPeriodDescriptorSchema, "periodDescriptor"),
  clock: minor(RawClockSchema, "clock"),
  // Final games only: "REG" | "OT" | "SO".
  gameOutcome: minor(z.object({ lastPeriodType: z.string() }), "gameOutcome"),
  // A bad listing is dropped on its own, so TV info can never break the scores.
  tvBroadcasts: lenientArray(RawBroadcastSchema, "tvBroadcasts"),
  // /score only, in the order scored. A bad goal is dropped on its own.
  goals: lenientArray(RawGoalSchema, "goals"),
});

export const RawScoreResponseSchema = z.object({
  currentDate: str("currentDate"),
  games: z.array(RawGameSchema).optional(),
});

// ---------- Box score players ----------

export const RawSkaterSchema = z.object({
  playerId: z.number(),
  name: LocalizedSchema, // abbreviated, e.g. "J. Eichel"
  sweaterNumber: num("sweaterNumber"),
  position: str("position"), // "C" | "L" | "R" | "D"
  goals: num("goals"),
  assists: num("assists"),
  points: num("points"),
  plusMinus: num("plusMinus"),
  pim: num("pim"),
  hits: num("hits"),
  sog: num("sog"),
  blockedShots: num("blockedShots"),
  powerPlayGoals: num("powerPlayGoals"),
  faceoffWinningPctg: num("faceoffWinningPctg"), // not always present for defense
  shifts: num("shifts"),
  giveaways: num("giveaways"),
  takeaways: num("takeaways"),
  toi: str("toi"), // "17:36"
});

export const RawGoalieSchema = z.object({
  playerId: z.number(),
  name: LocalizedSchema,
  sweaterNumber: num("sweaterNumber"),
  position: str("position"), // "G"
  starter: bool("starter"), // final games only
  shotsAgainst: num("shotsAgainst"),
  saves: num("saves"),
  saveShotsAgainst: str("saveShotsAgainst"), // "23/25"
  goalsAgainst: num("goalsAgainst"),
  savePctg: num("savePctg"), // absent for a goalie who did not play
  pim: num("pim"),
  toi: str("toi"), // "00:00" for a goalie who did not play
});

export const RawSideStatsSchema = z.object({
  forwards: lenientArray(RawSkaterSchema, "forwards"),
  defense: lenientArray(RawSkaterSchema, "defense"),
  goalies: lenientArray(RawGoalieSchema, "goalies"),
});

export const RawBoxscoreSchema = RawGameSchema.extend({
  playerByGameStats: minor(
    z.object({
      homeTeam: minor(RawSideStatsSchema, "playerByGameStats.homeTeam"),
      awayTeam: minor(RawSideStatsSchema, "playerByGameStats.awayTeam"),
    }),
    "playerByGameStats",
  ),
});

// ---------- Team season stats (/club-stats/{team}/now) and schedule (/club-schedule-season/{team}/now) ----------

export const RawClubSkaterSchema = z.object({
  playerId: z.number(),
  firstName: LocalizedSchema,
  lastName: LocalizedSchema,
  headshot: str("headshot"),
  positionCode: str("positionCode"), // "C" | "L" | "R" | "D"
  gamesPlayed: num("gamesPlayed"),
  goals: num("goals"),
  assists: num("assists"),
  points: num("points"),
  plusMinus: num("plusMinus"),
  penaltyMinutes: num("penaltyMinutes"),
  powerPlayGoals: num("powerPlayGoals"),
  shots: num("shots"),
  shootingPctg: num("shootingPctg"), // 0.117647
  avgTimeOnIcePerGame: num("avgTimeOnIcePerGame"), // seconds, 1035.5714
});

export const RawClubGoalieSchema = z.object({
  playerId: z.number(),
  firstName: LocalizedSchema,
  lastName: LocalizedSchema,
  headshot: str("headshot"),
  gamesPlayed: num("gamesPlayed"),
  gamesStarted: num("gamesStarted"),
  wins: num("wins"),
  losses: num("losses"),
  overtimeLosses: num("overtimeLosses"),
  goalsAgainstAverage: num("goalsAgainstAverage"), // 3.649954
  savePercentage: num("savePercentage"), // 0.873762
  shotsAgainst: num("shotsAgainst"),
  shutouts: num("shutouts"),
});

export const RawClubStatsSchema = z.object({
  season: str("season"), // a string here ("20262027"), unlike the numeric season of the games
  gameType: num("gameType"), // 2 regular season, 3 playoffs
  skaters: lenientArray(RawClubSkaterSchema, "skaters"),
  goalies: lenientArray(RawClubGoalieSchema, "goalies"),
});

// The whole season, preseason included. Games have the same shape as in /score (`RawGameSchema`).
export const RawClubScheduleSchema = z.object({
  games: lenientArray(RawGameSchema, "games"),
});

// ---------- Standings (/standings/now) ----------

export const RawStandingSchema = z.object({
  teamAbbrev: LocalizedSchema,
  teamName: LocalizedSchema, // "Edmonton Oilers"
  gamesPlayed: z.number(),
  wins: z.number(),
  losses: z.number(),
  otLosses: z.number().optional(),
  points: z.number().optional(),
  teamCommonName: localized("teamCommonName"), // "Oilers"
  seasonId: num("seasonId"),
  date: str("date"),
  teamLogo: str("teamLogo"),
  conferenceName: str("conferenceName"),
  conferenceAbbrev: str("conferenceAbbrev"),
  divisionName: str("divisionName"),
  divisionAbbrev: str("divisionAbbrev"),
  // Rank within each grouping, 1-based. The response is sorted by leagueSequence.
  leagueSequence: num("leagueSequence"),
  conferenceSequence: num("conferenceSequence"),
  divisionSequence: num("divisionSequence"),
  wildcardSequence: num("wildcardSequence"), // 0 for teams in a division top-3 spot
  pointPctg: num("pointPctg"),
  regulationWins: num("regulationWins"),
  goalFor: num("goalFor"),
  goalAgainst: num("goalAgainst"),
  goalDifferential: num("goalDifferential"),
  streakCode: str("streakCode"), // "W" | "L" | "OT"
  streakCount: num("streakCount"),
  clinchIndicator: str("clinchIndicator"), // not present early in the season; unverified
  // Home, road and last-10 splits (all verified against the 2026-11-17 fixture).
  homeWins: num("homeWins"),
  homeLosses: num("homeLosses"),
  homeOtLosses: num("homeOtLosses"),
  homeGoalsFor: num("homeGoalsFor"),
  homeGoalsAgainst: num("homeGoalsAgainst"),
  roadWins: num("roadWins"),
  roadLosses: num("roadLosses"),
  roadOtLosses: num("roadOtLosses"),
  roadGoalsFor: num("roadGoalsFor"),
  roadGoalsAgainst: num("roadGoalsAgainst"),
  l10Wins: num("l10Wins"),
  l10Losses: num("l10Losses"),
  l10OtLosses: num("l10OtLosses"),
  l10GoalsFor: num("l10GoalsFor"),
  l10GoalsAgainst: num("l10GoalsAgainst"),
});

export const RawStandingsResponseSchema = z.object({
  standingsDateTimeUtc: str("standingsDateTimeUtc"),
  wildCardIndicator: bool("wildCardIndicator"),
  standings: z.array(RawStandingSchema).optional(),
});

// ---------- Leaders (/{skater,goalie}-stats-leaders/current) ----------

export const RawLeaderSchema = z.object({
  id: z.number(),
  firstName: LocalizedSchema,
  lastName: LocalizedSchema,
  teamAbbrev: z.string(),
  value: z.number(), // integer for counts, decimal for savePctg (0.939759) and GAA (1.4236)
  sweaterNumber: num("sweaterNumber"),
  headshot: str("headshot"),
  teamName: localized("teamName"),
  teamLogo: str("teamLogo"),
  position: str("position"),
});

// Keyed by category name, e.g. { goals: [...], assists: [...] }.
export const RawLeadersResponseSchema = z.record(z.string(), z.array(RawLeaderSchema));

// ---------- Game landing (/gamecenter/{id}/landing) ----------
// Verified on 2026-11-20 against a final game (summary.threeStars present) and a scheduled one
// (no summary at all). Live games and the short "FINAL" state are unverified. Only the three
// stars are read; the rest of the response (scoring, penalties) is ignored.

export const RawThreeStarSchema = z.object({
  star: z.number(), // 1, 2, 3
  playerId: z.number(),
  teamAbbrev: z.string(),
  name: LocalizedSchema, // abbreviated, "D. Kuemper"
  headshot: str("threeStars.headshot"),
  sweaterNo: num("threeStars.sweaterNo"),
  position: str("threeStars.position"), // "C" | "L" | "R" | "D" | "G"
  // Skaters only.
  goals: num("threeStars.goals"),
  assists: num("threeStars.assists"),
  points: num("threeStars.points"),
  // Goalies only.
  goalsAgainstAverage: num("threeStars.goalsAgainstAverage"),
  savePctg: num("threeStars.savePctg"),
});

export const RawLandingSchema = z.object({
  id: z.number(),
  summary: minor(z.object({ threeStars: lenientArray(RawThreeStarSchema, "summary.threeStars") }), "summary"),
});

// ---------- Player (/player/{id}/landing) ----------
// Verified on 2026-11-20 against a skater (Doughty) and a goalie (Kuemper). Skater and goalie rows
// share one schema: each only has its own stats, and every stat is minor. `gameTypeId` 2 is the
// regular season, 3 the playoffs.

const RawPlayerStatsSchema = z.object({
  gamesPlayed: num("gamesPlayed"),
  // Skaters.
  goals: num("goals"),
  assists: num("assists"),
  points: num("points"),
  plusMinus: num("plusMinus"),
  pim: num("pim"),
  shots: num("shots"),
  shootingPctg: num("shootingPctg"),
  powerPlayPoints: num("powerPlayPoints"),
  avgToi: str("avgToi"), // "25:55" per game
  // Goalies.
  gamesStarted: num("gamesStarted"),
  wins: num("wins"),
  losses: num("losses"),
  otLosses: num("otLosses"),
  goalsAgainstAvg: num("goalsAgainstAvg"),
  savePctg: num("savePctg"),
  shutouts: num("shutouts"),
});

export const RawPlayerSeasonSchema = RawPlayerStatsSchema.extend({
  season: z.number(), // 20262027
  gameTypeId: z.number(),
  leagueAbbrev: z.string(), // "NHL", "AHL", "OHL", "WJC-A"...
  teamName: LocalizedSchema, // "Los Angeles Kings", or "Lon. Jr. Knights" outside the NHL
  teamCommonName: localized("seasonTotals.teamCommonName"), // NHL rows only, "Kings"
});

export const RawPlayerGameSchema = z.object({
  gameId: z.number(),
  gameDate: z.string(), // "2026-11-19", local to the game
  gameTypeId: num("last5Games.gameTypeId"),
  teamAbbrev: z.string(),
  opponentAbbrev: z.string(),
  homeRoadFlag: str("last5Games.homeRoadFlag"), // "H" | "R"
  // Skaters.
  goals: num("last5Games.goals"),
  assists: num("last5Games.assists"),
  points: num("last5Games.points"),
  plusMinus: num("last5Games.plusMinus"),
  shots: num("last5Games.shots"),
  pim: num("last5Games.pim"),
  toi: str("last5Games.toi"), // "25:53"
  // Goalies.
  decision: str("last5Games.decision"), // "W" | "L" | "O"
  shotsAgainst: num("last5Games.shotsAgainst"),
  goalsAgainst: num("last5Games.goalsAgainst"),
  savePctg: num("last5Games.savePctg"),
});

export const RawPlayerLandingSchema = z.object({
  playerId: z.number(),
  firstName: LocalizedSchema,
  lastName: LocalizedSchema,
  position: z.string(), // "C" | "L" | "R" | "D" | "G"
  isActive: bool("isActive"),
  currentTeamAbbrev: str("currentTeamAbbrev"), // absent for a retired player (unverified)
  fullTeamName: localized("fullTeamName"),
  teamLogo: str("teamLogo"),
  sweaterNumber: num("sweaterNumber"),
  headshot: str("headshot"),
  heightInInches: num("heightInInches"),
  heightInCentimeters: num("heightInCentimeters"),
  weightInPounds: num("weightInPounds"),
  weightInKilograms: num("weightInKilograms"),
  birthDate: str("birthDate"), // "1989-12-08"
  birthCity: localized("birthCity"),
  birthStateProvince: localized("birthStateProvince"),
  birthCountry: str("birthCountry"), // "CAN", ISO 3166 alpha-3
  shootsCatches: str("shootsCatches"), // "L" | "R"
  draftDetails: minor(
    z.object({
      year: z.number(),
      teamAbbrev: z.string(),
      round: z.number(),
      pickInRound: z.number().optional(),
      overallPick: z.number(),
    }),
    "draftDetails",
  ),
  featuredStats: minor(
    z.object({
      season: z.number(), // 20262027
      regularSeason: minor(
        z.object({ subSeason: minor(RawPlayerStatsSchema, "featuredStats.subSeason") }),
        "featuredStats.regularSeason",
      ),
    }),
    "featuredStats",
  ),
  careerTotals: minor(
    z.object({
      regularSeason: minor(RawPlayerStatsSchema, "careerTotals.regularSeason"),
      playoffs: minor(RawPlayerStatsSchema, "careerTotals.playoffs"),
    }),
    "careerTotals",
  ),
  last5Games: lenientArray(RawPlayerGameSchema, "last5Games"),
  seasonTotals: lenientArray(RawPlayerSeasonSchema, "seasonTotals"),
});

// ---------- Inferred types ----------

export type Localized = z.output<typeof LocalizedSchema>;
export type RawTeam = z.output<typeof RawTeamSchema>;
export type RawBroadcast = z.output<typeof RawBroadcastSchema>;
export type RawGoal = z.output<typeof RawGoalSchema>;
export type RawGame = z.output<typeof RawGameSchema>;
export type RawScoreResponse = z.output<typeof RawScoreResponseSchema>;
export type RawSkater = z.output<typeof RawSkaterSchema>;
export type RawGoalie = z.output<typeof RawGoalieSchema>;
export type RawSideStats = z.output<typeof RawSideStatsSchema>;
export type RawBoxscore = z.output<typeof RawBoxscoreSchema>;
export type RawClubSkater = z.output<typeof RawClubSkaterSchema>;
export type RawClubGoalie = z.output<typeof RawClubGoalieSchema>;
export type RawClubStats = z.output<typeof RawClubStatsSchema>;
export type RawClubSchedule = z.output<typeof RawClubScheduleSchema>;
export type RawStanding = z.output<typeof RawStandingSchema>;
export type RawStandingsResponse = z.output<typeof RawStandingsResponseSchema>;
export type RawLeader = z.output<typeof RawLeaderSchema>;
export type RawLeadersResponse = z.output<typeof RawLeadersResponseSchema>;
export type RawThreeStar = z.output<typeof RawThreeStarSchema>;
export type RawLanding = z.output<typeof RawLandingSchema>;
export type RawPlayerStats = z.output<typeof RawPlayerStatsSchema>;
export type RawPlayerSeason = z.output<typeof RawPlayerSeasonSchema>;
export type RawPlayerGame = z.output<typeof RawPlayerGameSchema>;
export type RawPlayerLanding = z.output<typeof RawPlayerLandingSchema>;
