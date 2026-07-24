/**
 * How long a `skill.list` result stays fresh before a mount or window focus
 * refetches it. `skill.list` is an uncached disk walk over every skill source,
 * so at the default staleTime of 0 each prompt box, skill mention, and the
 * skills page re-walks all of it on every mount and focus. A short window
 * collapses that churn while still reflecting out-of-band edits within seconds.
 */
export const SKILL_LIST_STALE_TIME_MS = 30_000;
