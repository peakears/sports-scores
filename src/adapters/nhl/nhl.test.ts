import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runLeagueAdapterContract } from "../../contract/league-adapter.contract";
import { NhlAdapter, NhlApiError, NhlResponseError, type AdapterWarning } from ".";

// Real responses recorded from api-web.nhle.com on 2026-11-17 (club stats, the Toronto schedule and the landing: 2026-11-20).
const FIXTURES: [RegExp, string][] = [
  [/\/score\/2026-11-17$/, "score-2026-11-17.json"], // final + live games
  [/\/score\/2026-11-18$/, "score-2026-11-18.json"], // scheduled games
  [/\/standings\/now$/, "standings-now.json"],
  [/\/skater-stats-leaders\//, "skater-leaders.json"],
  [/\/goalie-stats-leaders\//, "goalie-leaders.json"],
  [/\/gamecenter\/2026020342\/boxscore$/, "boxscore-2026020342-live.json"],
  [/\/gamecenter\/2026020333\/boxscore$/, "boxscore-2026020333-final.json"],
  [/\/gamecenter\/2026020333\/landing$/, "landing-2026020333-final.json"], // recorded 2026-11-20
  [/\/player\/8474563\/landing$/, "player-8474563-landing.json"], // Drew Doughty (D), recorded 2026-11-20
  [/\/player\/8475311\/landing$/, "player-8475311-landing.json"], // Darcy Kuemper (G), recorded 2026-11-20
  [/\/club-stats\/TOR\/now$/, "club-stats-TOR-now.json"],
  [/\/club-schedule-season\/TOR\/now$/, "club-schedule-season-TOR-now.json"],
];

function loadFixture(file: string): any {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), "utf8"));
}

function fixtureFor(url: string): any {
  const hit = FIXTURES.find(([pattern]) => pattern.test(url.split("?")[0]));
  if (!hit) throw new Error(`No fixture for ${url}`);
  return loadFixture(hit[1]);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** An adapter served from fixtures. `edit` lets a test change a response to simulate API drift. */
function fixtureAdapter(edit?: (url: string, body: any) => void) {
  const warnings: AdapterWarning[] = [];
  const urls: string[] = [];
  const adapter = new NhlAdapter({
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      const body = fixtureFor(url);
      edit?.(url, body);
      return jsonResponse(body);
    },
    onWarning: (w) => warnings.push(w),
  });
  return { adapter, warnings, urls };
}

// ---------- Shared contract ----------

runLeagueAdapterContract({
  name: "NHL",
  league: "nhl",
  makeAdapter: () => fixtureAdapter().adapter,
  makeFailingAdapter: () =>
    new NhlAdapter({
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
    }),
  inputs: {
    scoreDates: ["2026-11-17", "2026-11-18"],
    gameIds: ["2026020342", "2026020333"],
    leaderQueries: [{}, { category: "goals", limit: 3 }, { category: "savePctg" }, { category: "goalsAgainstAverage" }],
    teamIds: ["TOR"],
    playerIds: ["8474563", "8475311"], // Doughty (D), Kuemper (G)
  },
});

// ---------- NHL-specific behavior ----------

