// Shared contract every LeagueAdapter must pass, whatever the league.
// It checks domain-level guarantees the cache and UI rely on, not league details.
//
// Usage, from an adapter's own test file:
//   runLeagueAdapterContract({ name: "NHL", league: "nhl", makeAdapter, inputs, makeFailingAdapter });
// makeAdapter should return an adapter wired to recorded fixtures, not the live API.

import { describe, expect, it } from "vitest";
import type {
  Game,
  GameStatus,
  LeaderBoard,
  LeaderQuery,
  LeagueAdapter,
  LeagueId,
  Player,
  PlayerDetail,
  StatColumn,
  StatItem,
  StatTable,
  Team,
  TeamDetail,
} from "../domain";

const STATUSES: GameStatus[] = ["scheduled", "live", "final", "postponed"];

export interface ContractInputs {
  /** Dates (YYYY-MM-DD) with recorded score fixtures. Together they should cover scheduled, live and final games. */
  scoreDates: string[];
  /** Game ids with recorded box score fixtures. */
  gameIds: string[];
  /** Leader queries with recorded fixtures. `{}` (the default boards) should be included. */
  leaderQueries: LeaderQuery[];
  /** Team ids with recorded team fixtures (season stats and schedule). */
  teamIds: string[];
  /** Player ids with recorded player fixtures. Should include a skater and a goalie. */
  playerIds: string[];
}

export interface ContractOptions {
  name: string;
  league: LeagueId;
  makeAdapter: () => LeagueAdapter;
  inputs: ContractInputs;
  /** An adapter whose transport always fails (network down, HTTP 500). */
  makeFailingAdapter: () => LeagueAdapter;
}

// ---------- Shared assertions ----------

function expectNonEmptyString(value: unknown, what: string): void {
  expect(typeof value, what).toBe("string");
  expect((value as string).length, what).toBeGreaterThan(0);
}

function expectTeam(team: Team, league: LeagueId): void {
  expectNonEmptyString(team.id, "team.id");
  expectNonEmptyString(team.name, "team.name");
  expectNonEmptyString(team.abbrev, "team.abbrev");
  expect(team.league).toBe(league);
}

function expectPlayer(player: Player, league: LeagueId): void {
  expectNonEmptyString(player.id, "player.id");
  expectNonEmptyString(player.name, "player.name");
  expect(player.league).toBe(league);
}

