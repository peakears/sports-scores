import type {
  Broadcast,
  BroadcastMarket,
  Game,
  GameClock,
  GameEnding,
  GameSide,
  GameStar,
  GameStatus,
  Goal,
  GoalStrength,
  LeaderBoard,
  Player,
  PlayerDetail,
  PlayerGameLine,
  PlayerSeasonLine,
  RecordSplit,
  StatColumn,
  StatTable,
  Standings,
  StandingsGroup,
  StarStat,
  StatItem,
  Team,
  TeamDetail,
  Venue,
} from "../../domain";
import {
  GOALIE_COLUMNS,
  LEADER_LABELS,
  LEAGUE,
  PLAYER_GAME_GOALIE_COLUMNS,
  PLAYER_GAME_SKATER_COLUMNS,
  PLAYER_SEASON_GOALIE_COLUMNS,
  PLAYER_SEASON_SKATER_COLUMNS,
  SEASON_GOALIE_COLUMNS,
  SEASON_SKATER_COLUMNS,
  SKATER_COLUMNS,
  TEAM_GAMES_SHOWN,
} from "./constants";
import type {
  RawBoxscore,
  RawBroadcast,
  RawClubGoalie,
  RawClubSchedule,
  RawClubSkater,
  RawClubStats,
  RawGame,
  RawGoal,
  RawGoalie,
  RawLanding,
  RawLeadersResponse,
  RawPlayerGame,
  RawPlayerLanding,
  RawPlayerSeason,
  RawPlayerStats,
  RawSideStats,
  RawSkater,
  RawStandingsResponse,
  RawTeam,
  RawThreeStar,
} from "./raw-types";

// Team ids are the three-letter abbreviation everywhere, because the
// standings endpoint has no numeric team id.
export function mapTeam(raw: RawTeam): Team {
  return {
    id: raw.abbrev,
    league: LEAGUE,
    name: raw.commonName?.default ?? raw.name?.default ?? raw.abbrev,
    abbrev: raw.abbrev,
    logoUrl: raw.logo,
  };
}