describe("NHL adapter", () => {
  it("parses every recorded response with no warnings", async () => {
    const { adapter, warnings } = fixtureAdapter();
    await adapter.getScores("2026-11-17");
    await adapter.getScores("2026-11-18");
    await adapter.getStandings();
    await adapter.getLeaders();
    await adapter.getLeaders({ category: "wins" });
    await adapter.getGameDetail("2026020342");
    await adapter.getGameDetail("2026020333");
    await adapter.getTeam("TOR");
    await adapter.getPlayer("8474563");
    await adapter.getPlayer("8475311");
    expect(warnings).toEqual([]);
  });

  it("builds the expected endpoint URLs", async () => {
    const { adapter, urls } = fixtureAdapter();
    await adapter.getScores("2026-11-17");
    await adapter.getLeaders();
    await adapter.getLeaders({ category: "savePctg", limit: 5 });
    expect(urls).toEqual([
      "https://api-web.nhle.com/v1/score/2026-11-17",
      "https://api-web.nhle.com/v1/skater-stats-leaders/current?categories=goals,assists,points&limit=10",
      "https://api-web.nhle.com/v1/goalie-stats-leaders/current?categories=savePctg&limit=5",
    ]);
  });

  describe("games", () => {
    it("maps a live game in intermission without a period clock", async () => {
      const games = await fixtureAdapter().adapter.getScores("2026-11-17");
      const live = games.find((g) => g.id === "2026020342")!;
      expect(live.status).toBe("live");
      expect(live.clock).toEqual({
        period: 1,
        label: "1st",
        intermission: true,
        intermissionRemaining: "03:05",
      });
    });

    it("maps a final game", async () => {
      const games = await fixtureAdapter().adapter.getScores("2026-11-17");
      const game = games.find((g) => g.id === "2026020333")!;
      expect(game).toMatchObject({
        status: "final",
        endedIn: "regulation",
        startTime: "2026-11-18T00:00:00Z",
        home: { team: { id: "BOS", name: "Bruins" }, score: 0 },
        away: { team: { id: "LAK", name: "Kings" }, score: 3 },
      });
    });

    it.each([
      ["OT", "overtime"],
      ["SO", "shootout"],
    ] as const)("maps a final game decided by %s", async (periodType, expected) => {
      const { adapter } = fixtureAdapter((_url, body) => {
        body.games[0].gameOutcome = { lastPeriodType: periodType };
      });
      const [game] = await adapter.getScores("2026-11-17");
      expect(game.endedIn).toBe(expected);
    });

    it("maps each team's season record on a game that has not started", async () => {
      const [game] = await fixtureAdapter().adapter.getScores("2026-11-18");
      expect(game.away.record).toBe("13-7-1");
      expect(game.home.record).toBe("8-10-3");
    });

    it("has no record on a game that has started, where the API sends none", async () => {
      const final = (await fixtureAdapter().adapter.getScores("2026-11-17")).find((g) => g.status === "final")!;
      expect(final.home.record).toBeUndefined();
      expect(final.away.record).toBeUndefined();
    });

    it("maps a scheduled game with no score", async () => {
      const [game] = await fixtureAdapter().adapter.getScores("2026-11-18");
      expect(game.status).toBe("scheduled");
      expect(game.home.score).toBeNull();
      expect(game.away.score).toBeNull();
    });

    it.each([
      ["FUT", "scheduled"],
      ["PRE", "scheduled"],
      ["LIVE", "live"],
      ["CRIT", "live"],
      ["FINAL", "final"],
      ["OFF", "final"],
      ["PPD", "postponed"],
      ["SUSP", "postponed"],
      ["SOMETHING_NEW", "scheduled"],
    ])("maps game state %s to %s", async (state, expected) => {
      const { adapter } = fixtureAdapter((_url, body) => {
        body.games[0].gameState = state;
      });
      const [game] = await adapter.getScores("2026-11-17");
      expect(game.status).toBe(expected);
    });
  });

  describe("TV broadcasts", () => {
    it("maps channels with their country and market, in the league's order", async () => {
      const games = await fixtureAdapter().adapter.getScores("2026-11-17");
      const edmFla = games.find((g) => g.away.team.id === "EDM")!;
      expect(edmFla.broadcasts).toEqual([
        { network: "SN", country: "CA", market: "national" },
        { network: "TVAS", country: "CA", market: "national" },
        { network: "SCRIPPS", country: "US", market: "home" },
      ]);
    });

    it("trims network names", async () => {
      const games = await fixtureAdapter().adapter.getScores("2026-11-17");
      const lakBos = games.find((g) => g.away.team.id === "LAK")!;
      expect(lakBos.broadcasts).toEqual([
        { network: "ABTV", country: "US", market: "away" },
        { network: "NESN", country: "US", market: "home" },
      ]);
    });

    it("includes the channels in the box score's game", async () => {
      const { game } = await fixtureAdapter().adapter.getGameDetail("2026020333");
      expect(game.broadcasts?.map((b) => b.network)).toEqual(["ABTV", "NESN"]);
    });

    it("leaves broadcasts absent when the API sends none", async () => {
      const { adapter, warnings } = fixtureAdapter((_url, body) => {
        delete body.games[0].tvBroadcasts;
      });
      const [game] = await adapter.getScores("2026-11-17");
      expect(game.broadcasts).toBeUndefined();
      expect(warnings).toEqual([]);
    });

    it("drops a broken listing or an unknown market and keeps the rest, with a warning for the broken one", async () => {
      const { adapter, warnings } = fixtureAdapter((_url, body) => {
        body.games[0].tvBroadcasts = [
          { id: 1, market: "N", countryCode: "US", network: "TNT", sequenceNumber: 1 },
          { id: 2, market: "N", countryCode: "US" },
          { id: 3, market: "X", countryCode: "US", network: "MYSTERY", sequenceNumber: 3 },
          { id: 4, market: "N", countryCode: "US", network: "TNT ", sequenceNumber: 4 },
        ];
      });
      const [game] = await adapter.getScores("2026-11-17");
      expect(game.broadcasts).toEqual([{ network: "TNT", country: "US", market: "national" }]);
      expect(warnings.map((w) => w.message)).toEqual([expect.stringContaining("tvBroadcasts[1] dropped")]);
    });

    it("never fails the scores when tvBroadcasts has the wrong type", async () => {
      const { adapter, warnings } = fixtureAdapter((_url, body) => {
        body.games[0].tvBroadcasts = "TNT";
      });
      const [game] = await adapter.getScores("2026-11-17");
      expect(game.broadcasts).toBeUndefined();
      expect(warnings.some((w) => w.message.startsWith("tvBroadcasts:"))).toBe(true);
    });
  });

  describe("venue", () => {
    it("has the arena in the scores list, without a city", async () => {
      const [game] = await fixtureAdapter().adapter.getScores("2026-11-17");
      expect(game.venue).toEqual({ name: "TD Garden", city: undefined });
    });

    it("has the arena and city in the box score", async () => {
      const { adapter } = fixtureAdapter();
      expect((await adapter.getGameDetail("2026020333")).game.venue).toEqual({ name: "TD Garden", city: "Boston" });
      expect((await adapter.getGameDetail("2026020342")).game.venue).toEqual({
        name: "T-Mobile Arena",
        city: "Paradise",
      });
    });

    it("leaves the venue out when the API sends none", async () => {
      const { adapter } = fixtureAdapter((_url, body) => {
        if (body.games) delete body.games[0].venue;
      });
      const [game] = await adapter.getScores("2026-11-17");
      expect(game.venue).toBeUndefined();
    });
  });

  describe("goal summary", () => {
    it("lists a final game's goals in the order scored", async () => {
      const { goals } = await fixtureAdapter().adapter.getGameDetail("2026020333");
      expect(goals).toHaveLength(3);
      expect(goals!.map((g) => [g.teamId, g.periodLabel, g.time])).toEqual([
        ["LAK", "1st", "15:46"],
        ["LAK", "2nd", "16:35"],
        ["LAK", "3rd", "16:53"],
      ]);
      expect(goals![0].scorer).toMatchObject({ id: "8475692", name: "M. Zuccarello", teamId: "LAK" });
      expect(goals![0].assists.map((a) => a.name)).toEqual(["E. Gustafsson", "B. Clarke"]);
      expect([goals![0].awayScore, goals![0].homeScore]).toEqual([1, 0]);
    });

    it("tags empty-net and power-play goals", async () => {
      const { goals } = await fixtureAdapter().adapter.getGameDetail("2026020333");
      expect(goals![2]).toMatchObject({ emptyNet: true, strength: "even", penaltyShot: false });
      const { adapter } = fixtureAdapter((_url, body) => {
        if (body.games) body.games.find((g: any) => g.id === 2026020333).goals[0].strength = "pp";
      });
      expect((await adapter.getGameDetail("2026020333")).goals![0].strength).toBe("powerPlay");
    });

    it("reads the goals from the scores response for the game's date", async () => {
      const { adapter, urls } = fixtureAdapter();
      await adapter.getGameDetail("2026020333");
      expect(urls).toEqual([
        "https://api-web.nhle.com/v1/gamecenter/2026020333/boxscore",
        "https://api-web.nhle.com/v1/score/2026-11-17",
        "https://api-web.nhle.com/v1/gamecenter/2026020333/landing",
      ]);
    });

    it("works for a live game", async () => {
      const { goals } = await fixtureAdapter().adapter.getGameDetail("2026020342");
      expect(goals).toBeDefined();
    });

    it("still returns the game when the scores call fails", async () => {
      const adapter = new NhlAdapter({
        fetch: async (input) => {
          const url = String(input);
          if (url.includes("/score/")) throw new TypeError("Network request failed");
          return jsonResponse(fixtureFor(url));
        },
      });
      const detail = await adapter.getGameDetail("2026020333");
      expect(detail.game.id).toBe("2026020333");
      expect(detail.goals).toBeUndefined();
    });

    it("drops one broken goal without failing the game", async () => {
      const { adapter, warnings } = fixtureAdapter((_url, body) => {
        if (body.games) delete body.games.find((g: any) => g.id === 2026020333).goals[1].playerId;
      });
      const { goals } = await adapter.getGameDetail("2026020333");
      expect(goals).toHaveLength(2);
      expect(warnings.some((w) => w.message.includes("goals[1] dropped"))).toBe(true);
    });

    it("treats a missing assists list as unassisted", async () => {
      const { adapter } = fixtureAdapter((_url, body) => {
        if (body.games) delete body.games.find((g: any) => g.id === 2026020333).goals[0].assists;
      });
      expect((await adapter.getGameDetail("2026020333")).goals![0].assists).toEqual([]);
    });
  });

  describe("three stars", () => {
    it("lists a final game's three stars with stats from the landing and box score", async () => {
      const { threeStars } = await fixtureAdapter().adapter.getGameDetail("2026020333");
      expect(threeStars).toEqual([
        {
          rank: 1,
          player: {
            id: "8475311",
            league: "nhl",
            name: "D. Kuemper",
            teamId: "LAK",
            position: "G",
            headshotUrl: "https://assets.nhle.com/mugs/nhl/20262027/LAK/8475311.png",
          },
          sweaterNumber: 35,
          stats: [
            { value: "29", label: "saves" },
            { value: "1.000", label: "SV%" },
          ],
        },
        expect.objectContaining({ rank: 2, player: expect.objectContaining({ name: "D. Doughty", position: "D" }) }),
        expect.objectContaining({ rank: 3, player: expect.objectContaining({ name: "M. DiPietro", teamId: "BOS" }) }),
      ]);
      expect(threeStars![1].stats.map((s) => s.label)).toEqual(["G", "A", "TOI"]);
      expect(threeStars![1].stats.slice(0, 2).map((s) => s.value)).toEqual(["0", "0"]);
      expect(threeStars![2].stats).toEqual([
        { value: "19", label: "saves" },
        { value: ".905", label: "SV%" },
      ]);
    });

    it("sorts by star, whatever order the API sends", async () => {
      const { adapter } = fixtureAdapter((url, body) => {
        if (url.endsWith("/landing")) body.summary.threeStars.reverse();
      });
      expect((await adapter.getGameDetail("2026020333")).threeStars!.map((s) => s.rank)).toEqual([1, 2, 3]);
    });

    it("is absent until the stars are named", async () => {
      for (const edit of [
        (body: any) => delete body.summary,
        (body: any) => (body.summary.threeStars = []),
        (body: any) => delete body.summary.threeStars,
      ]) {
        const { adapter } = fixtureAdapter((url, body) => url.endsWith("/landing") && edit(body));
        expect((await adapter.getGameDetail("2026020333")).threeStars).toBeUndefined();
      }
    });

    it("is not requested for live or scheduled games", async () => {
      const { adapter, urls } = fixtureAdapter();
      const detail = await adapter.getGameDetail("2026020342");
      expect(detail.threeStars).toBeUndefined();
      expect(urls.some((u) => u.endsWith("/landing"))).toBe(false);
    });

    it("still returns the game when the landing call fails", async () => {
      const adapter = new NhlAdapter({
        fetch: async (input) => {
          const url = String(input);
          if (url.endsWith("/landing")) return jsonResponse({ error: "nope" }, 500);
          return jsonResponse(fixtureFor(url));
        },
      });
      const detail = await adapter.getGameDetail("2026020333");
      expect(detail.goals).toHaveLength(3);
      expect(detail.threeStars).toBeUndefined();
    });

    it("drops one broken star and keeps the others", async () => {
      const { adapter, warnings } = fixtureAdapter((url, body) => {
        if (url.endsWith("/landing")) delete body.summary.threeStars[1].playerId;
      });
      expect((await adapter.getGameDetail("2026020333")).threeStars!.map((s) => s.rank)).toEqual([1, 3]);
      expect(warnings.some((w) => w.message.includes("summary.threeStars[1] dropped"))).toBe(true);
    });

    it("keeps a star without a headshot or stats", async () => {
      const { adapter } = fixtureAdapter((url, body) => {
        if (url.endsWith("/landing")) {
          const star = body.summary.threeStars[0];
          delete star.headshot;
          delete star.savePctg;
          delete star.position;
        }
        // And no box score row to match.
        if (url.endsWith("/boxscore")) body.playerByGameStats.awayTeam.goalies = [];
      });
      const first = (await adapter.getGameDetail("2026020333")).threeStars![0];
      expect(first.player.headshotUrl).toBeUndefined();
      expect(first.player.name).toBe("D. Kuemper");
      expect(first.stats).toEqual([]);
    });
  });

  describe("player page", () => {
    it("reads a skater's bio, season, career and recent games", async () => {
      const { adapter, urls } = fixtureAdapter();
      const d = await adapter.getPlayer("8474563");
      expect(urls).toEqual(["https://api-web.nhle.com/v1/player/8474563/landing"]);
      expect(d.player).toMatchObject({ id: "8474563", name: "Drew Doughty", teamId: "LAK", position: "D" });
      expect(d.player.headshotUrl).toMatch(/^https:\/\/assets\.nhle\.com\/mugs\//);
      expect(d).toMatchObject({ sweaterNumber: 8, active: true, goalie: false, seasonLabel: "2026-27" });
      expect(d.team).toMatchObject({ id: "LAK", name: "Los Angeles Kings" });
      expect(d.bio).toEqual({
        birthDate: "1989-12-08",
        birthPlace: "London, Ontario, CAN",
        heightCm: 185,
        heightIn: 73,
        weightKg: 95,
        weightLb: 210,
        handedness: "R",
        draft: { year: 2008, teamId: "LAK", round: 1, overallPick: 2 },
      });
      expect(d.season.map((s) => `${s.value} ${s.label}`)).toEqual([
        "19 GP",
        "1 G",
        "7 A",
        "8 PTS",
        "+6 +/-",
        "18 PIM",
        "1 PPP",
        "5.0% S%",
      ]);
      expect(d.career.regularSeason.map((s) => s.value)).toEqual(["1298", "166", "551", "717"]);
      expect(d.career.playoffs.map((s) => s.value)).toEqual(["105", "19", "42", "61"]);
      expect(d.lastGames.games).toHaveLength(5);
      expect(d.lastGames.games[0]).toEqual({
        gameId: "2026020347",
        date: "2026-11-19",
        teamId: "LAK",
        opponentId: "TOR",
        home: false,
        values: { goals: 0, assists: 0, points: 0, plusMinus: -1, shots: 1, pim: 2, toi: "25:53" },
      });
    });

    it("lists seasons newest first, marking NHL and playoff seasons", async () => {
      const { seasons } = await fixtureAdapter().adapter.getPlayer("8474563");
      expect(seasons.rows).toHaveLength(45);
      expect(seasons.rows[0]).toMatchObject({
        season: "2026-27",
        team: "Kings",
        league: "NHL",
        inLeague: true,
        playoffs: false,
      });
      expect(seasons.rows.at(-1)).toMatchObject({ season: "2004-05", team: "Lon. Jr. Knights", inLeague: false });
      expect(seasons.rows.filter((s) => s.inLeague && !s.playoffs)).toHaveLength(19);
      expect(seasons.rows.some((s) => s.league === "OG" && s.team === "Canada")).toBe(true);
    });

    it("reads a goalie's numbers", async () => {
      const d = await fixtureAdapter().adapter.getPlayer("8475311");
      expect(d.goalie).toBe(true);
      expect(d.season.map((s) => `${s.value} ${s.label}`)).toEqual([
        "13 GP",
        "7 W",
        "5 L",
        "1 OTL",
        "3.22 GAA",
        ".885 SV%",
        "1 SO",
      ]);
      expect(d.career.regularSeason.map((s) => s.label)).toEqual(["GP", "W", "GAA", "SV%", "SO"]);
      expect(d.lastGames.columns.map((c) => c.key)).toEqual([
        "decision",
        "shotsAgainst",
        "goalsAgainst",
        "savePctg",
        "toi",
      ]);
      expect(d.lastGames.games[0].values).toMatchObject({ decision: "W", shotsAgainst: 27, goalsAgainst: 3 });
      expect(d.bio.draft).toEqual({ year: 2009, teamId: "MIN", round: 6, overallPick: 161 });
    });

    it("copes with a player without a team, stats or bio", async () => {
      const { adapter, warnings } = fixtureAdapter((url, body) => {
        if (!url.includes("/player/")) return;
        for (const key of [
          "currentTeamAbbrev",
          "fullTeamName",
          "isActive",
          "featuredStats",
          "careerTotals",
          "draftDetails",
          "birthCity",
          "birthStateProvince",
          "heightInInches",
          "last5Games",
        ]) {
          delete body[key];
        }
        body.seasonTotals[0].season = "twenty"; // one broken season row
      });
      const d = await adapter.getPlayer("8474563");
      expect(d.team).toBeUndefined();
      expect(d.active).toBe(false);
      expect(d.season).toEqual([]);
      expect(d.career).toEqual({ regularSeason: [], playoffs: [] });
      expect(d.lastGames.games).toEqual([]);
      expect(d.bio.birthPlace).toBe("CAN");
      expect(d.bio.draft).toBeUndefined();
      expect(d.seasons.rows).toHaveLength(44);
      expect(warnings.some((w) => w.message.includes("seasonTotals[0] dropped"))).toBe(true);
    });

    it("fails loudly when the core fields change", async () => {
      const { adapter } = fixtureAdapter((url, body) => {
        if (url.includes("/player/")) delete body.lastName;
      });
      await expect(adapter.getPlayer("8474563")).rejects.toBeInstanceOf(NhlResponseError);
    });
  });

  describe("box scores", () => {
    it("leaves out stats a backup goalie does not have", async () => {
      const detail = await fixtureAdapter().adapter.getGameDetail("2026020333");
      const goalies = detail.boxscore.home.find((t) => t.title === "Goalies")!;
      const backup = goalies.rows.find((r) => r.player.name === "J. Swayman")!;
      const starter = goalies.rows.find((r) => r.player.name === "M. DiPietro")!;
      expect(backup.values).not.toHaveProperty("savePctg");
      expect(starter.values.savePctg).toBeCloseTo(0.905, 3);
    });

    it("splits each side into forwards, defense and goalies", async () => {
      const detail = await fixtureAdapter().adapter.getGameDetail("2026020333");
      expect(detail.boxscore.home.map((t) => [t.title, t.rows.length])).toEqual([
        ["Forwards", 12],
        ["Defense", 6],
        ["Goalies", 2],
      ]);
    });
  });

  describe("standings", () => {
    it("groups by division with common team names", async () => {
      const standings = await fixtureAdapter().adapter.getStandings();
      expect(standings.groups.map((g) => g.name)).toEqual(["Pacific", "Central", "Metropolitan", "Atlantic"]);
      expect(standings.groups[0].rows[0]).toMatchObject({
        team: { id: "EDM", name: "Oilers" },
        rank: 1,
        streak: "W6",
      });
    });

    it("maps the team page fields: splits, goal difference and division", async () => {
      const standings = await fixtureAdapter().adapter.getStandings();
      expect(standings.groups[0].rows[0]).toMatchObject({
        goalDifferential: 30,
        last10: { wins: 8, losses: 1, otLosses: 1, goalsFor: 36, goalsAgainst: 19 },
        home: { wins: 7, losses: 3, otLosses: 2, goalsFor: 43, goalsAgainst: 40 },
        road: { wins: 10, losses: 0, otLosses: 1, goalsFor: 49, goalsAgainst: 22 },
        divisionName: "Pacific",
      });
    });

    it("drops a split whose wins or losses are missing, keeping the rest", async () => {
      const { adapter } = fixtureAdapter((url, body) => {
        if (/\/standings\/now$/.test(url)) delete body.standings[0].l10Wins;
      });
      const row = (await adapter.getStandings()).groups[0].rows[0];
      expect(row.last10).toBeUndefined();
      expect(row.home).toBeDefined();
    });
  });

  describe("team page", () => {
    it("fetches the club stats and the season schedule", async () => {
      const { adapter, urls } = fixtureAdapter();
      await adapter.getTeam("TOR");
      expect(urls.sort()).toEqual([
        "https://api-web.nhle.com/v1/club-schedule-season/TOR/now",
        "https://api-web.nhle.com/v1/club-stats/TOR/now",
      ]);
    });

    it("builds Forwards, Defense and Goalies tables, best first", async () => {
      const { stats } = await fixtureAdapter().adapter.getTeam("TOR");
      expect(stats.map((t) => t.title)).toEqual(["Forwards", "Defense", "Goalies"]);
      const [forwards, defense, goalies] = stats;

      const raw = loadFixture("club-stats-TOR-now.json");
      expect(forwards.rows.length + defense.rows.length).toBe(raw.skaters.length);
      expect(goalies.rows.length).toBe(raw.goalies.length);

      expect(forwards.rows[0].player).toMatchObject({ id: "8479318", name: "Auston Matthews", position: "C" });
      expect(forwards.rows[0].values).toMatchObject({
        gamesPlayed: 24,
        goals: 13,
        assists: 19,
        points: 32,
        toi: "20:45",
      });
      expect(defense.rows[0].player.name).toBe("Darren Raddysh"); // most points among defensemen
      expect(defense.rows.every((r) => r.player.position === "D")).toBe(true);
      // Ranked by points, then goals.
      const points = forwards.rows.map((r) => r.values.points as number);
      expect(points).toEqual([...points].sort((a, b) => b - a));
    });

    it("ranks goalies by games started and keeps their rates", async () => {
      const { stats } = await fixtureAdapter().adapter.getTeam("TOR");
      const goalies = stats.find((t) => t.title === "Goalies")!;
      expect(goalies.rows.map((r) => r.player.name)).toEqual(["Sergei Bobrovsky", "Anthony Stolarz"]);
      expect(goalies.rows[0].values).toMatchObject({
        gamesStarted: 14,
        wins: 3,
        overtimeLosses: 2,
        goalsAgainstAverage: 3.649954,
        savePercentage: 0.873762,
      });
    });

    it("leaves a missing stat out instead of showing zero", async () => {
      const { adapter } = fixtureAdapter((url, body) => {
        if (/club-stats/.test(url)) delete body.goalies[1].savePercentage;
      });
      const goalies = (await adapter.getTeam("TOR")).stats.find((t) => t.title === "Goalies")!;
      expect(goalies.rows[1].values).not.toHaveProperty("savePercentage");
      expect(goalies.rows[1].values).toHaveProperty("wins");
    });

    it("drops one broken player row, not the whole table", async () => {
      const { adapter, warnings } = fixtureAdapter((url, body) => {
        if (/club-stats/.test(url)) body.skaters[0].playerId = "8475166";
      });
      const { stats } = await adapter.getTeam("TOR");
      const raw = loadFixture("club-stats-TOR-now.json");
      expect(stats[0].rows.length + stats[1].rows.length).toBe(raw.skaters.length - 1);
      expect(warnings.map((w) => w.message).join()).toMatch(/skaters\[0\] dropped/);
    });

    it("has the last five games newest first and the next five soonest first, without preseason", async () => {
      const { recent, upcoming } = await fixtureAdapter().adapter.getTeam("TOR");
      expect(recent!.map((g) => g.id)).toEqual(["2026020347", "2026020338", "2026020314", "2026020300", "2026020286"]);
      expect(recent![0]).toMatchObject({
        status: "final",
        away: { team: { id: "LAK" }, score: 4 },
        home: { score: 3 },
      });
      expect(upcoming).toHaveLength(5);
      expect(upcoming![0]).toMatchObject({ id: "2026020364", status: "scheduled", away: { team: { id: "CBJ" } } });
      // Preseason ids look like 20260100xx.
      expect([...recent!, ...upcoming!].some((g) => g.id.startsWith("2026010"))).toBe(false);
    });

    it("takes the arena from the venue most home games use", async () => {
      expect((await fixtureAdapter().adapter.getTeam("TOR")).arena).toBe("Scotiabank Arena");
    });

    it("still returns the stats when the schedule cannot be loaded", async () => {
      const adapter = new NhlAdapter({
        fetch: async (input) => {
          const url = String(input);
          if (/club-schedule-season/.test(url)) throw new TypeError("Network request failed");
          return jsonResponse(fixtureFor(url));
        },
      });
      const detail = await adapter.getTeam("TOR");
      expect(detail.stats.length).toBe(3);
      expect(detail.recent).toBeUndefined();
      expect(detail.upcoming).toBeUndefined();
      expect(detail.arena).toBeUndefined();
    });

    it("fails when the club stats cannot be loaded", async () => {
      const adapter = new NhlAdapter({
        fetch: async (input) => {
          const url = String(input);
          return /club-stats/.test(url) ? jsonResponse({}, 500) : jsonResponse(fixtureFor(url));
        },
      });
      await expect(adapter.getTeam("TOR")).rejects.toBeInstanceOf(NhlApiError);
    });

    it("has no stat tables before the season starts", async () => {
      const { adapter } = fixtureAdapter((url, body) => {
        if (/club-stats/.test(url)) {
          body.skaters = [];
          body.goalies = [];
        }
      });
      expect((await adapter.getTeam("TOR")).stats).toEqual([]);
    });
  });

  describe("leaders", () => {
    it("gives tied values the same rank", async () => {
      const boards = await fixtureAdapter().adapter.getLeaders();
      const assists = boards.find((b) => b.category === "assists")!;
      expect(assists.entries.map((e) => [e.rank, e.value])).toEqual([
        [1, 42],
        [2, 25],
        [2, 25],
      ]);
    });
  });

  // ---------- API drift ----------

  describe("API drift", () => {
    it("drops a minor field with the wrong type and warns", async () => {
      const { adapter, warnings } = fixtureAdapter((_url, body) => {
        body.playerByGameStats.homeTeam.goalies[1].savePctg = ".905";
      });
      const detail = await adapter.getGameDetail("2026020333");
      const goalies = detail.boxscore.home.find((t) => t.title === "Goalies")!;
      expect(goalies.rows[1].values).not.toHaveProperty("savePctg");
      expect(goalies.rows[1].values.saves).toBe(19);
      expect(warnings.map((w) => w.message)).toEqual(['savePctg: unexpected value ".905" (string), ignored']);
    });

    it("treats a null minor field as absent, without a warning", async () => {
      const { adapter, warnings } = fixtureAdapter((_url, body) => {
        body.games[0].venue = null;
        body.games[0].homeTeam.logo = null;
      });
      const [game] = await adapter.getScores("2026-11-17");
      expect(game.home.team.logoUrl).toBeUndefined();
      expect(warnings).toEqual([]);
    });

    it("drops a broken box score row and keeps the rest", async () => {
      const { adapter, warnings } = fixtureAdapter((_url, body) => {
        delete body.playerByGameStats.homeTeam.forwards[0].playerId;
      });
      const detail = await adapter.getGameDetail("2026020333");
      expect(detail.boxscore.home[0].rows).toHaveLength(11);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toMatch(/^forwards\[0\] dropped: .*playerId/);
    });

    it.each([
      [
        "team abbrev renamed",
        "games[0].homeTeam.abbrev",
        (b: any) => {
          b.games[0].homeTeam.teamAbbrev = b.games[0].homeTeam.abbrev;
          delete b.games[0].homeTeam.abbrev;
        },
      ],
      [
        "score is a string",
        "games[0].homeTeam.score",
        (b: any) => {
          b.games[0].homeTeam.score = "3";
        },
      ],
      [
        "game id missing",
        "games[0].id",
        (b: any) => {
          delete b.games[0].id;
        },
      ],
    ])("throws NhlResponseError when a core field breaks: %s", async (_name, path, edit) => {
      const { adapter } = fixtureAdapter((_url, body) => edit(body));
      const error = await adapter.getScores("2026-11-17").catch((e) => e);
      expect(error).toBeInstanceOf(NhlResponseError);
      expect(error.url).toBe("https://api-web.nhle.com/v1/score/2026-11-17");
      expect(error.message).toContain(path);
    });

    it("throws NhlResponseError when standings lose a core field", async () => {
      const { adapter } = fixtureAdapter((_url, body) => {
        delete body.standings[0].wins;
      });
      await expect(adapter.getStandings()).rejects.toBeInstanceOf(NhlResponseError);
    });
  });

  // ---------- Transport errors ----------

  describe("transport errors", () => {
    it("wraps an HTTP error status", async () => {
      const adapter = new NhlAdapter({ fetch: async () => jsonResponse({}, 503) });
      const error = await adapter.getStandings().catch((e) => e);
      expect(error).toBeInstanceOf(NhlApiError);
      expect(error.status).toBe(503);
    });

    it("wraps a body that is not JSON", async () => {
      const adapter = new NhlAdapter({ fetch: async () => new Response("<html>down</html>") });
      const error = await adapter.getStandings().catch((e) => e);
      expect(error).toBeInstanceOf(NhlApiError);
      expect(error.message).toMatch(/invalid JSON/);
    });

    it("wraps a network failure", async () => {
      const adapter = new NhlAdapter({
        fetch: async () => {
          throw new TypeError("Network request failed");
        },
      });
      await expect(adapter.getScores("2026-11-17")).rejects.toThrow(/NHL API request failed/);
    });

    it("times out a request that never answers, without AbortSignal.timeout (missing in Hermes)", async () => {
      const original = AbortSignal.timeout;
      // @ts-expect-error simulate React Native, where AbortSignal.timeout does not exist
      AbortSignal.timeout = undefined;
      try {
        const adapter = new NhlAdapter({
          timeoutMs: 10,
          fetch: (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
            }),
        });
        await expect(adapter.getStandings()).rejects.toThrow("NHL API request failed: timed out after 10 ms");
      } finally {
        AbortSignal.timeout = original;
      }
    });
  });
});
