/**
 * How long a `skill.list` result stays fresh in the prompt box and skill
 * mentions before a mount or window focus refetches it. `skill.list` is an
 * uncached disk walk over every skill source (a SKILL.md read + realpath + YAML
 * parse per skill), so at the default
 * staleTime of 0 those surfaces re-walk all of it on every mount and focus. A
 * short window collapses that churn while still reflecting out-of-band edits
 * within seconds. The skills page deliberately omits this so it stays live;
 * it reads the list with file counts, a query of its own.
 */
export const SKILL_LIST_STALE_TIME_MS = 30_000;
