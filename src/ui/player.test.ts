import { describe, expect, it } from "vitest";
import type { PlayerDetail, PlayerSeasonLine } from "../domain";
import {
  ageOn,
  bioRows,
  draftLabel,
  filterSeasons,
  gameLineLabel,
  handednessLabel,
  hasOtherLeagues,
  heightLabel,
  playerSubtitle,
  positionLabel,
  seasonLineLabel,
  shortDate,
  weightLabel,
} from "./player";

const doughty: PlayerDetail = {
  player: { id: "8474563", league: "nhl", name: "Drew Doughty", teamId: "LAK", position: "D" },
  sweaterNumber: 8,
  team: { id: "LAK", league: "nhl", name: "Los Angeles Kings", abbrev: "LAK" },
  active: true,
  goalie: false,
  bio: {
    birthDate: "1989-12-08",
    birthPlace: "London, Ontario, CAN",
    heightCm: 185,
    heightIn: 73,
    weightKg: 95,
    weightLb: 210,
    handedness: "R",
    draft: { year: 2008, teamId: "LAK", round: 1, overallPick: 2 },
  },
  season: [],
  career: { regularSeason: [], playoffs: [] },
  lastGames: { columns: [], games: [] },
  seasons: { columns: [], rows: [] },
};

describe("player bio", () => {
  it("works out the age, counting the birthday itself", () => {
    expect(ageOn("1989-12-08", "2026-12-07")).toBe(36);
    expect(ageOn("1989-12-08", "2026-12-08")).toBe(37);
    expect(ageOn("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageOn("bad", "2026-12-08")).toBeUndefined();
  });

  it("formats height, weight, handedness, draft and position", () => {
    expect(heightLabel(doughty.bio)).toBe("6′1″ (185 cm)");
    expect(heightLabel({ heightCm: 185 })).toBe("185 cm");
    expect(heightLabel({})).toBeUndefined();
    expect(weightLabel(doughty.bio)).toBe("210 lb (95 kg)");
    expect(handednessLabel("R", false)).toBe("Shoots right");
    expect(handednessLabel("L", true)).toBe("Catches left");
    expect(handednessLabel(undefined, true)).toBeUndefined();
    expect(draftLabel(doughty.bio)).toBe("2008, round 1, #2 overall by LAK");
    expect(draftLabel({})).toBe("Undrafted");
    expect(positionLabel("D")).toBe("Defence");
    expect(positionLabel("X")).toBe("X");
  });

  it("lists the bio rows, leaving out what is unknown", () => {
    expect(bioRows(doughty, "2026-11-21")).toEqual([
      { label: "Born", value: "Dec 8, 1989 (age 36)" },
      { label: "Birthplace", value: "London, Ontario, CAN" },
      { label: "Height", value: "6′1″ (185 cm)" },
      { label: "Weight", value: "210 lb (95 kg)" },
      { label: "Shoots", value: "right" },
      { label: "Draft", value: "2008, round 1, #2 overall by LAK" },
    ]);
    expect(bioRows({ ...doughty, goalie: true, bio: { handedness: "L" } }, "2026-11-21")).toEqual([
      { label: "Catches", value: "left" },
      { label: "Draft", value: "Undrafted" },
    ]);
  });

  it("sums up team, number and position", () => {
    expect(playerSubtitle(doughty)).toBe("LAK · #8 · Defence");
    expect(playerSubtitle({ ...doughty, team: undefined, sweaterNumber: undefined, active: false })).toBe(
      "Defence · Inactive",
    );
  });
});

describe("player games and seasons", () => {
  it("labels a recent game", () => {
    const game = { gameId: "1", date: "2026-11-19", teamId: "LAK", opponentId: "TOR", values: {} };
    expect(gameLineLabel({ ...game, home: false })).toBe("Nov 19 @ TOR");
    expect(gameLineLabel({ ...game, home: true })).toBe("Nov 19 vs TOR");
    expect(shortDate("2026-01-05")).toBe("Jan 5");
  });

  const line = (season: string, inLeague: boolean, playoffs: boolean): PlayerSeasonLine => ({
    season,
    team: inLeague ? "Kings" : "Canada",
    league: inLeague ? "NHL" : "OG",
    inLeague,
    playoffs,
    values: {},
  });
  const rows = [line("2026-27", true, false), line("2025-26", false, false), line("2025-26", true, true)];

  it("filters seasons by league and season type", () => {
    expect(filterSeasons(rows, { playoffs: false, allLeagues: false }).map((r) => r.season)).toEqual(["2026-27"]);
    expect(filterSeasons(rows, { playoffs: false, allLeagues: true })).toHaveLength(2);
    expect(filterSeasons(rows, { playoffs: true, allLeagues: false }).map((r) => r.season)).toEqual(["2025-26"]);
    expect(hasOtherLeagues(rows)).toBe(true);
    expect(hasOtherLeagues([rows[0]])).toBe(false);
  });

  it("labels a season, naming the league outside the NHL", () => {
    expect(seasonLineLabel(rows[0])).toEqual({ label: "2026-27 Kings", detail: undefined });
    expect(seasonLineLabel(rows[1])).toEqual({ label: "2025-26 Canada", detail: "OG" });
  });
});
