import { APP_NAME_SLUG } from "@instrument-org/shared";
import { sum } from "radashi";

import { truncateAtWordBoundary } from "./sanitize-model-text";
import { SKILL_NAMES } from "./skill-names";
import { type SkillInfo, type SkillSourceKind } from "./skills";

/**
 * One element per skill, its name as an attribute and its description as the
 * content: `<skill name="…">…</skill>`. Every character of markup comes out of
 * the same budget the descriptions share, and a child element for each field
 * cost 71 characters an entry, which on a machine with fifty-odd skills was
 * more than a third of the whole catalog before a single description.
 */
const CATALOG_TAGS = {
  availableSkills: "available_skills",
  name: "name",
  skill: "skill",
} as const;

/**
 * Character budget for the rendered catalog.
 *
 * The catalog is discovered from the user's machine, so its size is set by how
 * many skills they happen to have installed across every agent vendor -- an
 * unbounded list would quietly eat the context window before the task starts.
 * Characters rather than tokens because no tokenizer is right for every
 * provider we run against: this is roughly 1,700 tokens of prose, plus the tag
 * around each entry. See docs/findings/character-budgets-are-a-token-proxy.md.
 */
const CATALOG_CHAR_BUDGET = 8000;

/**
 * Share of the description budget the skills named in prompts and tool
 * descriptions may hold in full before the reservation is given up.
 *
 * Those are the skills the product steers the model toward by name, and a
 * description cut to the flat cap loses the clause saying when to reach for
 * it, which is the one clause the steering depends on. Half leaves every other
 * skill at least half of what the flat cap alone would have given it. On a
 * developer machine with 54 skills across several agent homes the three named
 * skills need about a quarter, so the reservation holds there; a named skill
 * with a runaway description, or a machine with many more vendors installed,
 * drops back to the flat cap rather than starving the rest.
 */
const NAMED_SKILL_RESERVE_SHARE = 0.5;

/**
 * Matched against `qualifiedName`, which is the plain name exactly when
 * `load_skill` given that plain name resolves to this entry: the one the
 * prompt's constant actually refers to, not a namesake from another source.
 */
const NAMED_SKILLS = new Set<string>(Object.values(SKILL_NAMES));

/** The `<available_skills>` open and close tags plus the newline between them. */
const WRAPPER_COST =
  `<${CATALOG_TAGS.availableSkills}>`.length +
  1 +
  `</${CATALOG_TAGS.availableSkills}>`.length;

/**
 * Order the catalog lists skills in, and the order the names-only step keeps
 * them in: skills we ship or the user authored here outrank whatever a
 * co-installed agent left in the home directory, so those are the last to be
 * dropped. It has no say in description length; that is `NAMED_SKILLS`.
 */
const SOURCE_PRIORITY: Record<SkillSourceKind, number> = {
  agents: 3,
  antigravity: 3,
  [APP_NAME_SLUG]: 2,
  claude: 3,
  codex: 3,
  copilot: 3,
  cursor: 3,
  gemini: 3,
  goose: 3,
  kiro: 3,
  opencode: 3,
  system: 0,
  windsurf: 3,
  workspace: 1,
};

interface SkillCatalog {
  /** Rendered skills in catalog order, with descriptions as shown. */
  entries: { description: string; name: string }[];
  /** Skills dropped entirely because even their names did not fit. */
  omitted: number;
  /** Skills whose description was shortened to fit. */
  shortened: number;
  xml: string;
}

/**
 * Render the agent-facing skill catalog within a character budget, degrading in
 * three steps: every description in full, then descriptions shortened to a fair
 * share of what is left (the skills the product names by constant keeping
 * theirs whole while they fit), then names alone.
 */
