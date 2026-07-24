/**
 * How long a `skill.list` result stays fresh in the prompt box and skill
 * mentions before a mount or window focus refetches it. `skill.list` is an
 * uncached disk walk over every skill source (a SKILL.md read + realpath + YAML
 * parse per skill, plus a bounded per-skill file walk), so at the default
 * staleTime of 0 those surfaces re-walk all of it on every mount and focus. A
 * short window collapses that churn while still reflecting out-of-band edits
 * within seconds. The skills page deliberately omits this so it stays live;
 * since it shares this query key, visiting it also freshens these surfaces.
 */
export const SKILL_LIST_STALE_TIME_MS = 30_000;
