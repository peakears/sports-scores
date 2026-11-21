import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  Game,
  GameDetail,
  GameStatus,
  LeaderBoard,
  LeagueAdapter,
  PlayerDetail,
  RequestOptions,
  Standings,
  TeamDetail,
} from "../domain";
import { NhlAdapter } from "../adapters/nhl";
import { AdapterRegistry } from "../registry";
import {
  FRESHNESS,
  MemoryStore,
  SportsData,
  gameDetailFreshness,
  gameFreshness,
  scoresFreshness,
  teamFreshness,
} from ".";

const NOW = Date.parse("2026-11-17T23:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

function game(status: GameStatus, startTime: string, id = "1"): Game {
  const team = (abbrev: string) => ({ id: abbrev, league: "test", name: abbrev, abbrev });
  return {
    id,
    league: "test",
    startTime,
    status,
    home: { team: team("AAA"), score: status === "scheduled" ? null : 1 },
    away: { team: team("BBB"), score: status === "scheduled" ? null : 0 },
  };
}

/** A scriptable adapter that counts calls. */
class FakeAdapter implements LeagueAdapter {
  readonly league = "test";
  calls = 0;
  games: Game[] = [game("live", "2026-11-17T22:00:00Z")];
  fail: Error | null = null;
  warnings: string[] = [];
  /** Resolve pending calls manually, to test concurrent requests. */
  gate: Promise<void> | null = null;

  private async run<T>(value: () => T, options?: RequestOptions): Promise<T> {
    this.calls++;
    if (this.gate) await this.gate;
    if (this.fail) throw this.fail;
    for (const message of this.warnings) options?.onWarning?.({ url: "fake://", message });
    return value();
  }

  getScores(_date: string, options?: RequestOptions): Promise<Game[]> {
    return this.run(() => structuredClone(this.games), options);
  }
  getStandings(options?: RequestOptions): Promise<Standings> {
    return this.run(() => ({ league: "test", groups: [], updatedAt: new Date(NOW).toISOString() }), options);
  }
  getLeaders(_query?: unknown, options?: RequestOptions): Promise<LeaderBoard[]> {
    return this.run(() => [], options);
  }
  getGameDetail(_id: string, options?: RequestOptions): Promise<GameDetail> {
    return this.run(() => ({ game: this.games[0], boxscore: { home: [], away: [] } }), options);
  }
  getTeam(teamId: string, options?: RequestOptions): Promise<TeamDetail> {
    return this.run(() => ({ teamId, stats: [], recent: [], upcoming: [] }), options);
  }
  getPlayer(playerId: string, options?: RequestOptions): Promise<PlayerDetail> {
    return this.run(
      () => ({
        player: { id: playerId, league: "test", name: "A Player" },
        active: true,
        goalie: false,
        bio: {},
        season: [],
        career: { regularSeason: [], playoffs: [] },
        lastGames: { columns: [], games: [] },
        seasons: { columns: [], rows: [] },
      }),
      options,
    );
  }
}

describe("freshness", () => {
  it.each([
    ["live", "2026-11-17T22:00:00Z", FRESHNESS.live],
    ["scheduled", "2026-11-17T23:10:00Z", FRESHNESS.startingSoon], // starts in 10 min
    ["scheduled", "2026-11-17T22:50:00Z", FRESHNESS.startingSoon], // late puck drop
    ["scheduled", "2026-11-18T03:00:00Z", FRESHNESS.scheduled], // later tonight
    ["scheduled", "2026-11-20T00:00:00Z", FRESHNESS.scheduledFar], // days away
    ["final", "2026-11-17T19:00:00Z", FRESHNESS.recentFinal],
    ["final", "2026-11-10T00:00:00Z", FRESHNESS.oldFinal],
    ["postponed", "2026-11-17T19:00:00Z", FRESHNESS.recentFinal],
  ] as const)("%s game starting %s", (status, start, expected) => {
    expect(gameFreshness(game(status, start), NOW)).toBe(expected);
  });

  it("a day of scores is as fresh as its most urgent game", () => {
    const games = [game("final", "2026-11-17T19:00:00Z", "1"), game("live", "2026-11-17T22:00:00Z", "2")];
    expect(scoresFreshness(games, NOW)).toBe(FRESHNESS.live);
    expect(scoresFreshness([], NOW)).toBe(FRESHNESS.noGames);
  });
});

describe("gameDetailFreshness", () => {
  const detail = (g: Game, withStars: boolean): GameDetail => ({
    game: g,
    boxscore: { home: [], away: [] },
    threeStars: withStars ? [{ rank: 1, player: { id: "1", league: "test", name: "A" }, stats: [] }] : undefined,
  });

  it("re-checks a just-finished game soon until its three stars arrive", () => {
    const final = game("final", "2026-11-17T19:30:00Z"); // started 3.5 hours ago
    expect(gameDetailFreshness(detail(final, false), NOW)).toBe(FRESHNESS.awaitingStars);
    expect(gameDetailFreshness(detail(final, true), NOW)).toBe(FRESHNESS.recentFinal);
  });

  it("stops waiting for stars a few hours after the game", () => {
    const final = game("final", "2026-11-17T12:00:00Z"); // started 11 hours ago
    expect(gameDetailFreshness(detail(final, false), NOW)).toBe(FRESHNESS.recentFinal);
  });

  it("follows the game for anything but a final", () => {
    const live = game("live", "2026-11-17T22:00:00Z");
    expect(gameDetailFreshness(detail(live, false), NOW)).toBe(FRESHNESS.live);
  });
});

describe("teamFreshness", () => {
  const detail = (recent: Game[], upcoming: Game[]): TeamDetail => ({ teamId: "AAA", stats: [], recent, upcoming });

  it("is short while the team is playing or about to", () => {
    expect(teamFreshness(detail([game("live", "2026-11-17T22:00:00Z")], []), NOW)).toBe(FRESHNESS.teamLive);
    expect(teamFreshness(detail([], [game("scheduled", "2026-11-17T23:10:00Z")]), NOW)).toBe(FRESHNESS.teamLive);
    // Should have started an hour ago but the schedule still says scheduled: check again soon.
    expect(teamFreshness(detail([], [game("scheduled", "2026-11-17T22:00:00Z")]), NOW)).toBe(FRESHNESS.teamLive);
  });

  it("is long otherwise", () => {
    expect(teamFreshness(detail([game("final", "2026-11-17T19:00:00Z")], []), NOW)).toBe(FRESHNESS.team);
    expect(teamFreshness(detail([], [game("scheduled", "2026-11-18T03:00:00Z")]), NOW)).toBe(FRESHNESS.team);
    expect(teamFreshness({ teamId: "AAA", stats: [] }, NOW)).toBe(FRESHNESS.team); // schedule unavailable
  });

  it("does not poll forever for a game stuck as scheduled long after its start", () => {
    expect(teamFreshness(detail([], [game("scheduled", "2026-11-17T10:00:00Z")]), NOW)).toBe(FRESHNESS.team);
  });
});

describe("SportsData", () => {
  let now: number;
  let adapter: FakeAdapter;
  let store: MemoryStore;
  let data: SportsData;

  beforeEach(() => {
    now = NOW;
    adapter = new FakeAdapter();
    store = new MemoryStore();
    const registry = new AdapterRegistry();
    registry.register(adapter);
    data = new SportsData({ registry, store, now: () => now });
  });

  it("fetches on a miss and returns metadata", async () => {
    const result = await data.getScores("test", "2026-11-17");
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({
      league: "test",
      key: "test:scores:2026-11-17",
      source: "network",
      fetchedAt: "2026-11-17T23:00:00.000Z",
      staleAt: "2026-11-17T23:00:20.000Z", // live game: 20s
      stale: false,
      warnings: [],
    });
  });

  it("caches each team under its own key", async () => {
    await data.getTeam("test", "AAA");
    const again = await data.getTeam("test", "AAA");
    expect(adapter.calls).toBe(1);
    expect(again.meta.source).toBe("cache");
    await data.getTeam("test", "BBB");
    expect(adapter.calls).toBe(2);
  });

  it("serves fresh data from the cache without a network call", async () => {
    await data.getScores("test", "2026-11-17");
    now += 10_000;
    const result = await data.getScores("test", "2026-11-17");
    expect(adapter.calls).toBe(1);
    expect(result.meta.source).toBe("cache");
    expect(result.meta.stale).toBe(false);
  });

  it("refetches once the data is stale", async () => {
    await data.getScores("test", "2026-11-17");
    now += 21_000;
    const result = await data.getScores("test", "2026-11-17");
    expect(adapter.calls).toBe(2);
    expect(result.meta.source).toBe("network");
  });

  it("keeps final games much longer than live ones", async () => {
    adapter.games = [game("final", "2026-11-10T00:00:00Z")];
    await data.getScores("test", "2026-11-10");
    now += 6 * 24 * HOUR;
    await data.getScores("test", "2026-11-10");
    expect(adapter.calls).toBe(1);
  });

  it("force skips the cache", async () => {
    await data.getScores("test", "2026-11-17");
    const result = await data.getScores("test", "2026-11-17", { force: true });
    expect(adapter.calls).toBe(2);
    expect(result.meta.source).toBe("network");
  });

  describe("offline", () => {
    it("returns the last known data, marked stale, when a refresh fails", async () => {
      await data.getScores("test", "2026-11-17");
      now += 5 * MIN;
      adapter.fail = new Error("Network request failed");
      const result = await data.getScores("test", "2026-11-17");
      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({
        source: "cache",
        stale: true,
        error: "Network request failed",
        fetchedAt: "2026-11-17T23:00:00.000Z",
      });
    });

    it("falls back to the cache when a forced refresh fails", async () => {
      await data.getScores("test", "2026-11-17");
      adapter.fail = new Error("offline");
      const result = await data.getScores("test", "2026-11-17", { force: true });
      expect(result.meta).toMatchObject({ source: "cache", stale: false, error: "offline" });
    });

    it("throws when nothing is cached", async () => {
      adapter.fail = new Error("offline");
      await expect(data.getScores("test", "2026-11-17")).rejects.toThrow("offline");
    });

    it("survives a restart: a new SportsData on the same store reads the cache", async () => {
      await data.getScores("test", "2026-11-17");
      const registry = new AdapterRegistry();
      registry.register(adapter);
      const restarted = new SportsData({ registry, store, now: () => now });
      const result = await restarted.getScores("test", "2026-11-17");
      expect(adapter.calls).toBe(1);
      expect(result.meta.source).toBe("cache");
    });
  });

  it("shares one network call between concurrent requests", async () => {
    let release!: () => void;
    adapter.gate = new Promise((r) => (release = r));
    const a = data.getScores("test", "2026-11-17");
    const b = data.getScores("test", "2026-11-17");
    await new Promise((r) => setTimeout(r, 0));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(adapter.calls).toBe(1);
    expect(ra.data).toEqual(rb.data);
  });

  it("records warnings from the fetch that produced the data", async () => {
    adapter.warnings = ["savePctg: unexpected value"];
    const fresh = await data.getScores("test", "2026-11-17");
    adapter.warnings = [];
    const cached = await data.getScores("test", "2026-11-17");
    expect(fresh.meta.warnings).toEqual(["savePctg: unexpected value"]);
    expect(cached.meta.warnings).toEqual(["savePctg: unexpected value"]);
  });

  it("uses separate keys per resource", async () => {
    await data.getScores("test", "2026-11-17");
    await data.getScores("test", "2026-11-18");
    await data.getStandings("test");
    await data.getLeaders("test");
    await data.getLeaders("test", { category: "goals", limit: 5 });
    await data.getGameDetail("test", "42");
    expect((await store.keys()).sort()).toEqual([
      "cache:test:game:42",
      "cache:test:leaders:default:default",
      "cache:test:leaders:goals:5",
      "cache:test:scores:2026-11-17",
      "cache:test:scores:2026-11-18",
      "cache:test:standings",
    ]);
  });

  it("ignores corrupt and old-version entries", async () => {
    await store.set("cache:test:scores:2026-11-17", "{not json");
    await store.set("cache:test:scores:2026-11-18", JSON.stringify({ v: 0, data: [], staleAt: Infinity }));
    await data.getScores("test", "2026-11-17");
    await data.getScores("test", "2026-11-18");
    expect(adapter.calls).toBe(2);
  });

  it("still returns data when storage fails", async () => {
    store.set = async () => {
      throw new Error("disk full");
    };
    const result = await data.getScores("test", "2026-11-17");
    expect(result.meta.source).toBe("network");
  });

  it("prune removes long-stale cache entries and leaves other keys alone", async () => {
    await store.set("settings:theme", "dark");
    adapter.games = [game("live", "2026-11-17T22:00:00Z")];
    await data.getScores("test", "2026-11-17"); // stale after 20s
    await store.set("cache:test:scores:junk", "{not json");
    now += 31 * 24 * HOUR;
    await data.getStandings("test"); // fresh
    expect(await data.prune()).toBe(2);
    expect((await store.keys()).sort()).toEqual(["cache:test:standings", "settings:theme"]);
  });
});

describe("SportsData with the NHL adapter", () => {
  it("caches real responses and reports per-request warnings", async () => {
    const box = JSON.parse(
      readFileSync(new URL("../adapters/nhl/__fixtures__/boxscore-2026020333-final.json", import.meta.url), "utf8"),
    );
    box.playerByGameStats.homeTeam.goalies[1].savePctg = ".905";
    let calls = 0;
    const nhl = new NhlAdapter({
      fetch: async (input) => {
        // A game detail also reads the day's scores for the goals; only the box score counts here.
        if (String(input).endsWith("/boxscore")) calls++;
        return new Response(JSON.stringify(box));
      },
      onWarning: () => {
        throw new Error("the per-request handler should be used instead");
      },
    });
    const registry = new AdapterRegistry();
    registry.register(nhl);
    const now = Date.parse("2026-11-20T12:00:00Z"); // game finished days ago
    const data = new SportsData({ registry, store: new MemoryStore(), now: () => now });

    const first = await data.getGameDetail("nhl", "2026020333");
    const second = await data.getGameDetail("nhl", "2026020333");
    expect(calls).toBe(1);
    expect(first.data.game.endedIn).toBe("regulation");
    expect(first.meta.warnings).toEqual(['savePctg: unexpected value ".905" (string), ignored']);
    expect(second.meta.source).toBe("cache");
    expect(Date.parse(second.meta.staleAt) - now).toBe(FRESHNESS.oldFinal);
  });
});
