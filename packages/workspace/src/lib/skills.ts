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
import { getSkillPackageFingerprint } from "./skill-package-fingerprint";

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
  /**
   * Every stable source-qualified identity that reaches this package. Copies
   * collapsed during discovery keep their own IDs here, so an existing target
   * remains valid when a higher-ranked identical copy appears.
   */
  aliases: string[];
  compatibility: string | undefined;
  content: string;
  description: string;
  /**
   * Stable identity derived from the discovery root and directory name. Unlike
   * `qualifiedName`, adding or removing a namesake cannot change it.
   */
  id: string;
  /**
   * False when the skill's frontmatter sets `disable-model-invocation: true`.
   * Such a skill is kept out of the agent's catalog but stays listed in Studio
   * so the user can still inspect or edit it deliberately.
   */
  modelInvocable: boolean;
  name: string;
  /**
   * Human-friendly invocation alias. Equal to `name` unless another source
   * ships a namesake. Accepted by `load_skill` for compatibility, but never
   * persisted because the installed set can change it.
   */
  qualifiedName: string;
  skillDir: AbsolutePath;
  source: SkillSourceKind;
  sourceId: SkillSourceId;
  /**
   * The frontmatter `name`, which is prose meant for people. The directory
   * name is the plain label shown to people; `id` addresses the package.
   */
  title: string;
  /** False when the skill opts out of manual invocation affordances. */
  userInvocable: boolean;
}

export interface SkillSource {
  dir: AbsolutePath;
  id: SkillSourceId;
  source: SkillSourceKind;
}

export type SkillSourceId =
  | "agents"
  | "agents-config"
  | "antigravity"
  | "claude"
  | "codex"
  | "copilot"
  | "cursor"
  | "gemini"
  | "goose"
  | "kiro"
  | "opencode"
  | "project"
  | "registry"
  | "system"
  | "windsurf"
  | "workspace";

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

/**
 * Which source keeps the plain directory name when several of them ship a skill
 * under it. The rest are addressed as `<source>:<name>`, so every one of them
 * stays reachable instead of the last source scanned quietly winning.
 *
 * The user's own skills outrank what we ship, which outranks what a
 * co-installed agent left in its home directory: a skill someone put in this
 * workspace is the one they meant when they typed its name. The vendor
 * directories all share a rank because none of them has a claim over the
 * others, so a name two of them use is qualified for both.
 *
 * Distinct from the catalog's degradation order in `skill-catalog.ts`, which
 * answers a different question -- whose description is dropped first when the
 * budget runs out -- and puts our own skills first for it.
 */
const SOURCE_RANK: Record<SkillSourceKind, number> = {
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
  registry: 1,
  system: 2,
  windsurf: 3,
  workspace: 0,
};

/** A skill as its own directory describes it, before aliases are made unique. */
type DiscoveredSkill = Omit<SkillInfo, "qualifiedName">;

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
  return {
    all,
    skill:
      all.find((skill) => skill.aliases.includes(name)) ??
      all.find((skill) => skill.qualifiedName === name),
  };
}

/**
 * Every skill across the sources, deduplicated two ways.
 *
 * By canonical directory first: agent vendors' skill directories are routinely
 * symlink farms pointing at one real folder, so the same skill is reachable
 * through half a dozen sources. The first source to reach it owns attribution,
 * while every source-qualified ID remains an accepted alias.
 *
 * By identical instructions second. Separate copies with different
 * instructions survive, and `qualifySkillNames` gives each of them a
 * human-friendly invocation alias.
 */
export async function findSkills(sources: SkillSource[]): Promise<SkillInfo[]> {
  const skillMap = new Map<string, DiscoveredSkill>();
  const canonicalIds = new Map<string, string>();

  for (const { dir, id, source } of sources) {
    const skills = await findSkillsInDir(dir, id, source);
    for (const skill of skills) {
      const canonical = await canonicalDir(skill.skillDir);
      const existingId = canonicalIds.get(canonical);
      if (existingId) {
        const existing = skillMap.get(existingId);
        if (existing) {
          skillMap.set(existingId, {
            ...existing,
            aliases: mergeSkillAliases(existing, skill),
          });
        }
        continue;
      }
      canonicalIds.set(canonical, skill.id);
      // Report where the skill really lives, not the symlink we reached it
      // through, so the UI can group and reveal it honestly.
      skillMap.set(skill.id, {
        ...skill,
        skillDir: AbsolutePathSchema.parse(canonical),
      });
    }
  }

  return qualifySkillNames(await dedupeIdenticalCopies([...skillMap.values()]));
}

