import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { CrashScreen } from "../src/ui/components/States";
import { useReminderSync, useReminderTaps } from "../src/ui/use-reminders";
import { SettingsProvider } from "../src/ui/settings-context";
import { SpoilerProvider } from "../src/ui/spoiler-context";
import { SportsDataProvider } from "../src/ui/sports-data-context";
import { UpdateProvider } from "../src/ui/update-context";
import { darkColors, lightColors } from "../src/ui/theme";

/** Catches a render error anywhere in the app, so a release build never shows a blank screen. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CrashScreen error={error} retry={retry} />;
}

/** Mounted inside the providers: schedules puck drop reminders and opens the game when one is tapped. */
function Reminders() {
  useReminderSync();
  useReminderTaps();
  return null;
}

export default function RootLayout() {
  const dark = useColorScheme() === "dark";
  const base = dark ? DarkTheme : DefaultTheme;
  const colors = dark ? darkColors : lightColors;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <SettingsProvider>
      <SpoilerProvider>
        <SportsDataProvider>
          <UpdateProvider>
            <ThemeProvider value={theme}>
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="game/[id]/index" options={{ title: "Game" }} />
                <Stack.Screen name="game/[id]/box-score" options={{ title: "Box score" }} />
                <Stack.Screen name="team/[id]" options={{ title: "Team" }} />
                <Stack.Screen name="player/[id]" options={{ title: "Player" }} />
              </Stack>
              <Reminders />
              <StatusBar style="auto" />
            </ThemeProvider>
          </UpdateProvider>
        </SportsDataProvider>
      </SpoilerProvider>
    </SettingsProvider>
  );
}
