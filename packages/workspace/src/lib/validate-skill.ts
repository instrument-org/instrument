import fs from "node:fs/promises";
import path from "node:path";
import { estimateTokenCount } from "tokenx";

import { type AbsolutePath } from "../schemas/paths";
import { renderSkillCatalog } from "./skill-catalog";
import { getSkillRuntime } from "./skill-runtime";
import {
  FILE_LIST_LIMIT,
  listSkillFiles,
  parseFrontmatter,
  SKILL_CONTENT_LIMIT,
  type SkillInfo,
} from "./skills";

/**
 * Limits shared with the skills registry's own CI check, so a skill authored
 * here and a skill contributed there are held to the same shape. The token
 * estimate uses the same library for the same reason.
 */
export const SKILL_LIMITS = {
  compatibilityChars: 500,
  descriptionChars: 1024,
  nameChars: 64,
  skillFileLines: 500,
  skillFileTokens: 5000,
} as const;

/**
 * Frontmatter keys that mean something to somebody. Anything else is almost
 * always a typo (`disable_model_invocation`) or a convention from another
 * agent, and either way it silently does nothing.
 */
const KNOWN_FRONTMATTER_KEYS = new Set([
  "allowed-tools",
  "compatibility",
  "description",
  "disable-model-invocation",
  "license",
  "metadata",
  "name",
  "user-invocable",
]);

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every rejection ends the same way: the skill is skipped during discovery. */
const SKIPPED =
  "The skill is skipped during discovery, so it never appears anywhere.";

/**
 * Named per cause, because the outcome alone (the skill is invisible) is the
 * same for all of them and says nothing about how to fix it.
 */
const REJECTION_MESSAGES = {
  "no-description": `The frontmatter has no \`description\`. ${SKIPPED}`,
  "no-frontmatter": `The file has no frontmatter block. It needs one opening with \`---\` on the first line. ${SKIPPED}`,
  unterminated: `The frontmatter has no closing \`---\`. ${SKIPPED}`,
} as const;

/** Markdown links and bare paths that point at something inside the skill. */
const LOCAL_REFERENCE =
  /\[[^\]]*\]\(\.?\/?((?:scripts|references|assets|tests)\/[^)\s]+|[\w.-]+\.\w+)\)/g;

/**
 * Directories `copySkill` strips on the way into a task. A skill that tells the
 * agent to run something from one of them is describing a file that will not be
 * there.
 */
const NOT_COPIED = ["tests/", "SKILL.template.md"];

export interface SkillFinding {
  /** Path relative to the skill directory, or "" for the skill as a whole. */
  file: string;
  level: "error" | "warning";
  message: string;
  /** Stable identifier, so output can be grepped and rules cited. */
  rule: string;
}

export interface SkillReport {
  findings: SkillFinding[];
  name: string;
  stats: {
    descriptionChars: number;
    fileCount: number;
    skillFileLines: number;
    skillFileTokens: number;
  };
}

/**
 * Check a skill the way the runtime will read it.
 *
 * Errors are conditions the runtime already acts on: the skill is never
 * discovered, or `load_skill` refuses it. Warnings are the authoring rules and
 * the budgets, where the skill works but something about it is degraded.
 *
 * `installed` is every skill discovered on this machine, used to answer the two
 * questions that cannot be answered from one directory: whether this skill's
 * description survives the catalog budget, and whether another skill has
 * already claimed its name.
 */