export function getSkillSources(
  {
    registryDir,
    rootDir,
    systemSkillsDir,
  }: Pick<WorkspaceConfig, "registryDir" | "rootDir" | "systemSkillsDir">,
  userHomeDir = AbsolutePathSchema.parse(os.homedir()),
): SkillSource[] {
  const fromHome = (
    id: SkillSourceId,
    source: SkillSourceKind,
    ...parts: string[]
  ) => ({
    dir: AbsolutePathSchema.parse(path.join(userHomeDir, ...parts)),
    id,
    source,
  });

  return [
    {
      dir: systemSkillsDir,
      id: "system",
      source: "system",
    },
    {
      dir: absolutePathJoin(registryDir, REGISTRY_FOLDER_NAMES.skills),
      id: "registry",
      source: "registry",
    },
    fromHome("agents", "agents", ".agents", "skills"),
    fromHome("agents-config", "agents", ".config", "agents", "skills"),
    fromHome("antigravity", "antigravity", ".gemini", "antigravity", "skills"),
    fromHome("claude", "claude", ".claude", "skills"),
    fromHome("codex", "codex", ".codex", "skills"),
    fromHome("copilot", "copilot", ".copilot", "skills"),
    fromHome("cursor", "cursor", ".cursor", "skills"),
    fromHome("gemini", "gemini", ".gemini", "skills"),
    fromHome("goose", "goose", ".config", "goose", "skills"),
    fromHome("kiro", "kiro", ".kiro", "skills"),
    fromHome("opencode", "opencode", ".config", "opencode", "skills"),
    fromHome("windsurf", "windsurf", ".codeium", "windsurf", "skills"),
    {
      dir: absolutePathJoin(rootDir, REGISTRY_FOLDER_NAMES.skills),
      id: "workspace",
      source: "workspace",
    },
    {
      dir: absolutePathJoin(rootDir, ".agents", REGISTRY_FOLDER_NAMES.skills),
      id: "project",
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
 * Resolve what was asked for to a skill, or to the names worth suggesting.
 *
 * A stable ID or current invocation alias is the answer whenever it exists.
 * Past that a model is usually close rather than wrong -- it drops a
 * `claude:` prefix it was shown, changes the case, or reaches for the
 * frontmatter title instead of the directory -- and each of those resolves as
 * long as exactly one skill answers to it. A name several skills answer to
 * resolves to none of them and comes back as the list to choose from, which is
 * the one case where guessing would silently load the wrong instructions.
 */
export function resolveSkillName(
  skills: SkillInfo[],
  requested: string,
): { skill: SkillInfo } | { suggestions: string[] } {
  const exact = skills.find(
    (skill) =>
      skill.aliases.includes(requested) || skill.qualifiedName === requested,
  );
  if (exact) {
    return { skill: exact };
  }

  const lowered = requested.toLowerCase();
  const nearby = [
    skills.filter((skill) =>
      skill.aliases.some((alias) => alias.toLowerCase() === lowered),
    ),
    skills.filter((skill) => skill.qualifiedName.toLowerCase() === lowered),
    skills.filter((skill) => skill.name.toLowerCase() === lowered),
    skills.filter((skill) => skill.title.toLowerCase() === lowered),
  ];
  for (const candidates of nearby) {
    if (candidates.length === 1 && candidates[0]) {
      return { skill: candidates[0] };
    }
    if (candidates.length > 1) {
      return {
        suggestions: candidates.map((skill) => skill.id),
      };
    }
  }

  return { suggestions: [] };
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

/**
 * Collapse copies of one skill that several sources each ship a real copy of.
 *
 * A symlink farm is already down to one entry by here, but plenty of setups
 * copy instead of linking, and every one of those copies would otherwise be
 * qualified and listed separately -- four `pdf`s in the menu for what the user
 * thinks of as one skill. Parsed metadata is the cheap first pass; only matching
 * candidates get a cached whole-package fingerprint.
 */
async function dedupeIdenticalCopies(
  skills: DiscoveredSkill[],
): Promise<DiscoveredSkill[]> {
  const manifestKeys = new Map<string, number>();
  for (const skill of skills) {
    const key = skillManifestKey(skill);
    manifestKeys.set(key, (manifestKeys.get(key) ?? 0) + 1);
  }
  const fingerprints = new Map<string, string>();
  await Promise.all(
    skills.map(async (skill) => {
      const manifestKey = skillManifestKey(skill);
      if (manifestKeys.get(manifestKey) === 1) {
        return;
      }
      const fingerprint = await getSkillPackageFingerprint(
        skill.skillDir,
      ).catch(() => `unreadable:${skill.id}`);
      fingerprints.set(skill.id, fingerprint);
    }),
  );

  const byContent = new Map<string, DiscoveredSkill>();

  for (const skill of skills) {
    const manifestKey = skillManifestKey(skill);
    const fingerprint = fingerprints.get(skill.id) ?? skill.id;
    const key = `${manifestKey}\u0000${fingerprint}`;
    const existing = byContent.get(key);
    // Keeping the highest-ranked copy decides which source the UI attributes it
    // to and whether it is editable in place. A `Map` keeps the entry where the
    // first copy put it, so replacing the value does not reorder the list.
    if (
      existing === undefined ||
      SOURCE_RANK[skill.source] < SOURCE_RANK[existing.source]
    ) {
      byContent.set(
        key,
        existing
          ? { ...skill, aliases: mergeSkillAliases(skill, existing) }
          : skill,
      );
    } else {
      byContent.set(key, {
        ...existing,
        aliases: mergeSkillAliases(existing, skill),
      });
    }
  }

  return [...byContent.values()];
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
  id: SkillSourceId,
  source: SkillSourceKind,
): Promise<DiscoveredSkill[]> {
  const exists = await pathExists(dir);
  if (!exists) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const skills: DiscoveredSkill[] = [];

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
      aliases: [`${id}:${entry.name}`],
      compatibility: parsed.compatibility,
      content: parsed.body,
      description: parsed.description,
      id: `${id}:${entry.name}`,
      modelInvocable: parsed.modelInvocable,
      // Agent Skills are addressed by their containing directory name.
      name: entry.name,
      skillDir,
      source,
      sourceId: id,
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

function mergeSkillAliases(
  primary: DiscoveredSkill,
  secondary: DiscoveredSkill,
): string[] {
  return [...new Set([...primary.aliases, ...secondary.aliases])];
}

/**
 * How two skill names are compared for sameness. Case-folded, because macOS and
 * Windows are: `pdf` and `PDF` from different sources are one name as far as
 * the folder a task copies them into is concerned, so they have to be one name
 * here too or the second load would land on top of the first.
 */
function nameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Hand every skill a name that addresses it and nothing else.
 *
 * A name only one source uses is left alone, so the common case reads the way
 * the author wrote it. Where several sources use one name, the highest-ranked
 * source keeps it and the rest take `<source>:<name>`; when the top rank is a
 * tie -- two vendor directories, say -- none of them has a claim on the plain
 * name, so all of them are qualified and it addresses nothing.
 */
function qualifySkillNames(skills: DiscoveredSkill[]): SkillInfo[] {
  const byName = new Map<string, DiscoveredSkill[]>();
  for (const skill of skills) {
    const key = nameKey(skill.name);
    byName.set(key, [...(byName.get(key) ?? []), skill]);
  }

  return skills.map((skill) => {
    const sharing = byName.get(nameKey(skill.name)) ?? [skill];
    if (sharing.length === 1) {
      return { ...skill, qualifiedName: skill.name };
    }
    const bestRank = Math.min(
      ...sharing.map((other) => SOURCE_RANK[other.source]),
    );
    const claimants = sharing.filter(
      (other) => SOURCE_RANK[other.source] === bestRank,
    );
    const keepsPlainName =
      claimants.length === 1 && SOURCE_RANK[skill.source] === bestRank;
    return {
      ...skill,
      qualifiedName: keepsPlainName
        ? skill.name
        : `${skill.source}:${skill.name}`,
    };
  });
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

function skillManifestKey(skill: DiscoveredSkill) {
  return [
    nameKey(skill.name),
    skill.compatibility,
    skill.content,
    skill.description,
    skill.modelInvocable,
    skill.title,
    skill.userInvocable,
  ].join("\u0000");
}
