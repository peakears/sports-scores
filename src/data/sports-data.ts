// The on-device data layer: the only thing the UI calls.
// adapters -> domain model -> SportsData (cache + metadata) -> UI
//
// - Fresh cached data is returned without a network call.
// - Stale or missing data is fetched; the result is cached with a TTL based on game status.
// - If a fetch fails and anything is cached, the last known data is returned, marked stale.
// - Concurrent requests for the same key share one network call.

import type {
  Game,
  GameDetail,
  LeaderBoard,
  LeaderQuery,
  LeagueId,
  RequestOptions,
  Standings,
  PlayerDetail,
  TeamDetail,
} from "../domain";
import type { AdapterRegistry } from "../registry";
import { FRESHNESS, gameDetailFreshness, scoresFreshness, teamFreshness } from "./freshness";
import type { KeyValueStore } from "./store";
import type { DataMeta, Fetched, FetchOptions } from "./types";

/** Bump when the shape of cached domain data changes, so old entries are ignored. */
export const CACHE_VERSION = 7;

/** Storage keys are prefixed so the cache can share a store with app settings. */
const PREFIX = "cache:";

interface CacheEntry<T> {
  v: number;
  data: T;
  fetchedAt: number;
  staleAt: number;
  warnings: string[];
}

export interface SportsDataOptions {
  registry: AdapterRegistry;
  store: KeyValueStore;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Resource<T> {
  league: LeagueId;
  key: string;
  load: (options: RequestOptions) => Promise<T>;
  freshFor: (data: T, now: number) => number;
}

export class SportsData {
  private readonly registry: AdapterRegistry;
  private readonly store: KeyValueStore;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<Fetched<unknown>>>();

  constructor(options: SportsDataOptions) {
    this.registry = options.registry;
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  getScores(league: LeagueId, date: string, options?: FetchOptions): Promise<Fetched<Game[]>> {
    return this.get(
      {
        league,
        key: `${league}:scores:${date}`,
        load: (o) => this.registry.get(league).getScores(date, o),
        freshFor: scoresFreshness,
      },
      options,
    );
  }

  getStandings(league: LeagueId, options?: FetchOptions): Promise<Fetched<Standings>> {
    return this.get(
      {
        league,
        key: `${league}:standings`,
        load: (o) => this.registry.get(league).getStandings(o),
        freshFor: () => FRESHNESS.standings,
      },
      options,
    );
  }

  getLeaders(league: LeagueId, query: LeaderQuery = {}, options?: FetchOptions): Promise<Fetched<LeaderBoard[]>> {
    const category = query.category ?? "default";
    const limit = query.limit ?? "default";
    return this.get(
      {
        league,
        key: `${league}:leaders:${category}:${limit}`,
        load: (o) => this.registry.get(league).getLeaders(query, o),
        freshFor: () => FRESHNESS.leaders,
      },
      options,
    );
  }

  getGameDetail(league: LeagueId, gameId: string, options?: FetchOptions): Promise<Fetched<GameDetail>> {
    return this.get(
      {
        league,
        key: `${league}:game:${gameId}`,
        load: (o) => this.registry.get(league).getGameDetail(gameId, o),
        freshFor: (detail, now) => gameDetailFreshness(detail, now),
      },
      options,
    );
  }

  getTeam(league: LeagueId, teamId: string, options?: FetchOptions): Promise<Fetched<TeamDetail>> {
    return this.get(
      {
        league,
        key: `${league}:team:${teamId}`,
        load: (o) => this.registry.get(league).getTeam(teamId, o),
        freshFor: (detail, now) => teamFreshness(detail, now),
      },
      options,
    );
  }

  getPlayer(league: LeagueId, playerId: string, options?: FetchOptions): Promise<Fetched<PlayerDetail>> {
    return this.get(
      {
        league,
        key: `${league}:player:${playerId}`,
        load: (o) => this.registry.get(league).getPlayer(playerId, o),
        freshFor: () => FRESHNESS.player,
      },
      options,
    );
  }

  /**
   * Removes cache entries that have been stale for longer than `olderThanMs`
   * (default 30 days), plus entries from an old CACHE_VERSION. Call on app start.
   */
  async prune(olderThanMs = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = this.now() - olderThanMs;
    let removed = 0;
    for (const storeKey of await this.store.keys()) {
      if (!storeKey.startsWith(PREFIX)) continue;
      const key = storeKey.slice(PREFIX.length);
      const entry = await this.read(key);
      if (!entry || entry.staleAt < cutoff) {
        await this.store.delete(storeKey);
        removed++;
      }
    }
    return removed;
  }

  // ---------- Internals ----------

  private async get<T>(resource: Resource<T>, options: FetchOptions = {}): Promise<Fetched<T>> {
    const cached = await this.read<T>(resource.key);
    if (cached && !options.force && this.now() < cached.staleAt) {
      return { data: cached.data, meta: this.meta(resource, cached, "cache") };
    }

    // Share one network call between concurrent callers for the same key.
    const pending = this.inFlight.get(resource.key) as Promise<Fetched<T>> | undefined;
    if (pending) return pending;

    const request = this.refresh(resource, cached).finally(() => {
      this.inFlight.delete(resource.key);
    });
    this.inFlight.set(resource.key, request);
    return request;
  }

  private async refresh<T>(resource: Resource<T>, cached: CacheEntry<T> | null): Promise<Fetched<T>> {
    const warnings: string[] = [];
    let data: T;
    try {
      data = await resource.load({ onWarning: (w) => warnings.push(w.message) });
    } catch (err) {
      if (!cached) throw err;
      // Offline or API down: show the last known data, flagged as stale.
      return {
        data: cached.data,
        meta: { ...this.meta(resource, cached, "cache"), error: (err as Error).message },
      };
    }

    const fetchedAt = this.now();
    const entry: CacheEntry<T> = {
      v: CACHE_VERSION,
      data,
      fetchedAt,
      staleAt: fetchedAt + resource.freshFor(data, fetchedAt),
      warnings,
    };
    try {
      await this.store.set(PREFIX + resource.key, JSON.stringify(entry));
    } catch {
      // Storage full or unavailable: still return the fresh data.
    }
    return { data, meta: this.meta(resource, entry, "network") };
  }

  private async read<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const text = await this.store.get(PREFIX + key);
      if (!text) return null;
      const entry = JSON.parse(text) as CacheEntry<T>;
      if (entry?.v !== CACHE_VERSION || typeof entry.staleAt !== "number") return null;
      return entry;
    } catch {
      return null; // Corrupt entry or unreadable storage: treat as a miss.
    }
  }

  private meta<T>(resource: Resource<T>, entry: CacheEntry<T>, source: DataMeta["source"]): DataMeta {
    return {
      league: resource.league,
      key: resource.key,
      source,
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      staleAt: new Date(entry.staleAt).toISOString(),
      stale: this.now() >= entry.staleAt,
      warnings: entry.warnings,
    };
  }
}
