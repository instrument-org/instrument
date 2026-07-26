import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";

import { REGISTRY_FOLDER_NAMES } from "../constants";
import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { getIgnore } from "./get-ignore";
import { pathExists } from "./path-exists";
import { SKILL_ARTIFACT_IGNORE } from "./skill-artifact-ignore";

export const FILE_LIST_LIMIT = 50;

/**
 * Hard ceiling on the SKILL.md body `load_skill` inlines, in characters.
 *
 * Roughly twice the authoring token budget, so a skill written to the rules is
 * never touched. It exists for the ones that were not: a body discovered in
 * another agent's directory is arbitrary text nothing here reviewed, and
 * inlining it whole is the one place a single file can spend the context window
 * before the task starts. Past this the agent is pointed at the copy in its
 * task, which it can read the way it reads any other file.
 */
export const SKILL_CONTENT_LIMIT = 40_000;

export type FrontmatterResult =
  | {
      body: string;
      compatibility: string | undefined;
      description: string;
      /** Every key the frontmatter declared, so a caller can flag typos. */
      keys: string[];
      modelInvocable: boolean;
      ok: true;
      title: string | undefined;
      userInvocable: boolean;
    }
  | { detail: string; ok: false; reason: "unparseable" }
  | { keys: string[]; ok: false; reason: "no-description" }
  | { ok: false; reason: "no-frontmatter" | "unterminated" };

export interface SkillInfo {
  compatibility: string | undefined;
  content: string;
  description: string;
  /**
   * False when the skill's frontmatter sets `disable-model-invocation: true`.
   * Such a skill is kept out of the agent's catalog but stays listed in Studio
   * so the user can still inspect or edit it deliberately.
   */
  modelInvocable: boolean;
  name: string;
  skillDir: AbsolutePath;
  source: SkillSourceKind;
  /**
   * The frontmatter `name`, which is prose meant for people. The directory
   * name stays the identity, because that is what is unique on disk and what
   * the agent and the slash menu address a skill by.
   */
  title: string;
  /** False when the skill opts out of manual invocation affordances. */
  userInvocable: boolean;
}

export interface SkillSource {
  dir: AbsolutePath;
  source: SkillSourceKind;
}

// The single source of truth for the source kinds. The RPC schema's Zod enum
// and every exhaustive `Record<SkillSourceKind>` derive from this, so adding a
// source is one edit here plus whatever the compiler then demands.
export const SKILL_SOURCE_KINDS = [
  "agents",
  "antigravity",
  "claude",
  "codex",
  "copilot",
  "cursor",
  "gemini",
  "goose",
  "kiro",
  "opencode",
  "registry",
  "system",
  "windsurf",
  "workspace",
] as const;

export type SkillSourceKind = (typeof SKILL_SOURCE_KINDS)[number];

type FrontmatterSplit =
  | { block: string; body: string; ok: true }
  | { ok: false; reason: "no-frontmatter" | "unterminated" };

export async function findSkill(
  workspaceConfig: Pick<
    WorkspaceConfig,
    "registryDir" | "rootDir" | "systemSkillsDir"
  >,
  name: string,
): Promise<{ all: SkillInfo[]; skill: SkillInfo | undefined }> {
  const sources = getSkillSources(workspaceConfig);
  const all = await findSkills(sources);
  return { all, skill: all.find((s) => s.name === name) };
}

/**
 * Every skill across the sources, deduplicated two ways.
 *
 * By canonical directory first: agent vendors' skill directories are routinely
 * symlink farms pointing at one real folder, so the same skill is reachable
 * through half a dozen sources. The first source to reach it wins, which keeps
 * attribution stable instead of labelling a shared skill with whichever vendor
 * happens to sort last.
 *
 * By name second, where the last source wins, so a genuinely separate copy in
 * the workspace still overrides one from a user directory.
 */
export async function findSkills(sources: SkillSource[]): Promise<SkillInfo[]> {
  const skillMap = new Map<string, SkillInfo>();
  const seenDirs = new Set<string>();

  for (const { dir, source } of sources) {
    const skills = await findSkillsInDir(dir, source);
    for (const skill of skills) {
      const canonical = await canonicalDir(skill.skillDir);
      if (seenDirs.has(canonical)) {
        continue;
      }
      seenDirs.add(canonical);
      // Report where the skill really lives, not the symlink we reached it
      // through, so the UI can group and reveal it honestly.
      skillMap.set(skill.name, {
        ...skill,
        skillDir: AbsolutePathSchema.parse(canonical),
      });
    }
  }

  return [...skillMap.values()];
}

