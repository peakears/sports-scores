# Hat Trick (sports scores app)

Free, open-source Android app (Expo / React Native): NHL scores, standings, leaders and box scores first, more leagues later. Package `io.github.peakears.hattrick`, repo `peakears/hat-trick`. Not on app stores: users install the APK attached to each GitHub Release, or build it. Everything runs on the device, no backend. Data comes from public APIs. Versions and dates: GitHub Releases and CHANGELOG.md.

## Architecture (data flows up)

adapters -> domain model -> on-device cache -> Expo app UI

- `src/domain.ts`: league-agnostic types and the `LeagueAdapter` contract. Nothing here knows raw API shapes. `src/registry.ts`: `AdapterRegistry`, adapter by league id.
- `src/adapters/nhl/`: `client.ts` (HTTP), `errors.ts`, `constants.ts`; `raw-types.ts` (zod schemas, types inferred) and `validate.ts` (policy); `mappers.ts` (raw -> domain); `adapter.ts` (fetch -> validate -> map); `__fixtures__/` (real responses recorded 2026-11-17; club stats and the Toronto schedule 2026-11-20). `getGameDetail` reads the box score plus, best effort, `/score/{gameDate}` for the goals (the box score has none); if that call fails the game just has no goals. Final games also read `/gamecenter/{id}/landing` (best effort) for `threeStars`, joined to the box score by player id for saves and TOI; `gameDetailFreshness` re-checks a final game every 2 min for 6 h after puck drop until the stars arrive.
- `src/data/`: the only thing the UI calls. `sports-data.ts` (`SportsData`: cache-first reads returning `Fetched<T>` = `{ data, meta }`, offline fallback to last known data, shared in-flight requests, `prune()`), `freshness.ts` (TTL by game status), `store.ts`, `types.ts`.
- `src/ui/`: React Native code shared by screens. Files named below as pure have no React Native imports and are tested in `ui.test.ts` or their own test file.
  - `sports-data-context.tsx` creates the one `SportsData` (NHL adapter + `AsyncStorageStore`), prunes on start; `LEAGUE` is the shown league.
  - `use-polled.ts` `usePolled(key, load)`: loads through `SportsData`, re-polls at `meta.staleAt` (`polling.ts`, pure), pauses in the background. `refresh()` forces a fetch, but `canManualRefresh()` ignores it while the data on screen is under 30 s old (never when nothing loaded or the data is an offline fallback).
  - `format.ts` (pure): Scores order and sections (`groupGamesForScores`), season records from standings, venue label, date picker conversions (local noon, so DST cannot shift the day).
  - `favorites.ts`, `reminders.ts` (pure: plans puck drop reminders for favourite teams and diffs them against what is scheduled) with `reminders-native.ts` (the only `expo-notifications` code) and `use-reminders.ts`.
  - `updates.ts` (pure: version compare, release parsing, daily-limited check) with `update-context.tsx` and `links.ts`; `release-notes.ts` (pure: the release body as plain sections for `ReleaseNotesModal`, the "What's new" sheet the banner opens); `install-update.ts` (pure install flow: download, size and SHA-256 checks, installer, cleanup; a download that sends nothing for `DOWNLOAD_STALL_MS` fails and the user can cancel one, so the update is never stuck busy; device steps are passed in as ports) and `updates-native.ts` (the only file-system and installer code).
  - `broadcasts.ts` (pure: one country's channels, national first; cards show them only for scheduled and live games, at most 3 plus "+N") with `use-tv-region.ts` (`tvRegion` setting, or the phone's region via `expo-localization`). `WhereToWatch` is the full list on the game page.
  - `spoilers.ts` (pure) with `spoiler-context.tsx`: the shield only changes what is drawn (scores, SOG, goals, three stars, box score, final records); data is still fetched and cached. Reveals are in memory only. Standings and Leaders are deliberately not shielded.
  - `goals.ts` (pure) with `components/GoalSummary.tsx`; `swipe.ts` (pure), `use-swipe.ts`, `use-debounced.ts`: on Scores a swipe or arrow changes the day and the day you stop on loads 250 ms later, so quick swiping makes no request per day passed.
  - `use-today.ts`: Scores' "Today" rolls over at 5am local, so late games stay under Today.
  - `settings.ts` (pure: defaults, zod parse with per-field fallback, stored under `settings:v1`) with `settings-context.tsx`. A new preference needs a default and a `.catch()` schema field, no version bump.
  - `team.ts` (pure: division rank line, last 10 / home / road lines) feeds the team page, which reads its `StandingRow` from the same `standings` cache entry as the Standings tab, so the header and records cost no request of their own. `FavoriteStar` lives in the team page header. Recent and upcoming games are compact one-line rows from the team's side (`teamGameLine`: opponent, home or road, result or live score, nothing while the spoiler shield hides the game), three at first (`TEAM_GAMES_COLLAPSED`) with a "Show more" toggle. Its games and season tables come from `team:{id}` (`SportsData.getTeam`, `teamFreshness`) in a separate `usePolled`, so a failed request never hides the standings numbers. `LeagueAdapter.getTeam()` reads `/club-stats/{team}/now` (the response has no team name and a string `season`) and, best effort like the goals, `/club-schedule-season/{team}/now`: if the schedule fails the stats still show. `TeamDetail.arena` is the venue most of the team's home games use (the schedule has no city). The roster endpoint is not used yet; there is no coach in these endpoints.
  - `player.ts` (pure: bio rows, age on the device's date, height and weight in both units, game and season labels, season filter) feeds the player page. `LeagueAdapter.getPlayer()` reads `/player/{id}/landing` (one request: bio, this season, career, last 5 games, every season in every league); `SportsData.getPlayer` caches it as `player:{id}` for 30 min (`FRESHNESS.player`). Seasons are newest first (the API's order reversed; its `sequence` field is not an order outside the NHL). `PlayerSeasonLine.inLeague` marks NHL seasons; the page shows those by default with an "Include other leagues" switch.
  - `components/StatGrid` is the generic stats table (fixed first column, sideways-scrolling stats, optional tap per row); `StatTableView` wraps it for player tables and links each name to the player page.
  - `TeamLogo` uses expo-image (NHL logos are SVG) and falls back to an abbreviation badge; `PlayerHeadshot` (player photos, `stars.ts` pure text helpers) falls back to initials. Both follow the `showLogos` setting ("Show logos and photos").
