import type { z } from "zod";
import type {
  AdapterWarning,
  Game,
  GameDetail,
  GameStar,
  Goal,
  LeaderBoard,
  LeaderQuery,
  LeagueAdapter,
  PlayerDetail,
  RequestOptions,
  Standings,
  TeamDetail,
} from "../../domain";
import { NhlClient, type NhlClientOptions } from "./client";
import { GOALIE_LEADER_CATEGORIES, LEAGUE, SKATER_LEADER_CATEGORIES } from "./constants";
import {
  mapBoxscoreSide,
  mapClubStats,
  mapGame,
  mapGoals,
  mapLeaders,
  mapStandings,
  mapPlayerDetail,
  mapTeamSchedule,
  mapThreeStars,
} from "./mappers";
import {
  type RawBoxscore,
  RawBoxscoreSchema,
  RawClubScheduleSchema,
  RawClubStatsSchema,
  RawLandingSchema,
  RawLeadersResponseSchema,
  RawPlayerLandingSchema,
  RawScoreResponseSchema,
  RawStandingsResponseSchema,
} from "./raw-types";
import { parseResponse } from "./validate";

export interface NhlAdapterOptions extends NhlClientOptions {
  /** Called for each minor field the API returned in an unexpected shape. Defaults to console.warn. */
  onWarning?: (warning: AdapterWarning) => void;
}

/** Orchestrates endpoints; validation lives in raw-types.ts, shape conversion in mappers.ts. */
export class NhlAdapter implements LeagueAdapter {
  readonly league = LEAGUE;

  private readonly client: NhlClient;
  private readonly onWarning: (warning: AdapterWarning) => void;

  constructor(options: NhlAdapterOptions = {}) {
    this.client = new NhlClient(options);
    this.onWarning = options.onWarning ?? ((w) => console.warn(`[nhl] ${w.message} (${w.url})`));
  }

  private async fetch<T extends z.ZodType>(
    path: string,
    schema: T,
    options: RequestOptions = {},
  ): Promise<z.output<T>> {
    const data = await this.client.get(path);
    const onWarning = options.onWarning ?? this.onWarning;
    return parseResponse(schema, data, `${this.client.baseUrl}${path}`, onWarning);
  }

  async getScores(date: string, options?: RequestOptions): Promise<Game[]> {
    const raw = await this.fetch(`/score/${date}`, RawScoreResponseSchema, options);
    return (raw.games ?? []).map(mapGame);
  }

  async getStandings(options?: RequestOptions): Promise<Standings> {
    const raw = await this.fetch("/standings/now", RawStandingsResponseSchema, options);
    return mapStandings(raw);
  }

  async getLeaders(query: LeaderQuery = {}, options?: RequestOptions): Promise<LeaderBoard[]> {
    const limit = query.limit ?? 10;
    const category = query.category;
    const isGoalie = category !== undefined && GOALIE_LEADER_CATEGORIES.includes(category);
    const categories = category ? [category] : SKATER_LEADER_CATEGORIES;
    const kind = isGoalie ? "goalie" : "skater";

    const raw = await this.fetch(
      `/${kind}-stats-leaders/current?categories=${categories.join(",")}&limit=${limit}`,
      RawLeadersResponseSchema,
      options,
    );
    return mapLeaders(raw, categories);
  }

  async getGameDetail(gameId: string, options?: RequestOptions): Promise<GameDetail> {
    const raw = await this.fetch(`/gamecenter/${gameId}/boxscore`, RawBoxscoreSchema, options);
    const game = mapGame(raw);
    const [goals, threeStars] = await Promise.all([
      game.status === "scheduled" ? undefined : this.getGoals(raw.id, raw.gameDate, options),
      game.status === "final" ? this.getThreeStars(raw, options) : undefined,
    ]);
    return {
      game,
      goals,
      threeStars,
      boxscore: {
        home: mapBoxscoreSide(raw.playerByGameStats?.homeTeam),
        away: mapBoxscoreSide(raw.playerByGameStats?.awayTeam),
      },
    };
  }

  /**
   * The box score has no scoring summary, but the scores response for the game's date does.
   * Goals are an extra: if this call fails the game page still shows, without them.
   */
  private async getGoals(id: number, date: string | undefined, options?: RequestOptions): Promise<Goal[] | undefined> {
    if (!date) return undefined;
    try {
      const raw = await this.fetch(`/score/${date}`, RawScoreResponseSchema, options);
      return mapGoals(raw.games?.find((g) => g.id === id)?.goals);
    } catch {
      return undefined;
    }
  }

  /**
   * The three stars are only in the game's landing response, and only after the game. Like the goals,
   * they are an extra: if this call fails the game page shows without them.
   */
  private async getThreeStars(boxscore: RawBoxscore, options?: RequestOptions): Promise<GameStar[] | undefined> {
    try {
      const raw = await this.fetch(`/gamecenter/${boxscore.id}/landing`, RawLandingSchema, options);
      return mapThreeStars(raw, boxscore);
    } catch {
      return undefined;
    }
  }

  async getTeam(teamId: string, options?: RequestOptions): Promise<TeamDetail> {
    const team = encodeURIComponent(teamId);
    const [stats, schedule] = await Promise.all([
      this.fetch(`/club-stats/${team}/now`, RawClubStatsSchema, options),
      this.getTeamSchedule(team, teamId, options),
    ]);
    return { teamId, stats: mapClubStats(stats), ...schedule };
  }

  async getPlayer(playerId: string, options?: RequestOptions): Promise<PlayerDetail> {
    const raw = await this.fetch(`/player/${encodeURIComponent(playerId)}/landing`, RawPlayerLandingSchema, options);
    return mapPlayerDetail(raw);
  }

  /** Games are an extra on the team page: if this call fails the stats still show, without them. */
  private async getTeamSchedule(
    team: string,
    teamId: string,
    options?: RequestOptions,
  ): Promise<Pick<TeamDetail, "recent" | "upcoming" | "arena">> {
    try {
      return mapTeamSchedule(
        await this.fetch(`/club-schedule-season/${team}/now`, RawClubScheduleSchema, options),
        teamId,
      );
    } catch {
      return {};
    }
  }
}