export function renderSkillCatalog(
  skills: SkillInfo[],
  budget = CATALOG_CHAR_BUDGET,
): SkillCatalog {
  const entries = [...skills]
    .sort(
      (a, b) =>
        SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] ||
        a.name.localeCompare(b.name),
    )
    .map((skill) => ({
      description: skill.description,
      descriptionCost: escapedLength(skill.description),
      // Stable identity, because catalog entries can be copied into persisted
      // messages and must not retarget when a namesake is installed later.
      name: skill.id,
      named: NAMED_SKILLS.has(skill.qualifiedName),
      // Its own trailing newline, so the entry costs add up to `xml.length`
      // once the wrapper is accounted for.
      nameOnlyCost: renderEntry(skill.id, "").length + 1,
    }));

  if (entries.length === 0) {
    return {
      entries: [],
      omitted: 0,
      shortened: 0,
      xml: `<${CATALOG_TAGS.availableSkills} />`,
    };
  }

  const entryBudget = budget - WRAPPER_COST;
  const fullCost = sum(
    entries.map((entry) => entry.nameOnlyCost + entry.descriptionCost),
  );
  if (fullCost <= entryBudget) {
    return build(
      entries.map((entry) => ({ ...entry, shown: entry.description })),
      0,
    );
  }

  const nameOnlyCost = sum(entries.map((entry) => entry.nameOnlyCost));
  if (nameOnlyCost <= entryBudget) {
    const available = entryBudget - nameOnlyCost;
    const reserved = sum(
      entries
        .filter((entry) => entry.named)
        .map((entry) => entry.descriptionCost),
    );
    const keepsNamedWhole = reserved <= available * NAMED_SKILL_RESERVE_SHARE;
    const keptWhole = (entry: { named: boolean }) =>
      keepsNamedWhole && entry.named;
    const cap = fairShareLength(
      entries
        .filter((entry) => !keptWhole(entry))
        .map((entry) => entry.descriptionCost),
      available - (keepsNamedWhole ? reserved : 0),
    );
    return build(
      entries.map((entry) => ({
        ...entry,
        shown: keptWhole(entry)
          ? entry.description
          : trimDescriptionToEscapedLength(entry.description, cap),
      })),
      0,
    );
  }

  // Not even the names fit. Take them in priority order and keep scanning past
  // an entry that does not fit, so one skill with a pathological name cannot
  // hide every skill behind it.
  let remaining = entryBudget;
  let omitted = 0;
  const kept: { description: string; name: string; shown: string }[] = [];
  for (const entry of entries) {
    if (entry.nameOnlyCost > remaining) {
      omitted += 1;
      continue;
    }
    remaining -= entry.nameOnlyCost;
    kept.push({ ...entry, shown: "" });
  }
  return build(kept, omitted);
}

function build(
  entries: { description: string; name: string; shown: string }[],
  omitted: number,
): SkillCatalog {
  return {
    entries: entries.map((entry) => ({
      description: entry.shown,
      name: entry.name,
    })),
    omitted,
    shortened: entries.filter((entry) => entry.shown !== entry.description)
      .length,
    xml: [
      `<${CATALOG_TAGS.availableSkills}>`,
      ...entries.map((entry) => renderEntry(entry.name, entry.shown)),
      `</${CATALOG_TAGS.availableSkills}>`,
    ].join("\n"),
  };
}

function escapedLength(value: string) {
  return escapeXml(value).length;
}

/**
 * Neutralize markup in a discovered string before it is embedded in the
 * catalog. A name or description comes from arbitrary SKILL.md frontmatter,
 * including a co-installed agent's home directory that nothing here validated,
 * so a `</skill><skill name="…">` in one would otherwise inject fabricated
 * structure into the catalog the session's context message carries.
 */
function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Longest description every skill can be cut to without exceeding `budget`.
 *
 * Descriptions shorter than the cap only cost their own length, so their unused
 * share flows to the longer ones instead of being stranded in a fixed per-skill
 * quota. Walking the lengths in ascending order settles that in one pass.
 */
function fairShareLength(lengths: number[], budget: number): number {
  const ascending = [...lengths].sort((a, b) => a - b);
  let remaining = budget;
  for (const [index, length] of ascending.entries()) {
    const atOrAbove = ascending.length - index;
    if (length * atOrAbove > remaining) {
      return Math.floor(remaining / atOrAbove);
    }
    remaining -= length;
  }
  return Number.POSITIVE_INFINITY;
}

function renderEntry(name: string, description: string) {
  return `  <${CATALOG_TAGS.skill} ${CATALOG_TAGS.name}="${escapeXmlAttribute(name)}">${escapeXml(description)}</${CATALOG_TAGS.skill}>`;
}

/** A name sits in a quoted attribute, where a quote of its own would end it. */
function escapeXmlAttribute(value: string) {
  return escapeXml(value).replaceAll('"', "&quot;");
}

function trimDescriptionToEscapedLength(value: string, cap: number) {
  if (!Number.isFinite(cap)) {
    return value;
  }
  let rawLength = 0;
  let remaining = cap;
  for (const char of value) {
    const cost = escapedLength(char);
    if (cost > remaining) {
      break;
    }
    remaining -= cost;
    rawLength += char.length;
  }
  return truncateAtWordBoundary(value, rawLength);
}
