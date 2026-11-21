// How long each kind of data stays fresh, based on game status.
// League-agnostic: it only reads domain types.

import type { Game, GameDetail, TeamDetail } from "../domain";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const FRESHNESS = {
  /** A game is in progress: scores change every few seconds. */
  live: 20 * SECOND,
  /** A game starts within this window (or should have started): watch for puck drop. */
  startingSoonWindow: 15 * MINUTE,
  startingSoon: 1 * MINUTE,
  /** Scheduled later today or tomorrow. */
  scheduled: 5 * MINUTE,
  /** Scheduled more than a day away: only start times can change. */
  scheduledFar: 1 * HOUR,
  /** Finished within the last day: stat corrections still happen. */
  recentFinal: 1 * HOUR,
  /** Just finished but the three stars are not named yet: they usually follow within minutes. */
  awaitingStars: 2 * MINUTE,
  /** How long after the start time a finished game still waits for its stars. */
  awaitingStarsWindow: 6 * HOUR,
  /** Finished more than a day ago. */
  oldFinal: 7 * DAY,
  /** No games on the date: the schedule could still be published. */
  noGames: 1 * HOUR,
  standings: 10 * MINUTE,
  /** Season totals only change when a game ends. */
  team: 30 * MINUTE,
  /** The team is playing (or about to): its stats and games are about to change. */
  teamLive: 1 * MINUTE,
  leaders: 30 * MINUTE,
  /** A player's page: season totals and recent games only change when one of their games ends. */
  player: 30 * MINUTE,
} as const;

/** How long one game stays fresh. */
export function gameFreshness(game: Game, now: number): number {
  const start = Date.parse(game.startTime);
  switch (game.status) {
    case "live":
      return FRESHNESS.live;
    case "scheduled": {
      const untilStart = start - now;
      if (untilStart <= FRESHNESS.startingSoonWindow) return FRESHNESS.startingSoon;
      if (untilStart > DAY) return FRESHNESS.scheduledFar;
      return FRESHNESS.scheduled;
    }
    case "final":
      // Games last about three hours, so "started over a day ago" means finished a while back.
      return now - start > DAY ? FRESHNESS.oldFinal : FRESHNESS.recentFinal;
    case "postponed":
      return FRESHNESS.recentFinal;
  }
}

/** A game page: as fresh as its game, but re-checked soon after the final until the three stars arrive. */
export function gameDetailFreshness(detail: GameDetail, now: number): number {
  const { game } = detail;
  const waiting =
    game.status === "final" && !detail.threeStars && now - Date.parse(game.startTime) < FRESHNESS.awaitingStarsWindow;
  return waiting ? Math.min(FRESHNESS.awaitingStars, gameFreshness(game, now)) : gameFreshness(game, now);
}

/** A day of scores is as fresh as its most urgent game. */
export function scoresFreshness(games: Game[], now: number): number {
  if (games.length === 0) return FRESHNESS.noGames;
  return Math.min(...games.map((g) => gameFreshness(g, now)));
}

/**
 * A team page is as fresh as the team's games allow: short while it plays or is about to (or just
 * started on a stale schedule), otherwise a long time, since season totals change once a game ends.
 */
export function teamFreshness(detail: TeamDetail, now: number): number {
  const playingSoon = (detail.recent ?? []).concat(detail.upcoming ?? []).some((g) => {
    if (g.status === "live") return true;
    const untilStart = Date.parse(g.startTime) - now;
    // A scheduled game that should have started up to 3 hours ago is still waiting to be updated.
    return g.status === "scheduled" && untilStart <= FRESHNESS.startingSoonWindow && untilStart > -3 * HOUR;
  });
  return playingSoon ? FRESHNESS.teamLive : FRESHNESS.team;
}