export function mapStatus(state: string): GameStatus {
  switch (state) {
    case "LIVE":
    case "CRIT":
      return "live";
    case "FINAL":
    case "OFF":
      return "final";
    case "PPD":
    case "SUSP":
      return "postponed";
    default:
      return "scheduled"; // FUT, PRE, and anything new
  }
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function mapClock(raw: RawGame): GameClock | undefined {
  const pd = raw.periodDescriptor;
  if (!pd) return undefined;
  const label = pd.periodType === "SO" ? "SO" : pd.periodType === "OT" ? "OT" : ordinal(pd.number);
  // During an intermission the API's timeRemaining is the intermission countdown.
  const intermission = raw.clock?.inIntermission ?? false;
  return {
    period: pd.number,
    label,
    timeRemaining: intermission ? undefined : raw.clock?.timeRemaining,
    intermission,
    intermissionRemaining: intermission ? raw.clock?.timeRemaining : undefined,
  };
}

function mapEnding(raw: RawGame): GameEnding | undefined {
  switch (raw.gameOutcome?.lastPeriodType) {
    case "REG":
      return "regulation";
    case "OT":
      return "overtime";
    case "SO":
      return "shootout";
    default:
      return undefined;
  }
}

function mapSide(raw: RawTeam, status: GameStatus): GameSide {
  return {
    team: mapTeam(raw),
    score: status === "scheduled" ? null : (raw.score ?? 0),
    shotsOnGoal: raw.sog,
    record: raw.record,
  };
}

const MARKETS: Record<string, BroadcastMarket> = { N: "national", H: "home", A: "away" };

/** Keeps the league's order, drops listings with an unknown market or no name, and drops repeats. */
function mapBroadcasts(raw: RawBroadcast[] | undefined): Broadcast[] | undefined {
  if (!raw) return undefined;
  const seen = new Set<string>();
  const out: Broadcast[] = [];
  for (const b of raw) {
    const market = MARKETS[b.market];
    const network = b.network.trim();
    const country = b.countryCode.trim().toUpperCase();
    if (!market || !network || !country) continue;
    const key = `${country}|${market}|${network.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ network, country, market });
  }
  return out;
}

function mapVenue(raw: RawGame): Venue | undefined {
  const name = raw.venue?.default.trim();
  if (!name) return undefined;
  return { name, city: raw.venueLocation?.default.trim() || undefined };
}

export function mapGame(raw: RawGame): Game {
  const status = mapStatus(raw.gameState);
  return {
    id: String(raw.id),
    league: LEAGUE,
    startTime: raw.startTimeUTC,
    status,
    clock: status === "live" ? mapClock(raw) : undefined,
    endedIn: status === "final" ? mapEnding(raw) : undefined,
    home: mapSide(raw.homeTeam, status),
    away: mapSide(raw.awayTeam, status),
    broadcasts: mapBroadcasts(raw.tvBroadcasts),
    venue: mapVenue(raw),
  };
}

const STRENGTHS: Record<string, GoalStrength> = { pp: "powerPlay", sh: "shortHanded" };

function goalPeriodLabel(raw: RawGoal): string {
  const pd = raw.periodDescriptor;
  if (pd?.periodType === "SO") return "SO";
  if (pd?.periodType === "OT") {
    // Playoff overtimes carry on from the regulation count: period 4 is OT, 5 is 2OT.
    const n = raw.period - (pd.maxRegulationPeriods ?? 3);
    return n > 1 ? `${n}OT` : "OT";
  }
  return ordinal(raw.period);
}

/** Goals in the order the API lists them (the order scored). */
export function mapGoals(raw: RawGoal[] | undefined): Goal[] | undefined {
  if (!raw) return undefined;
  return raw.map((g) => ({
    teamId: g.teamAbbrev,
    period: g.period,
    periodLabel: goalPeriodLabel(g),
    time: g.timeInPeriod,
    scorer: { id: String(g.playerId), league: LEAGUE, name: g.name.default, teamId: g.teamAbbrev },
    assists: (g.assists ?? []).map((a) => ({
      id: String(a.playerId),
      league: LEAGUE,
      name: a.name.default,
      teamId: g.teamAbbrev,
    })),
    strength: STRENGTHS[g.strength ?? ""] ?? "even",
    emptyNet: g.goalModifier === "empty-net",
    penaltyShot: g.goalModifier === "penalty-shot",
    homeScore: g.homeScore,
    awayScore: g.awayScore,
  }));
}

function mapPlayer(raw: { playerId: number; name: { default: string }; position?: string }): Player {
  return {
    id: String(raw.playerId),
    league: LEAGUE,
    name: raw.name.default,
    position: raw.position,
  };
}

function statTable<T extends RawSkater | RawGoalie>(title: string, columns: StatColumn[], rows: T[] = []): StatTable {
  return {
    title,
    columns,
    rows: rows.map((r) => {
      const record = r as unknown as Record<string, string | number | undefined>;
      const values: Record<string, string | number> = {};
      for (const c of columns) {
        const v = record[c.key];
        // Leave missing stats out instead of showing 0 (e.g. a backup goalie has no savePctg).
        if (v !== undefined && v !== null) values[c.key] = v;
      }
      return { player: mapPlayer(r), values };
    }),
  };
}

export function mapBoxscoreSide(stats?: RawSideStats): StatTable[] {
  return [
    statTable("Forwards", SKATER_COLUMNS, stats?.forwards),
    statTable("Defense", SKATER_COLUMNS, stats?.defense),
    statTable("Goalies", GOALIE_COLUMNS, stats?.goalies),
  ];
}

// ---------- Three stars ----------

/** ".905", or "1.000" for a perfect game (hockey writes save percentage without the leading zero). */
export function savePctLabel(value: number): string {
  return value >= 1 ? "1.000" : value.toFixed(3).replace(/^0/, "");
}

function starStats(star: RawThreeStar, skater?: RawSkater, goalie?: RawGoalie): StarStat[] {
  const stats: StarStat[] = [];
  const add = (value: string | number | undefined, label: string) => {
    if (value !== undefined) stats.push({ value: String(value), label });
  };
  if (star.position === "G" || goalie) {
    // The landing only has GAA and SV%; the box score adds the saves.
    add(goalie?.saves, goalie?.saves === 1 ? "save" : "saves");
    const pct = star.savePctg ?? goalie?.savePctg;
    add(pct === undefined ? undefined : savePctLabel(pct), "SV%");
  } else {
    add(star.goals ?? skater?.goals, "G");
    add(star.assists ?? skater?.assists, "A");
    add(skater?.toi, "TOI");
  }
  return stats;
}

/**
 * The three stars from the landing response, first star first, with saves and ice time from the
 * box score (matched by player id). Undefined until the league names them.
 */
export function mapThreeStars(landing: RawLanding, boxscore?: RawBoxscore): GameStar[] | undefined {
  const stars = landing.summary?.threeStars;
  if (!stars || stars.length === 0) return undefined;
  const sides = [boxscore?.playerByGameStats?.homeTeam, boxscore?.playerByGameStats?.awayTeam];
  const skaters = sides.flatMap((s) => [...(s?.forwards ?? []), ...(s?.defense ?? [])]);
  const goalies = sides.flatMap((s) => s?.goalies ?? []);
  return [...stars]
    .sort((a, b) => a.star - b.star)
    .map((star) => ({
      rank: star.star,
      player: {
        id: String(star.playerId),
        league: LEAGUE,
        name: star.name.default,
        teamId: star.teamAbbrev,
        position: star.position,
        headshotUrl: star.headshot,
      },
      sweaterNumber: star.sweaterNo,
      stats: starStats(
        star,
        skaters.find((p) => p.playerId === star.playerId),
        goalies.find((p) => p.playerId === star.playerId),
      ),
    }));
}

type RawStanding = NonNullable<RawStandingsResponse["standings"]>[number];

/** One of the home/road/last-10 splits, or undefined if the response lacks its wins or losses. */
function mapSplit(s: RawStanding, prefix: "home" | "road" | "l10"): RecordSplit | undefined {
  const wins = s[`${prefix}Wins`];
  const losses = s[`${prefix}Losses`];
  if (wins === undefined || losses === undefined) return undefined;
  return {
    wins,
    losses,
    otLosses: s[`${prefix}OtLosses`],
    goalsFor: s[`${prefix}GoalsFor`],
    goalsAgainst: s[`${prefix}GoalsAgainst`],
  };
}

export function mapStandings(raw: RawStandingsResponse): Standings {
  const groups = new Map<string, StandingsGroup>();

  // The API returns teams sorted by points, so index order is rank order.
  for (const s of raw.standings ?? []) {
    const name = s.divisionName ?? s.divisionAbbrev ?? "League";
    let group = groups.get(name);
    if (!group) {
      group = { name, rows: [] };
      groups.set(name, group);
    }
    group.rows.push({
      team: {
        id: s.teamAbbrev.default,
        league: LEAGUE,
        // Match the other endpoints, which use the common name ("Oilers", not "Edmonton Oilers").
        name: s.teamCommonName?.default ?? s.teamName.default,
        abbrev: s.teamAbbrev.default,
        logoUrl: s.teamLogo,
      },
      rank: group.rows.length + 1,
      gamesPlayed: s.gamesPlayed,
      wins: s.wins,
      losses: s.losses,
      otLosses: s.otLosses,
      points: s.points,
      streak: s.streakCode && s.streakCount ? `${s.streakCode}${s.streakCount}` : undefined,
      goalsFor: s.goalFor,
      goalsAgainst: s.goalAgainst,
      goalDifferential: s.goalDifferential,
      last10: mapSplit(s, "l10"),
      home: mapSplit(s, "home"),
      road: mapSplit(s, "road"),
      divisionName: s.divisionName,
    });
  }

  return {
    league: LEAGUE,
    groups: [...groups.values()],
    updatedAt: new Date().toISOString(),
  };
}

// Standard competition ranking: tied values share a rank (1, 2, 2, 4).
// The API returns each list already sorted best-first.
function competitionRanks(values: number[]): number[] {
  return values.map((v, i) => {
    let first = i;
    while (first > 0 && values[first - 1] === v) first--;
    return first + 1;
  });
}

export function mapLeaders(raw: RawLeadersResponse, categories: string[]): LeaderBoard[] {
  return categories.map((key) => {
    const list = raw[key] ?? [];
    const ranks = competitionRanks(list.map((l) => l.value));
    return {
      category: key,
      label: LEADER_LABELS[key] ?? key,
      entries: list.map((l, i) => ({
        rank: ranks[i],
        player: {
          id: String(l.id),
          league: LEAGUE,
          name: `${l.firstName.default} ${l.lastName.default}`,
          teamId: l.teamAbbrev,
          position: l.position,
          headshotUrl: l.headshot,
        },
        team: {
          id: l.teamAbbrev,
          league: LEAGUE,
          name: l.teamName?.default ?? l.teamAbbrev,
          abbrev: l.teamAbbrev,
          logoUrl: l.teamLogo,
        },
        value: l.value,
      })),
    };
  });
}

// ---------- Team page ----------

/** Seconds as "17:16" (minutes are not wrapped, so a goalie's season total reads "838:22"). */
function clock(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

type SeasonRow = RawClubSkater | RawClubGoalie;

function seasonPlayer(raw: SeasonRow, position?: string): Player {
  return {
    id: String(raw.playerId),
    league: LEAGUE,
    name: `${raw.firstName.default} ${raw.lastName.default}`,
    position,
    headshotUrl: raw.headshot,
  };
}

/** A season table: values come from the raw fields named by the column keys (missing ones are left out). */
function seasonTable<T extends SeasonRow>(
  title: string,
  columns: StatColumn[],
  rows: T[],
  extra: (raw: T) => Record<string, string | number>,
  position: (raw: T) => string | undefined,
  rank: (a: T, b: T) => number,
): StatTable {
  const sorted = [...rows].sort((a, b) => rank(a, b) || seasonPlayer(a).name.localeCompare(seasonPlayer(b).name));
  return {
    title,
    columns,
    rows: sorted.map((r) => {
      const record = { ...(r as unknown as Record<string, string | number | undefined>), ...extra(r) };
      const values: Record<string, string | number> = {};
      for (const c of columns) {
        const v = record[c.key];
        if (v !== undefined && v !== null) values[c.key] = v;
      }
      return { player: seasonPlayer(r, position(r)), values };
    }),
  };
}

const num0 = (n: number | undefined) => n ?? 0;

/** Forwards and defensemen ranked by points (then goals), goalies by games started. Empty tables are left out. */
export function mapClubStats(raw: RawClubStats): StatTable[] {
  const skaters = raw.skaters ?? [];
  const isDefense = (s: RawClubSkater) => s.positionCode === "D";
  const bySkaterScoring = (a: RawClubSkater, b: RawClubSkater) =>
    num0(b.points) - num0(a.points) || num0(b.goals) - num0(a.goals);
  const skaterExtra = (s: RawClubSkater): Record<string, string> =>
    s.avgTimeOnIcePerGame === undefined ? {} : { toi: clock(s.avgTimeOnIcePerGame) };

  const tables = [
    seasonTable(
      "Forwards",
      SEASON_SKATER_COLUMNS,
      skaters.filter((s) => !isDefense(s)),
      skaterExtra,
      (s) => s.positionCode,
      bySkaterScoring,
    ),
    seasonTable(
      "Defense",
      SEASON_SKATER_COLUMNS,
      skaters.filter(isDefense),
      skaterExtra,
      (s) => s.positionCode,
      bySkaterScoring,
    ),
    seasonTable(
      "Goalies",
      SEASON_GOALIE_COLUMNS,
      raw.goalies ?? [],
      () => ({}),
      () => "G",
      (a, b) => num0(b.gamesStarted) - num0(a.gamesStarted) || num0(b.gamesPlayed) - num0(a.gamesPlayed),
    ),
  ];
  return tables.filter((t) => t.rows.length > 0);
}

/**
 * The games around now from a team's season schedule: the last few that started (newest first) and the
 * next few still to play (soonest first). Preseason games and postponed ones are left out.
 */
/** The venue used by most of the team's home games, so a one-off outdoor or neutral-site game does not win. */
function homeArena(games: Game[], teamId: string): string | undefined {
  const counts = new Map<string, number>();
  for (const g of games) {
    if (g.home.team.id === teamId && g.venue) counts.set(g.venue.name, (counts.get(g.venue.name) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [name, n] of counts) if (best === undefined || n > (counts.get(best) ?? 0)) best = name;
  return best;
}

export function mapTeamSchedule(
  raw: RawClubSchedule,
  teamId: string,
): Pick<TeamDetail, "recent" | "upcoming" | "arena"> {
  const games = (raw.games ?? [])
    .filter((g) => g.gameType !== 1) // 1 is preseason
    .map(mapGame)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  return {
    arena: homeArena(games, teamId),
    recent: games
      .filter((g) => g.status === "final" || g.status === "live")
      .slice(-TEAM_GAMES_SHOWN)
      .reverse(),
    upcoming: games.filter((g) => g.status === "scheduled").slice(0, TEAM_GAMES_SHOWN),
  };
}

// ---------- Player page ----------

/** 20262027 as "2026-27". */
export function seasonLabel(season: number): string {
  const start = Math.floor(season / 10000);
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Values for the given columns, leaving out stats the response does not have. */
function pick(record: Record<string, unknown>, columns: { key: string }[]): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const { key } of columns) {
    const v = record[key];
    if (typeof v === "number" || typeof v === "string") values[key] = v;
  }
  return values;
}

/** Stats as value/label pairs in the given order; missing ones are left out. */
function items(
  stats: RawPlayerStats | undefined,
  fields: [keyof RawPlayerStats, string, (n: number) => string][],
): StatItem[] {
  if (!stats) return [];
  return fields.flatMap(([key, label, format]) => {
    const v = stats[key];
    return typeof v === "number" ? [{ value: format(v), label }] : [];
  });
}

const whole = (n: number) => String(n);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const gaa = (n: number) => n.toFixed(2);

const SKATER_SEASON: [keyof RawPlayerStats, string, (n: number) => string][] = [
  ["gamesPlayed", "GP", whole],
  ["goals", "G", whole],
  ["assists", "A", whole],
  ["points", "PTS", whole],
  ["plusMinus", "+/-", signed],
  ["pim", "PIM", whole],
  ["powerPlayPoints", "PPP", whole],
  ["shootingPctg", "S%", pct],
];

const GOALIE_SEASON: [keyof RawPlayerStats, string, (n: number) => string][] = [
  ["gamesPlayed", "GP", whole],
  ["wins", "W", whole],
  ["losses", "L", whole],
  ["otLosses", "OTL", whole],
  ["goalsAgainstAvg", "GAA", gaa],
  ["savePctg", "SV%", savePctLabel],
  ["shutouts", "SO", whole],
];

function playerGame(raw: RawPlayerGame, columns: { key: string }[]): PlayerGameLine {
  return {
    gameId: String(raw.gameId),
    date: raw.gameDate,
    teamId: raw.teamAbbrev,
    opponentId: raw.opponentAbbrev,
    home: raw.homeRoadFlag === undefined ? undefined : raw.homeRoadFlag === "H",
    values: pick(raw, columns),
  };
}

function playerSeason(raw: RawPlayerSeason, columns: { key: string }[]): PlayerSeasonLine {
  const inLeague = raw.leagueAbbrev === "NHL";
  return {
    season: seasonLabel(raw.season),
    team: (inLeague ? raw.teamCommonName?.default : undefined) ?? raw.teamName.default,
    league: raw.leagueAbbrev,
    inLeague,
    playoffs: raw.gameTypeId === 3,
    values: pick(raw, columns),
  };
}

/** "London, Ontario, CAN", skipping parts that are missing. */
function birthPlace(raw: RawPlayerLanding): string | undefined {
  const parts = [raw.birthCity?.default, raw.birthStateProvince?.default, raw.birthCountry].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function mapPlayerDetail(raw: RawPlayerLanding): PlayerDetail {
  const goalie = raw.position === "G";
  const teamId = raw.currentTeamAbbrev;
  const gameColumns = goalie ? PLAYER_GAME_GOALIE_COLUMNS : PLAYER_GAME_SKATER_COLUMNS;
  const seasonColumns = goalie ? PLAYER_SEASON_GOALIE_COLUMNS : PLAYER_SEASON_SKATER_COLUMNS;
  const seasonFields = goalie ? GOALIE_SEASON : SKATER_SEASON;
  // Career lines are shorter than a season's: the headline numbers only.
  const careerFields = goalie
    ? GOALIE_SEASON.filter(([k]) => ["gamesPlayed", "wins", "goalsAgainstAvg", "savePctg", "shutouts"].includes(k))
    : SKATER_SEASON.filter(([k]) => ["gamesPlayed", "goals", "assists", "points"].includes(k));
  const featured = raw.featuredStats;
  // The API lists seasons oldest first, so reversed they are newest first. Within a season this puts
  // the team a player joined last first. (`sequence` is not a usable order: outside the NHL it holds
  // large ids.) The sort is stable, so it only fixes seasons the API sent out of order.
  const seasons = [...(raw.seasonTotals ?? [])]
    .reverse()
    .sort((a, b) => b.season - a.season)
    .map((r) => playerSeason(r, seasonColumns));
  const draft = raw.draftDetails;

  return {
    player: {
      id: String(raw.playerId),
      league: LEAGUE,
      name: `${raw.firstName.default} ${raw.lastName.default}`,
      teamId,
      position: raw.position,
      headshotUrl: raw.headshot,
    },
    sweaterNumber: raw.sweaterNumber,
    team: teamId
      ? { id: teamId, league: LEAGUE, name: raw.fullTeamName?.default ?? teamId, abbrev: teamId, logoUrl: raw.teamLogo }
      : undefined,
    active: raw.isActive ?? teamId !== undefined,
    goalie,
    bio: {
      birthDate: raw.birthDate,
      birthPlace: birthPlace(raw),
      heightCm: raw.heightInCentimeters,
      heightIn: raw.heightInInches,
      weightKg: raw.weightInKilograms,
      weightLb: raw.weightInPounds,
      handedness: raw.shootsCatches,
      draft: draft && {
        year: draft.year,
        teamId: draft.teamAbbrev,
        round: draft.round,
        overallPick: draft.overallPick,
      },
    },
    seasonLabel: featured ? seasonLabel(featured.season) : undefined,
    season: items(featured?.regularSeason?.subSeason, seasonFields),
    career: {
      regularSeason: items(raw.careerTotals?.regularSeason, careerFields),
      playoffs: items(raw.careerTotals?.playoffs, careerFields),
    },
    lastGames: { columns: gameColumns, games: (raw.last5Games ?? []).map((g) => playerGame(g, gameColumns)) },
    seasons: { columns: seasonColumns, rows: seasons },
  };
}