export async function validateSkill({
  installed,
  signal,
  skillDir,
  skillName,
}: {
  installed: SkillInfo[];
  signal: AbortSignal;
  skillDir: AbsolutePath;
  skillName: string;
}): Promise<SkillReport> {
  const findings: SkillFinding[] = [];
  const add = (
    level: SkillFinding["level"],
    rule: string,
    message: string,
    file = "",
  ) => {
    findings.push({ file, level, message, rule });
  };

  // Listed up front so the measurements are real even when a fatal frontmatter
  // problem cuts the rest of the checks short.
  const { files, truncated } = await listSkillFiles(skillDir, signal);
  const stats = {
    descriptionChars: 0,
    fileCount: files.length,
    skillFileLines: 0,
    skillFileTokens: 0,
  };
  const report = () => ({ findings, name: skillName, stats });

  const raw = await fs
    .readFile(path.join(skillDir, "SKILL.md"), "utf8")
    .catch(() => null);
  if (raw === null) {
    add(
      "error",
      "missing-skill-file",
      "No SKILL.md. A directory without one is not a skill and is never discovered.",
    );
    return report();
  }

  stats.skillFileLines = raw.split("\n").length;
  stats.skillFileTokens = estimateTokenCount(raw);

  const frontmatter = parseFrontmatter(raw);
  if (!frontmatter.ok) {
    if (frontmatter.reason === "unparseable") {
      add(
        "error",
        "unparseable",
        `Invalid YAML: ${frontmatter.detail}. ${SKIPPED}`,
        "SKILL.md",
      );
      return report();
    }
    add(
      "error",
      frontmatter.reason,
      REJECTION_MESSAGES[frontmatter.reason],
      "SKILL.md",
    );
    if (frontmatter.reason === "no-description") {
      addUnknownKeys(frontmatter.keys, add);
    }
    return report();
  }

  stats.descriptionChars = frontmatter.description.length;
  addUnknownKeys(frontmatter.keys, add);

  // The catalog escapes these before embedding them, so they no longer break
  // it, but the agent then reads the description with `&lt;`/`&gt;` in place of
  // the brackets.
  if (/[<>]/.test(frontmatter.description)) {
    add(
      "warning",
      "description-angle-brackets",
      "The description contains `<` or `>`, which the agent's skill catalog shows as `&lt;`/`&gt;`.",
      "SKILL.md",
    );
  }

  const runtime = getSkillRuntime(skillDir, skillName);
  if ("error" in runtime) {
    add("error", "load-would-fail", runtime.error);
  }

  if (frontmatter.title !== undefined && frontmatter.title !== skillName) {
    add(
      "warning",
      "name-mismatch",
      `The frontmatter name is "${frontmatter.title}" but the directory is "${skillName}". The directory is what the agent and the slash menu address, so they will not agree.`,
      "SKILL.md",
    );
  }
  if (!KEBAB_CASE.test(skillName)) {
    add(
      "warning",
      "name-not-kebab-case",
      `"${skillName}" is not kebab-case. Use lowercase letters, digits, and single hyphens between them.`,
    );
  }
  if (skillName.length > SKILL_LIMITS.nameChars) {
    add(
      "warning",
      "name-too-long",
      `The name is ${skillName.length} characters (limit ${SKILL_LIMITS.nameChars}).`,
    );
  }
  if (frontmatter.description.length > SKILL_LIMITS.descriptionChars) {
    add(
      "warning",
      "description-too-long",
      `The description is ${frontmatter.description.length} characters (limit ${SKILL_LIMITS.descriptionChars}).`,
      "SKILL.md",
    );
  }
  if (
    frontmatter.compatibility !== undefined &&
    frontmatter.compatibility.length > SKILL_LIMITS.compatibilityChars
  ) {
    add(
      "warning",
      "compatibility-too-long",
      `The compatibility note is ${frontmatter.compatibility.length} characters (limit ${SKILL_LIMITS.compatibilityChars}).`,
      "SKILL.md",
    );
  }
  if (stats.skillFileLines > SKILL_LIMITS.skillFileLines) {
    add(
      "warning",
      "skill-file-too-long",
      `SKILL.md is ${stats.skillFileLines} lines (limit ${SKILL_LIMITS.skillFileLines}). Move detail into references/ and link to it.`,
      "SKILL.md",
    );
  }
  if (stats.skillFileTokens > SKILL_LIMITS.skillFileTokens) {
    add(
      "warning",
      "skill-file-too-many-tokens",
      `SKILL.md is roughly ${stats.skillFileTokens} tokens (limit ${SKILL_LIMITS.skillFileTokens}). Every one of them enters the conversation when the skill loads.`,
      "SKILL.md",
    );
  }

  if (frontmatter.body.length > SKILL_CONTENT_LIMIT) {
    add(
      "warning",
      "skill-file-truncated-on-load",
      `SKILL.md is ${frontmatter.body.length} characters, past the ${SKILL_CONTENT_LIMIT} \`load_skill\` inlines. The agent gets the beginning and a pointer to the file for the rest, so put what it must not miss first.`,
      "SKILL.md",
    );
  }

  if (truncated) {
    add(
      "warning",
      "file-list-truncated",
      `The skill has at least ${FILE_LIST_LIMIT} files, which is where the list the agent is shown stops. Files past that point are invisible to it.`,
    );
  }

  const present = new Set(files);
  for (const reference of localReferences(frontmatter.body)) {
    if (!present.has(reference)) {
      add(
        "warning",
        "missing-reference",
        `SKILL.md links to "${reference}", which is not in the skill.`,
        "SKILL.md",
      );
    }
  }
  for (const excluded of NOT_COPIED) {
    if (frontmatter.body.includes(excluded)) {
      add(
        "warning",
        "reference-not-copied",
        `SKILL.md mentions "${excluded}", which is stripped when the skill is copied into a task. The agent will not find it there.`,
        "SKILL.md",
      );
    }
  }

  addCatalogFindings({ add, installed, skillName });

  return report();
}

function addCatalogFindings({
  add,
  installed,
  skillName,
}: {
  add: (
    level: SkillFinding["level"],
    rule: string,
    message: string,
    file?: string,
  ) => void;
  installed: SkillInfo[];
  skillName: string;
}) {
  const duplicates = installed.filter((skill) => skill.name === skillName);
  if (duplicates.length > 1) {
    add(
      "warning",
      "duplicate-name",
      `${duplicates.length} skills are named "${skillName}". Only one of them is reachable.`,
    );
  }

  const invocable = installed.filter((skill) => skill.modelInvocable);
  if (!invocable.some((skill) => skill.name === skillName)) {
    return;
  }

  // Render the catalog the agent will actually be given and check this skill
  // made it in; that depends on every other skill installed, so measuring this
  // one alone can't answer it. A description the budget merely shortened is not
  // flagged: its full text still loads on demand, and the spec favors a richer
  // description over a shorter one, so nudging it shorter would work against it.
  const catalog = renderSkillCatalog(invocable);
  const entry = catalog.entries.find((item) => item.name === skillName);

  if (!entry) {
    add(
      "warning",
      "catalog-omitted",
      "There are so many skills installed that this one is left out of the catalog entirely. The agent will not choose it on its own.",
    );
  }
}

function addUnknownKeys(
  keys: string[],
  add: (
    level: SkillFinding["level"],
    rule: string,
    message: string,
    file?: string,
  ) => void,
) {
  const unknown = keys.filter((key) => !KNOWN_FRONTMATTER_KEYS.has(key));
  if (unknown.length > 0) {
    add(
      "warning",
      "unknown-frontmatter-key",
      `Nothing reads ${unknown.map((key) => `\`${key}\``).join(", ")}. Check for a typo.`,
      "SKILL.md",
    );
  }
}

function localReferences(body: string) {
  return new Set(
    [...body.matchAll(LOCAL_REFERENCE)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
}