export function getSkillSources(
  {
    registryDir,
    rootDir,
    systemSkillsDir,
  }: Pick<WorkspaceConfig, "registryDir" | "rootDir" | "systemSkillsDir">,
  userHomeDir = AbsolutePathSchema.parse(os.homedir()),
): SkillSource[] {
  const fromHome = (source: SkillSourceKind, ...parts: string[]) => ({
    dir: AbsolutePathSchema.parse(path.join(userHomeDir, ...parts)),
    source,
  });

  return [
    {
      dir: systemSkillsDir,
      source: "system",
    },
    {
      dir: absolutePathJoin(registryDir, REGISTRY_FOLDER_NAMES.skills),
      source: "registry",
    },
    fromHome("agents", ".agents", "skills"),
    fromHome("agents", ".config", "agents", "skills"),
    fromHome("antigravity", ".gemini", "antigravity", "skills"),
    fromHome("claude", ".claude", "skills"),
    fromHome("codex", ".codex", "skills"),
    fromHome("copilot", ".copilot", "skills"),
    fromHome("cursor", ".cursor", "skills"),
    fromHome("gemini", ".gemini", "skills"),
    fromHome("goose", ".config", "goose", "skills"),
    fromHome("kiro", ".kiro", "skills"),
    fromHome("opencode", ".config", "opencode", "skills"),
    fromHome("windsurf", ".codeium", "windsurf", "skills"),
    {
      dir: absolutePathJoin(rootDir, REGISTRY_FOLDER_NAMES.skills),
      source: "workspace",
    },
    {
      dir: absolutePathJoin(rootDir, ".agents", REGISTRY_FOLDER_NAMES.skills),
      source: "workspace",
    },
  ];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function listSkillFiles(
  destDir: AbsolutePath,
  signal: AbortSignal,
): Promise<{ files: string[]; truncated: boolean }> {
  const results: string[] = [];
  let truncated = false;
  const baseIgnore = await getIgnore(destDir, { signal });
  // Plus every dotfile: build and tool dirs mostly hide there, and the rest is
  // rarely what a skill teaches, so the listing stays about the skill itself.
  const ignore = baseIgnore.add([".*", ...SKILL_ARTIFACT_IGNORE]);

  async function walk(dir: string, relBase: string) {
    signal.throwIfAborted();
    if (truncated) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (ignore.ignores(entry.isDirectory() ? `${relPath}/` : relPath)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath);
      } else {
        results.push(relPath);
        if (results.length >= FILE_LIST_LIMIT) {
          truncated = true;
          return;
        }
      }
    }
  }

  await walk(destDir, "");
  return { files: results, truncated };
}

/**
 * Read a SKILL.md's frontmatter, saying why it was rejected when it was.
 *
 * Every rejection makes a skill invisible rather than broken -- it simply never
 * appears in the catalog -- so the reason is the only way anyone finds out
 * which one happened.
 */
export function parseFrontmatter(raw: string): FrontmatterResult {
  const split = splitFrontmatter(raw);
  if (!split.ok) {
    return split;
  }

  let data: unknown;
  try {
    data = parseYaml(split.block) as unknown;
  } catch (error) {
    // Other agents accept unquoted colons in a value (`description: Do X: Y`).
    // Retry those as YAML block scalars so a skill from one of their
    // directories still parses; report the original error if that fails too.
    try {
      data = parseYaml(sanitizeFrontmatter(split.block)) as unknown;
    } catch {
      return {
        detail: describeYamlError(error),
        ok: false,
        reason: "unparseable",
      };
    }
  }

  const record = isRecord(data) ? data : {};
  const description =
    typeof record.description === "string"
      ? record.description.trim()
      : undefined;
  if (!description) {
    return { keys: Object.keys(record), ok: false, reason: "no-description" };
  }

  const title =
    typeof record.name === "string" ? record.name.trim() : undefined;

  return {
    body: split.body.trim(),
    compatibility:
      typeof record.compatibility === "string"
        ? record.compatibility
        : undefined,
    description,
    keys: Object.keys(record),
    modelInvocable: record["disable-model-invocation"] !== true,
    ok: true,
    title: title || undefined,
    userInvocable: record["user-invocable"] !== false,
  };
}

