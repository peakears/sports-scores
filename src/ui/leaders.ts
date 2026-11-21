// Pure helpers for the Leaders tab (no React Native imports; tested in leaders.test.ts).

/** How many players each category asks the league for: the most "Show more" reveals. */
export const LEADERS_MAX = 20;

/** How many players a category shows before "Show more". */
export const LEADERS_SHOWN = 5;

/** The entries a category shows, and whether there are more behind "Show more". */
export function visibleLeaders<T>(entries: readonly T[], expanded: boolean): { shown: T[]; hasMore: boolean } {
  const all = entries.slice(0, LEADERS_MAX);
  const shown = expanded ? all : all.slice(0, LEADERS_SHOWN);
  return { shown, hasMore: all.length > LEADERS_SHOWN };
}

/** The key that remembers whether one category is expanded, separate for skaters and goalies. */
export function leaderSectionKey(kind: string, category: string): string {
  return `${kind}:${category}`;
}