- `app/`: Expo Router. `(tabs)/` has Scores (`index`), Standings, Leaders, Settings. `game/[id]/index` is the game page (score, records, venue, where to watch, three stars, goals, a row opening the box score) and `game/[id]/box-score` the player stats; `team/[id]` is the team page (opened from Standings rows and the team names on the game page; header, records, recent and upcoming games, season stats); `player/[id]` is the player page (opened from the three stars, Leaders rows, box score rows and team season stats; header, this season, last games, bio, career, by season); open games with `pathname: "/game/[id]"`. Both read the same `game:{id}` cache entry; the game page also loads standings for records (the box score has none). The root layout wraps the app in `SettingsProvider` and `SportsDataProvider`; it and the game, team and player pages export an `ErrorBoundary` (`CrashScreen`).
- `app.json` is static Expo config; `app.config.ts` adds `version` and `versionCode` from `package.json`, so never put a version in `app.json`. `android/` is generated by `expo prebuild`, not committed.
- `src/contract/league-adapter.contract.ts`: suite every `LeagueAdapter` must pass; a new league's test calls `runLeagueAdapterContract()` with fixture-backed adapters.

## Rules

- Only an adapter may touch raw API shapes. Everything above it uses domain types. Team ids are three-letter abbreviations.
- Validation: core fields (ids, teams, scores, game state, standings W/L) use plain zod and throw `NhlResponseError`. Minor fields use `minor()` and are dropped with an `onWarning` call. Lists (box score rows, goals, broadcasts) use `lenientArray()`: one bad item is dropped, not the whole response.
- The NHL API (api-web.nhle.com) is unofficial and unreachable from Claude sessions. `raw-types.ts` was verified against live responses on 2026-11-17 (club stats and schedule, the landing's three stars, and the player landing for a skater and a goalie: 2026-11-20); still unverified: postponed game states, standings `clinchIndicator`, goal strength `"sh"`, goalModifier `"penalty-shot"`, the landing for live games, and the player landing for a retired or teamless player (`currentTeamAbbrev` is treated as optional). Anything new (play-by-play, roster, other landing fields) needs a recorded fixture first, which the user records locally.
- All code outside tests must run in React Native (Hermes): no Node-only or browser-only APIs (e.g. no `AbortSignal.timeout`). Tests use `tsconfig.test.json` (Node types).
- The UI never calls adapters; screens call `SportsData` through `usePolled`. TTLs live in `freshness.ts`.
- Cached entries live under `cache:` keys with a `CACHE_VERSION`. Bump it whenever the shape of a domain type changes, or old cached data is read as the new shape.
- Tests never hit the live API: use recorded fixtures, and simulate drift by editing a fixture in the test.
- API keys (future leagues) are entered by the user and stored with `expo-secure-store`; never commit keys. Keyless leagues like NHL must work with no setup.
- Network calls: the NHL API and GitHub. Update checks use `api.github.com/repos/peakears/hat-trick/releases/latest` (daily at most; switch in Settings). An APK is downloaded only when the user taps Update, only from this repo's release links (`isReleaseApkUrl`, `isReleasePageUrl`: they match the whole URL, not a prefix, so `..` cannot leave the repo; stored links are checked again on read), into the cache folder (never Downloads), then Android's installer opens; the file is deleted after a failed or cancelled install and on next launch. Keep the README's privacy line true.
- Never commit league logos, player photos or other trademarked assets (their URLs come from the API at runtime). The app icon is original artwork generated by `scripts/icons/generate.py` (rendered by `render.cjs`): change the script, not the PNGs.

## On-device constraints

- Live updates come from polling while the app is open (cache TTL). No server, so no reliable push while closed; local notifications are fine (puck drop reminders use `expo-notifications` date triggers; Android may delay them a few minutes). `expo-notifications` bundles Firebase Messaging, which matters for F-Droid/IzzyOnDroid (#27).
- Android/iOS only: the NHL API probably blocks browser (CORS) requests, so an Expo web build would need a proxy.

## Roadmap

Open work lives in GitHub issues, the source of truth; do not copy it here. Design notes an issue does not hold:

- Betting info (#7): opt-in, behind the settings switch, only if a usable source exists (NHL partner odds, else a keyed odds API with the user's own key). Display only: no sportsbook links or affiliate codes (that would make the app commercial). Add a README note: odds are restricted in some places.
- Alternate app icons (#9): colour variants from `generate.py` as `activity-alias` entries; needs a config plugin for `expo prebuild`.
- Second league (#8): needs a league switcher (replacing the fixed `LEAGUE` constant) and an adapter that passes the contract. Golf needs new domain types. Good time to split `mappers.ts` and `settings.tsx` if they have grown.

## Commits and releases

- Conventional Commits (`type(scope): subject`, scope optional), checked by a husky hook (commitlint) and in CI. `feat` is a minor bump, `fix` a patch; `feat!:` or a `BREAKING CHANGE:` footer is major, avoid unless there is a real reason. `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `style` cause no release (`perf` is in the changelog).
- release-please (`.github/workflows/release-please.yml`) keeps a release PR open with the next version and CHANGELOG. Merging it creates a draft GitHub Release; the workflow builds the APK, attaches it, then publishes the release (which creates the tag). Never edit the version in `package.json` or `.release-please-manifest.json` by hand.
- APKs: `.github/workflows/android-apk.yml` (`expo prebuild` + Gradle, JDK 17). Releases are signed from the `ANDROID_KEYSTORE_*` / `ANDROID_KEY_*` secrets (never commit a keystore). PRs get a debug-key test APK (artifact, `arm64-v8a` only); it is not a required check.
- **Before merging a release PR**, check the docs are current (README features and Settings line, the roadmap here) and the release PR's version and changelog. If something is stale, fix it in a `docs/...` PR and merge that first: merging the release PR publishes immediately.
- Workflow: one branch per feature from `main` (`feat/...`, `fix/...`, `docs/...`), one PR each, squash-merged (the PR title becomes the commit, so it must be a Conventional Commit). PR bodies have a summary and a Testing checklist (typecheck, tests, bundle, on a device). Feature PRs update the README and this file in the same PR.
- Open PRs often conflict in `src/ui/format.ts`, the `ui.test.ts` imports and the docs: merge one, rebase the next onto `main`, keep both sides, run typecheck and tests, push with `--force-with-lease=<branch>:<old sha>`.

## Keeping this file relevant

This file holds what is not obvious from the code: the architecture map, rules and gotchas, workflow and commands. Length is fine as long as everything in it is still relevant; stale or historical content is not.

- Do not add history or "Done" lists (git log, Releases and CHANGELOG.md hold them), version numbers, the current `CACHE_VERSION`, or copies of issue text or feature descriptions (README, issues and code comments have them).
- When a change alters behaviour, edit the one bullet it affects, in place. Do not append a new paragraph, and delete what has become stale.

## Commands

- `npm install`, `npm run typecheck` (app + tests), `npm test` (vitest), `npm run format` (Prettier, `printWidth` 120; CI runs `format:check`, so run it before committing).
- `npm start` (Expo Go), `npm run android` (native build, needs the Android SDK). Expo Go keeps the old bundle after a dev server restart: press `r` (or shake the phone, Reload) after switching branches.
- `CI=1 npx expo export --platform android --output-dir <tmp dir>` checks that Metro can bundle the app without a device.
- Add Expo packages with `npx expo install <pkg>` (matches the SDK). If api.expo.dev is unreachable, take the version from `node_modules/expo/bundledNativeModules.json` and `npm install` it. `react-dom` is pinned to the same version as `react`.
- `npm audit` advisories are build tooling only. Do not run `npm audit fix --force` (it downgrades vitest and breaks Expo).
