import { sum } from "radashi";

import { type SkillInfo, type SkillSourceKind } from "./skills";

const CATALOG_TAGS = {
  availableSkills: "available_skills",
  description: "description",
  name: "name",
  skill: "skill",
} as const;

/**
 * Character budget for the rendered catalog.
 *
 * The catalog is discovered from the user's machine, so its size is set by how
 * many skills they happen to have installed across every agent vendor -- an
 * unbounded list would quietly eat the context window before the task starts.
 * A character budget is the coarse form of Codex's token budget (2% of the
 * context window); switch to that shape once the model metadata carries a
 * context length.
 */
const CATALOG_CHAR_BUDGET = 8000;

/** The `<available_skills>` open and close tags plus the newline between them. */
const WRAPPER_COST =
  `<${CATALOG_TAGS.availableSkills}>`.length +
  1 +
  `</${CATALOG_TAGS.availableSkills}>`.length;

/**
 * Order the catalog degrades in: skills we ship or the user authored here
 * outrank whatever a co-installed agent left in the home directory, so those
 * are the last to lose their descriptions and the first to be dropped.
 */
const SOURCE_PRIORITY: Record<SkillSourceKind, number> = {
  agents: 3,
  antigravity: 3,
  claude: 3,
  codex: 3,
  copilot: 3,
  cursor: 3,
  gemini: 3,
  goose: 3,
  kiro: 3,
  opencode: 3,
  registry: 2,
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
 * share of what is left, then names alone. Mirrors the only budgeted
 * implementation we found in the wild (Codex's `core-skills` renderer).
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
    const cap = fairShareLength(
      entries.map((entry) => entry.descriptionCost),
      entryBudget - nameOnlyCost,
    );
    return build(
      entries.map((entry) => ({
        ...entry,
        shown: trimDescriptionToEscapedLength(entry.description, cap),
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
 * so a `</description></skill>` in one would otherwise inject fabricated
 * structure into the catalog the tool description puts in the system prompt.
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
  return [
    `  <${CATALOG_TAGS.skill}>`,
    `    <${CATALOG_TAGS.name}>${escapeXml(name)}</${CATALOG_TAGS.name}>`,
    `    <${CATALOG_TAGS.description}>${escapeXml(description)}</${CATALOG_TAGS.description}>`,
    `  </${CATALOG_TAGS.skill}>`,
  ].join("\n");
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
  return value.slice(0, rawLength).trimEnd();
}