/**
 * Separate the YAML block from the body without a library.
 *
 * The block keeps the newline that follows the opening `---`, so a YAML error's
 * line number matches the line in the file.
 *
 * CRLF is normalized before the fence is located, not after the block is cut.
 * The closing fence matches as `\n---`, which claims the `\n` of the final
 * CRLF and strands its `\r` on the last line of the block. YAML reads that
 * stray `\r` as a second scalar once the value it follows is quoted, so a
 * CRLF-encoded skill whose last frontmatter line is `description: "..."` is
 * rejected as unparseable and never discovered.
 */
export function splitFrontmatter(raw: string): FrontmatterSplit {
  // A leading byte-order mark would hide the opening fence.
  const text = (raw.startsWith("\uFEFF") ? raw.slice(1) : raw).replaceAll(
    "\r\n",
    "\n",
  );

  // The fence has to open the file, and `----` is a horizontal rule.
  if (!text.startsWith("---") || text.charAt(3) === "-") {
    return { ok: false, reason: "no-frontmatter" };
  }

  const rest = text.slice(3);
  const end = rest.indexOf("\n---");
  if (end === -1) {
    return { ok: false, reason: "unterminated" };
  }

  return {
    block: rest.slice(0, end),
    body: rest.slice(end + "\n---".length),
    ok: true,
  };
}

/**
 * Cut a skill body to the inlining ceiling on a line boundary, so the agent is
 * never handed half a sentence or half a fenced block as if it were the whole
 * instruction.
 */
export function truncateSkillContent(content: string): {
  content: string;
  truncated: boolean;
} {
  if (content.length <= SKILL_CONTENT_LIMIT) {
    return { content, truncated: false };
  }
  const clipped = content.slice(0, SKILL_CONTENT_LIMIT);
  const lastNewline = clipped.lastIndexOf("\n");
  return {
    content: (lastNewline === -1
      ? clipped
      : clipped.slice(0, lastNewline)
    ).trimEnd(),
    truncated: true,
  };
}

/** Real location of a skill dir, falling back to the path itself if unresolvable. */
async function canonicalDir(skillDir: AbsolutePath): Promise<string> {
  try {
    return await fs.realpath(skillDir);
  } catch {
    return skillDir;
  }
}

/** A YAML error's own message, which already carries its line and column. */
function describeYamlError(error: unknown): string {
  if (error instanceof YAMLParseError) {
    return error.message.split("\n")[0]?.replace(/:$/, "") ?? "invalid YAML";
  }
  return error instanceof Error ? error.message : "invalid YAML";
}

async function findSkillsInDir(
  dir: AbsolutePath,
  source: SkillSourceKind,
): Promise<SkillInfo[]> {
  const exists = await pathExists(dir);
  if (!exists) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const skills: SkillInfo[] = [];

  for (const entry of entries) {
    const skillDir = absolutePathJoin(dir, entry.name);
    const isDirectory =
      entry.isDirectory() || (await isDirectorySymlink(skillDir));
    if (!isDirectory) {
      continue;
    }

    const skillFile = path.join(skillDir, "SKILL.md");

    let raw: string;
    try {
      raw = await fs.readFile(skillFile, "utf8");
    } catch {
      continue;
    }

    const parsed = parseFrontmatter(raw);
    if (!parsed.ok) {
      continue;
    }

    skills.push({
      compatibility: parsed.compatibility,
      content: parsed.body,
      description: parsed.description,
      modelInvocable: parsed.modelInvocable,
      // Agent Skills are addressed by their containing directory name.
      name: entry.name,
      skillDir,
      source,
      title: parsed.title ?? entry.name,
      userInvocable: parsed.userInvocable,
    });
  }

  return skills;
}

async function isDirectorySymlink(candidate: AbsolutePath) {
  try {
    const stats = await fs.stat(candidate);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// Adapted from https://github.com/sst/opencode/blob/main/packages/opencode/src/config/markdown.ts
function sanitizeFrontmatter(block: string): string {
  const result: string[] = [];

  for (const line of block.split("\n")) {
    if (
      line.trim().startsWith("#") ||
      line.trim() === "" ||
      /^\s+/.test(line)
    ) {
      result.push(line);
      continue;
    }

    const kvMatch = /^(\w+):(.*)$/.exec(line);
    if (!kvMatch?.[1] || kvMatch[2] === undefined) {
      result.push(line);
      continue;
    }

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    if (
      value === "" ||
      value === ">" ||
      value === "|" ||
      value.startsWith('"') ||
      value.startsWith("'")
    ) {
      result.push(line);
      continue;
    }

    if (value.includes(":")) {
      result.push(`${key}: |-\n  ${value}`);
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}