/** The cache stores domain objects as JSON, so they must survive a round trip unchanged. */
function expectJsonSafe(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

function expectGame(game: Game, league: LeagueId): void {
  expectNonEmptyString(game.id, "game.id");
  expect(game.league).toBe(league);
  expect(STATUSES).toContain(game.status);
  expect(Number.isNaN(Date.parse(game.startTime)), `startTime "${game.startTime}"`).toBe(false);
  expectTeam(game.home.team, league);
  expectTeam(game.away.team, league);
  expect(game.home.team.id).not.toBe(game.away.team.id);

  for (const side of [game.home, game.away]) {
    if (game.status === "scheduled") {
      expect(side.score, "scheduled games have no score").toBeNull();
    } else if (game.status === "live" || game.status === "final") {
      expect(Number.isInteger(side.score), "live/final games have an integer score").toBe(true);
      expect(side.score!).toBeGreaterThanOrEqual(0);
    }
  }

  if (game.status === "live") {
    if (game.clock) {
      expect(game.clock.period).toBeGreaterThanOrEqual(1);
      expectNonEmptyString(game.clock.label, "clock.label");
      if (game.clock.intermission) {
        expect(game.clock.timeRemaining, "no period clock during an intermission").toBeUndefined();
      }
    }
  } else {
    expect(game.clock, "clock only while live").toBeUndefined();
  }

  if (game.status !== "final") {
    expect(game.endedIn, "endedIn only when final").toBeUndefined();
  }
}

function expectStatTable(table: StatTable, league: LeagueId): void {
  expectNonEmptyString(table.title, "table.title");
  const keys = table.columns.map((c) => c.key);
  expect(new Set(keys).size, "column keys are unique").toBe(keys.length);
  for (const row of table.rows) {
    expectPlayer(row.player, league);
    for (const key of Object.keys(row.values)) {
      expect(keys, `value "${key}" has a column`).toContain(key);
    }
    for (const v of Object.values(row.values)) {
      expect(v, "missing stats are left out, not null/undefined").not.toBeNull();
      expect(v).not.toBeUndefined();
    }
  }
}

function expectLeaderBoard(board: LeaderBoard, league: LeagueId): void {
  expectNonEmptyString(board.category, "board.category");
  expectNonEmptyString(board.label, "board.label");
  const { entries } = board;
  if (entries.length === 0) return;

  expect(entries[0].rank, "first entry is rank 1").toBe(1);
  // Sorted best-first, but "best" can be high (goals) or low (GAA): just require monotonic.
  const values = entries.map((e) => e.value);
  const asc = values.every((v, i) => i === 0 || v >= values[i - 1]);
  const desc = values.every((v, i) => i === 0 || v <= values[i - 1]);
  expect(asc || desc, `values are sorted: ${values.join(", ")}`).toBe(true);

  entries.forEach((e, i) => {
    expectPlayer(e.player, league);
    expectTeam(e.team, league);
    expect(Number.isFinite(e.value)).toBe(true);
    if (i === 0) return;
    const prev = entries[i - 1];
    // Competition ranking: ties share a rank, the next distinct value skips ahead.
    expect(e.rank, `rank of entry ${i}`).toBe(e.value === prev.value ? prev.rank : i + 1);
  });
}

// ---------- The suite ----------

export function runLeagueAdapterContract(options: ContractOptions): void {
  const { name, league, makeAdapter, inputs, makeFailingAdapter } = options;

  describe(`LeagueAdapter contract: ${name}`, () => {
    it("reports its league id", () => {
      expect(makeAdapter().league).toBe(league);
    });

    describe("getScores", () => {
      it.each(inputs.scoreDates)("returns valid games for %s", async (date) => {
        const games = await makeAdapter().getScores(date);
        expect(Array.isArray(games)).toBe(true);
        for (const game of games) expectGame(game, league);
        expect(new Set(games.map((g) => g.id)).size, "game ids are unique").toBe(games.length);
        expectJsonSafe(games);
      });

      it("fixtures cover scheduled, live and final games", async () => {
        const adapter = makeAdapter();
        const all = (await Promise.all(inputs.scoreDates.map((d) => adapter.getScores(d)))).flat();
        const seen = new Set(all.map((g) => g.status));
        for (const status of ["scheduled", "live", "final"] as const) {
          expect(seen, `no ${status} game in the score fixtures`).toContain(status);
        }
      });
    });

    describe("getStandings", () => {
      it("returns ranked groups of teams", async () => {
        const standings = await makeAdapter().getStandings();
        expect(standings.league).toBe(league);
        expect(Number.isNaN(Date.parse(standings.updatedAt))).toBe(false);
        expect(standings.groups.length).toBeGreaterThan(0);

        const teamIds: string[] = [];
        for (const group of standings.groups) {
          expectNonEmptyString(group.name, "group.name");
          expect(group.rows.length).toBeGreaterThan(0);
          group.rows.forEach((row, i) => {
            expectTeam(row.team, league);
            expect(row.rank, `${group.name} ranks are 1..n`).toBe(i + 1);
            const decided = row.wins + row.losses + (row.otLosses ?? 0);
            expect(decided, `${row.team.abbrev} W+L+OTL <= GP`).toBeLessThanOrEqual(row.gamesPlayed);
            teamIds.push(row.team.id);
          });
        }
        expect(new Set(teamIds).size, "each team appears once").toBe(teamIds.length);
        expectJsonSafe(standings);
      });
    });

    describe("getLeaders", () => {
      it.each(inputs.leaderQueries.map((q) => [JSON.stringify(q), q] as const))(
        "returns valid leader boards for %s",
        async (_label, query) => {
          const boards = await makeAdapter().getLeaders(query);
          expect(boards.length).toBeGreaterThan(0);
          if (query.category) expect(boards.map((b) => b.category)).toEqual([query.category]);
          for (const board of boards) {
            expectLeaderBoard(board, league);
            if (query.limit) expect(board.entries.length).toBeLessThanOrEqual(query.limit);
          }
          expectJsonSafe(boards);
        },
      );
    });

    describe("getGameDetail", () => {
      it.each(inputs.gameIds)("returns a valid box score for %s", async (gameId) => {
        const detail = await makeAdapter().getGameDetail(gameId);
        expectGame(detail.game, league);
        expect(detail.game.id).toBe(gameId);
        for (const side of [detail.boxscore.home, detail.boxscore.away]) {
          for (const table of side) expectStatTable(table, league);
        }
        expectJsonSafe(detail);
      });
    });

    describe("getTeam", () => {
      it.each(inputs.teamIds)("returns season stats and nearby games for %s", async (teamId) => {
        const detail: TeamDetail = await makeAdapter().getTeam(teamId);
        expect(detail.teamId).toBe(teamId);
        expect(detail.stats.length).toBeGreaterThan(0);
        for (const table of detail.stats) {
          expectStatTable(table, league);
          expect(table.rows.length, `${table.title} has no empty tables`).toBeGreaterThan(0);
        }

        const { recent, upcoming } = detail;
        for (const g of [...(recent ?? []), ...(upcoming ?? [])]) {
          expectGame(g, league);
          expect([g.home.team.id, g.away.team.id], "the team plays in each game").toContain(teamId);
        }
        // Recent games are newest first, upcoming ones soonest first, and nothing sits in both lists.
        const times = (games: Game[] = []) => games.map((g) => Date.parse(g.startTime));
        expect(times(recent)).toEqual([...times(recent)].sort((a, b) => b - a));
        expect(times(upcoming)).toEqual([...times(upcoming)].sort((a, b) => a - b));
        for (const g of recent ?? []) expect(g.status).not.toBe("scheduled");
        for (const g of upcoming ?? []) expect(g.status).toBe("scheduled");
        expectJsonSafe(detail);
      });
    });

    describe("getPlayer", () => {
      const expectItems = (items: StatItem[], what: string) => {
        for (const item of items) {
          expectNonEmptyString(item.value, `${what} value`);
          expectNonEmptyString(item.label, `${what} label`);
        }
      };
      const expectValues = (values: Record<string, string | number>, columns: StatColumn[], what: string) => {
        const keys = columns.map((c) => c.key);
        for (const key of Object.keys(values)) expect(keys, `${what}: ${key} is one of the columns`).toContain(key);
      };

      it.each(inputs.playerIds)("returns a player page for %s", async (playerId) => {
        const detail: PlayerDetail = await makeAdapter().getPlayer(playerId);
        expectPlayer(detail.player, league);
        expect(detail.player.id).toBe(playerId);
        if (detail.team) expectTeam(detail.team, league);
        expectItems(detail.season, "season");
        expectItems(detail.career.regularSeason, "career");
        expectItems(detail.career.playoffs, "playoffs");

        expect(detail.lastGames.games.length).toBeLessThanOrEqual(5);
        for (const g of detail.lastGames.games) {
          expectNonEmptyString(g.gameId, "game id");
          expect(g.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expectValues(g.values, detail.lastGames.columns, "last games");
        }
        const dates = detail.lastGames.games.map((g) => g.date);
        expect(dates, "last games are newest first").toEqual([...dates].sort().reverse());

        for (const s of detail.seasons.rows) {
          expectNonEmptyString(s.season, "season");
          expectNonEmptyString(s.team, "season team");
          expectValues(s.values, detail.seasons.columns, "seasons");
        }
        const seasons = detail.seasons.rows.map((s) => s.season);
        expect(seasons, "seasons are newest first").toEqual([...seasons].sort().reverse());
        expectJsonSafe(detail);
      });

      it("covers a skater and a goalie", async () => {
        const goalies = await Promise.all(
          inputs.playerIds.map(async (id) => (await makeAdapter().getPlayer(id)).goalie),
        );
        expect(goalies).toContain(true);
        expect(goalies).toContain(false);
      });
    });

    describe("errors", () => {
      it("rejects when the transport fails", async () => {
        const adapter = makeFailingAdapter();
        await expect(adapter.getScores(inputs.scoreDates[0])).rejects.toThrow();
        await expect(adapter.getStandings()).rejects.toThrow();
        await expect(adapter.getLeaders()).rejects.toThrow();
        await expect(adapter.getGameDetail(inputs.gameIds[0])).rejects.toThrow();
        await expect(adapter.getTeam(inputs.teamIds[0])).rejects.toThrow();
        await expect(adapter.getPlayer(inputs.playerIds[0])).rejects.toThrow();
      });
    });
  });
}
