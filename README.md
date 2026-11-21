# Hat Trick

A clean, open-source sports scores app for Android. NHL first, more leagues later.

Everything runs on your device: the app talks to public sports APIs directly, with no backend server to host.

> **Status: released.** The NHL app works on Android phones. Download the latest APK from [Releases](https://github.com/peakears/hat-trick/releases) (see [Install](#install)). New features are on the [Roadmap](#roadmap).

## Features

- **Scores** for any date, with live game clocks. Games are grouped under Live, Upcoming and Final headers. Upcoming games show each team's season record. Swipe left or right, or use the arrows, to step a day, or tap the calendar to jump to any date; tap the date to return to today. Pull down to refresh; a pull within 30 seconds of the last update is ignored, to save requests.
- **Favourite teams:** star a team on its team page. Their games show first on Scores with the team name in the accent colour, and Standings marks them.
- **Puck drop reminders** (optional): a notification 10 to 60 minutes before your favourite teams' games, even with the app closed.
- **TV channels:** each game shows where to watch it, for your country (Canada or US, from your phone's region, or set it in Settings). National channels are bold, and the Scores list shows the first three for games that have not finished. The game page has the full list ("Aired on" once the game is over). Games with no listing for your country show nothing.
- **Spoiler shield** (optional, off by default): hides scores, goals, three stars and box scores until you tap Show, for watching games on delay. Reveal one game or all games. Standings and leaders are not hidden. Nothing is saved, so every app launch starts hidden.
- **Game page:** score, each team's season record and shots on goal, where it is played (arena and city), the three stars once a game is over (with player photos, and saves or goals, assists and ice time), a goal-by-goal summary (scorer, assists, power-play and empty-net tags, running score), and a Box score page with player stats for both teams.
- **Standings** by division. Tap a team (here or on a game page) for its team page: record, points, streak, goal difference, last 10, home and road records, its division rank, its home arena, its recent and upcoming games (three of each, one compact line per game, with up to five behind "Show more"; each opens the game), and season stats for every skater and goalie.
- **Player pages:** tap a player in the three stars, Leaders, a box score or a team's season stats. Shows their photo, team, number and position, this season's stats, their last five games (each opens the game), a bio (age, birthplace, height and weight, shoots or catches, draft), career totals and every season, regular season or playoffs, with an option to include junior, minor and international leagues.
- **Stat leaders** for skaters and goalies.
- **Settings:** light, dark or system theme, team logos and player photos on or off (off shows abbreviations and initials), TV channel country, spoiler shield, favourite teams, reminders and update checks.
- **Update notice:** a banner when a newer release is available, checked at most once a day (switchable). Tap **Update** in the banner (or in **Settings > About**) and the app downloads the new APK into its own private cache, checks its size and checksum, and opens Android's installer; you tap Install. You can cancel the download, and one that stops for 30 seconds is given up. The file is deleted afterwards, so nothing piles up in your Downloads folder. If that fails, **Open in browser** is the fallback. **Settings > About** shows the version, release notes and a "Report a problem" link that opens a GitHub issue with your app version filled in.
- **Works offline** with the last data it fetched. Live games refresh about every 20 seconds while the app is open.
- No account, no ads, no tracking: the app talks only to the NHL's public API and GitHub (the update notice, and the update itself when you tap Update).

## Install

Each [release](https://github.com/peakears/hat-trick/releases) has an APK attached (`hat-trick-vX.Y.Z.apk`).

1. On your Android phone, open the latest release and download the `.apk`.
2. Open the downloaded file. Android asks you to allow installs from that app (your browser or Files): allow it, then tap **Install**.
3. To update, install the newer APK the same way. It replaces the old version and keeps your data. The app shows a notice when a newer release is available, and can install it for you (Android asks once to allow installs from Hat Trick).

Android may warn that the app is from an unknown developer, because it is not from the Play Store. That is expected for a sideloaded app.

The app contacts only the NHL's public API (for game data) and GitHub (once a day, to see whether a newer release exists; you can turn this off in Settings). The app only downloads an update when you tap Update, only from this project's GitHub releases, and Android's installer accepts it only if it is signed with the same release key.

Every pull request also gets a test APK, under **Artifacts** on its CI run. Test APKs are signed with a different key than releases, so Android will not install one over a release (or the other way round): uninstall first.

## Getting started

Requires Node.js 22.13 or newer.

```sh
git clone https://github.com/peakears/hat-trick.git
cd hat-trick
npm install
npm run format:check
npm run typecheck
npm test
```

### Run it on your phone (quickest)

1. Install **Expo Go** from the Play Store.
2. Run `npm start` and scan the QR code with Expo Go. Your phone and computer must be on the same network (or use `npm start -- --tunnel`).

### Build an APK

Needs the Android SDK and a JDK (installing Android Studio gives you both), and a phone with USB debugging on or an emulator:

```sh
npx expo run:android --variant release
```

This builds the native project into `android/` (not committed) and installs the app. The release build is signed with a debug key, which is fine for your own devices. Android will not install it over an APK from the releases page (different key), so uninstall that first.

The NHL needs no API key or signup. Leagues added later may need a key; you will enter it in the app's settings, where it stays on your device. Never commit API keys to the repo.

## How it works

Data flows up through layers, and only the bottom layer knows any league's raw API format:

```
league adapters -> domain model -> on-device cache -> app UI
```

- `src/domain.ts`: league-agnostic types and the `LeagueAdapter` contract
- `src/registry.ts`: looks up an adapter by league id
- `src/adapters/nhl/`: the NHL adapter
- `src/data/`: on-device cache; refreshes live games every 20 seconds, keeps finished games for days, and serves the last known data when offline
- `src/ui/`: React Native pieces shared by screens (polling hook, settings, components, formatting)
- `app/`: the screens, using [Expo Router](https://docs.expo.dev/router/introduction/) (one file per route): the Scores, Standings, Leaders and Settings tabs, and the game page

Settings (including favourite teams) are stored on the device, separately from cached data. Puck drop reminders are local notifications scheduled on the device. The TV country is read from the phone's region setting, with no location permission and no network request. The only other network request is the daily update check against GitHub.

Adding a league means writing a new adapter that implements `LeagueAdapter` and passes the shared contract tests in `src/contract/`. Nothing above it changes.

### Tech stack

- **App:** [Expo](https://expo.dev/) and React Native, written in TypeScript, with [Expo Router](https://docs.expo.dev/router/introduction/) for screens.
- **Data:** [zod](https://zod.dev/) validates the responses of the unofficial NHL API, AsyncStorage holds the on-device cache and settings, and expo-image draws team logos and player photos.
- **Tests and tooling:** [vitest](https://vitest.dev/) (tests run on recorded API responses, never the live API), Prettier, and commitlint with husky for Conventional Commits.
- **Releases:** GitHub Actions builds the APKs, and release-please keeps the release PR and changelog.

## Roadmap

What each version added is on the [Releases page](https://github.com/peakears/hat-trick/releases) and in [CHANGELOG.md](CHANGELOG.md).

Planned (each links to its issue):

- [Player pages](https://github.com/peakears/hat-trick/issues/15): tap a player for bio (age, hometown, position, draft) and season/career stats, including goalie stats
- [Play-by-play and penalty log](https://github.com/peakears/hat-trick/issues/28) on the game page
- [Three stars](https://github.com/peakears/hat-trick/issues/39) for finished games and [more standings views](https://github.com/peakears/hat-trick/issues/38) (conference, wild card, league)
- [Spoiler shield](https://github.com/peakears/hat-trick/issues/29) (hide scores until tapped) and [starting goalies](https://github.com/peakears/hat-trick/issues/30) on upcoming games
- [Betting odds](https://github.com/peakears/hat-trick/issues/7), if a usable source exists (off by default)
- [More customization](https://github.com/peakears/hat-trick/issues/53) in Settings (colours, what each game card shows)
- [Alternate app icons](https://github.com/peakears/hat-trick/issues/9), picked in Settings
- [A second league](https://github.com/peakears/hat-trick/issues/8) (NBA or NFL), with a league switcher; golf (PGA) later

See the [changelog](CHANGELOG.md) for what changed in each release.

## Contributing

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org), because releases are versioned from them:

| Commit                                             | Example                                 | Release                    |
| -------------------------------------------------- | --------------------------------------- | -------------------------- |
| `fix:`                                             | `fix(nhl): handle missing goalie stats` | patch (0.1.0 -> 0.1.1)     |
| `feat:`                                            | `feat: add NBA adapter`                 | minor (0.1.0 -> 0.2.0)     |
| `feat!:` or `BREAKING CHANGE:` footer              | `feat!: rename Game.startTime`          | major (minor while on 0.x) |
| `docs:`, `test:`, `refactor:`, `chore:`, `ci:` ... | `docs: fix typo`                        | none                       |

`npm install` sets up a git hook that checks each commit message. Releases are made by merging the release PR that release-please keeps open.

Work on a branch from `main`, one feature per pull request. CI runs typecheck and tests on every PR and builds a test APK. When testing with Expo Go, press `r` in the `npm start` terminal (or shake the phone and tap **Reload**) after switching branches: restarting the dev server alone does not reload the app on the phone.

### Release signing (maintainers)

Releases are built by CI (`.github/workflows/android-apk.yml`) and signed with one release key. Android only installs an update over an APK signed with the same key, so create it once and keep a backup somewhere safe: if it is lost, every user has to uninstall to update.

```sh
keytool -genkeypair -v -keystore hat-trick-release.keystore -alias hat-trick \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 hat-trick-release.keystore   # macOS: base64 -i hat-trick-release.keystore
```

Then add four repository secrets (Settings > Secrets and variables > Actions):

| Secret                      | Value                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | the base64 output above                                                             |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password                                                               |
| `ANDROID_KEY_ALIAS`         | `hat-trick`                                                                         |
| `ANDROID_KEY_PASSWORD`      | the key password (the same as the keystore password unless you set a different one) |

Never commit the keystore (`*.keystore` is in `.gitignore`). Releases are created as drafts and published only after the signed APK is attached. If the secrets are missing or the build fails, the release stays an unpublished draft (visible only to maintainers) and the workflow says why.

## Disclaimer

This project is not affiliated with, endorsed by, or connected to the National Hockey League or any team. NHL and team names and logos are trademarks of their respective owners, and player photos belong to the NHL. The app uses an unofficial public API (`api-web.nhle.com`) that may change or stop working without notice. The repository contains no league logos, player photos or other trademarked assets; these images are loaded from the API at runtime.

This is a free, non-commercial project for personal use.

## Support

Hat Trick is free, with no ads or paid features. If you enjoy it, you can [buy me a coffee on Ko-fi](https://ko-fi.com/peakears).

[![Support me on Ko-fi](https://img.shields.io/badge/Ko--fi-buy%20me%20a%20coffee-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/peakears)

## License

[MIT](LICENSE)
