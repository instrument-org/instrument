import { APP_NAME_SLUG, splitFrontMatter } from "@instrument-org/shared";
import { type Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";

import { REGISTRY_FOLDER_NAMES, SKILLS_FOLDER_NAME } from "../constants";
import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { getIgnore } from "./get-ignore";
import { pathExists } from "./path-exists";
import { SKILL_ARTIFACT_IGNORE } from "./skill-artifact-ignore";
import { AGENT_BROWSER_GUIDE_NAME } from "./agent-browser-guide";
import { getSkillPackageFingerprint } from "./skill-package-fingerprint";
import { runtimeLayout } from "./runtime-dir";
import {
  noteSkippedSkillFolders,
  realPathByLinks,
  setSkillFolderLoaded,
  skillFolderToSkip,
  type SkippedSkillFolder,
} from "./guarded-skill-folders";
import { macosGuardedRoot, watchMacosPrompt } from "./permissions/macos";

export const FILE_LIST_LIMIT = 50;

/**
 * Hard ceiling on the SKILL.md body `load_skill` inlines, in characters.
 *
 * Roughly twice the authoring token budget, so a skill written to the rules is
 * never touched. It exists for the ones that were not: a body discovered in
 * another agent's directory is arbitrary text nothing here reviewed, and
 * inlining it whole is the one place a single file can spend the context window
 * before the task starts. Past this the agent is pointed at the file in the
 * skill's folder, which it can read the way it reads any other file.
 *
 * Roughly 8,500 tokens of Markdown.
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
  | { detail: string; ok: false; reason: "unparsable" }
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
  /**
   * False when the skill opts out of manual invocation affordances, and always
   * false for the skills the app ships. See `BUNDLED_SOURCES`.
   */
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
  | "system"
  | "windsurf"
  | "workspace"
  | typeof APP_NAME_SLUG;

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
  "system",
  "windsurf",
  "workspace",
  APP_NAME_SLUG,
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
  [APP_NAME_SLUG]: 1,
  claude: 3,
  codex: 3,
  copilot: 3,
  cursor: 3,
  gemini: 3,
  goose: 3,
  kiro: 3,
  opencode: 3,
  system: 2,
  windsurf: 3,
  workspace: 0,
};

/**
 * The sources the app ships itself, whose skills are never user-invocable.
 *
 * The agent reaches for these from its own catalog, so offering them as slash
 * commands suggests someone has to ask for behavior the agent already has.
 * They stay listed in Studio, badged as automatic.
 *
 * The rule lives here rather than in their frontmatter because the same
 * packages install into other agents, where a skill someone chose to install is
 * exactly the kind of thing to invoke by name. A copy of one found in another
 * agent's directory is the same package and collapses into the bundled entry
 * before this applies, so this decides that copy too.
 */
const BUNDLED_SOURCES = new Set<SkillSourceKind>([APP_NAME_SLUG, "system"]);

/** The sources the app keeps itself: the bundled ones and the workspace's own. */
const APP_SKILL_SOURCES = new Set<SkillSourceKind>([
  ...BUNDLED_SOURCES,
  "workspace",
]);

/** The same set as {@link BUNDLED_SOURCES}, by the id that names a mount. */
export const BUNDLED_SOURCE_IDS = new Set<SkillSourceId>([
  APP_NAME_SLUG,
  "system",
]);

/** A skill as its own directory describes it, before aliases are made unique. */
type DiscoveredSkill = Omit<SkillInfo, "qualifiedName">;

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
  const skipped = new Map<string, SkippedSkillFolder>();

  for (const { dir, id, source } of sources) {
    // A home folder's skills folder linked into a place macOS guards is
    // read only once the person loads it in Settings: reading it unasked
    // would put the system's prompt up over a chat that never asked for it.
    // The app's own and the workspace's skills are never in one it hasn't
    // been let into.
    const guarded = !APP_SKILL_SOURCES.has(source);
    const skip = guarded ? await skillFolderToSkip(dir) : undefined;
    if (skip !== undefined) {
      skipped.set(skip.folder, skip);
      continue;
    }
    const skills = await findSkillsInDir(
      dir,
      id,
      source,
      guarded ? skipped : undefined,
    );
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

  // agent-browser's guide comes with the first browser command
  // (`browser-skill-delivery.ts`), from the installed CLI with what differs
  // here; a copy installed anywhere else describes a different setup.
  const skills = qualifySkillNames(
    await dedupeIdenticalCopies(
      [...skillMap.values()].filter(
        (skill) => skill.name !== AGENT_BROWSER_GUIDE_NAME,
      ),
    ),
  );
  noteSkippedSkillFolders(skipped);
  return skills.map((skill) =>
    BUNDLED_SOURCES.has(skill.source)
      ? { ...skill, userInvocable: false }
      : skill,
  );
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
      id: APP_NAME_SLUG,
      source: APP_NAME_SLUG,
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
      dir: AbsolutePathSchema.parse(path.join(rootDir, SKILLS_FOLDER_NAME)),
      id: "workspace",
      source: "workspace",
    },
  ];
}

/**
 * The folder each skill source is read from, and whether the agent may only
 * read it. One entry per folder: the two bundled sources collapse onto the
 * prepared directory, since neither can run from the signed app bundle.
 *
 * The shell mounts these (`buildSkillMounts`) and the chat's rules allow
 * them (`permissions/chat-rules.ts`), from here, so that the tool that reads
 * a file and the command that reads the same file agree about it. They did
 * not: the mounts were built from this list and the rules were not, so
 * `read_file` on a loaded skill asked the person for a folder the shell was
 * already reading.
 */
export function skillSourceRoots(
  config: Pick<
    WorkspaceConfig,
    "registryDir" | "rootDir" | "runtimeDir" | "systemSkillsDir"
  >,
): { dir: AbsolutePath; readOnly: boolean }[] {
  const roots = new Map<string, { dir: AbsolutePath; readOnly: boolean }>();
  for (const { dir, id } of getSkillSources(config)) {
    const root = BUNDLED_SOURCE_IDS.has(id)
      ? AbsolutePathSchema.parse(runtimeLayout(config.runtimeDir).skills)
      : dir;
    if (roots.has(root)) {
      continue;
    }
    roots.set(root, { dir: root, readOnly: id !== "workspace" });
  }
  return [...roots.values()];
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
  const split = splitFrontMatter(raw);
  if (!split.ok) {
    return { ok: false, reason: split.reason };
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
        reason: "unparsable",
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
    body: split.body.replaceAll("\r\n", "\n").trim(),
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
  skipped?: Map<string, SkippedSkillFolder>,
): Promise<DiscoveredSkill[]> {
  const exists = await pathExists(dir);
  if (!exists) {
    return [];
  }

  const entries = await listSource(dir);
  const skills: DiscoveredSkill[] = [];

  for (const entry of entries) {
    const skillDir = absolutePathJoin(dir, entry.name);
    // One skill linked into a place macOS guards waits for the person to
    // load it, as a whole folder does (`findSkills`).
    if (skipped !== undefined && entry.isSymbolicLink()) {
      const skip = await skillFolderToSkip(skillDir);
      if (skip !== undefined) {
        skipped.set(skip.folder, skip);
        continue;
      }
    }
    const isDirectory =
      entry.isDirectory() || (await isDirectorySymlink(skillDir));
    if (!isDirectory) {
      continue;
    }

    const skillFile = path.join(skillDir, "SKILL.md");

    let raw: string;
    try {
      raw = await fs.readFile(skillFile, "utf8");
    } catch (error) {
      await forgetRefusedFolder(skillDir, error);
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

/**
 * How long a source's listing may take before this pass goes on without it,
 * when no prompt of macOS's says why: a folder on a network volume that
 * stopped answering must not hold a chat's first turn. A slow disk or a
 * folder still downloading gets this long; a listing waiting on the person's
 * answer to macOS's prompt is left out as soon as the prompt shows.
 */
const SOURCE_LOOK_MS = 10_000;

type SourceListing = { entries: Dirent[] } | { error: unknown };

/**
 * Each source's listing still waiting, by folder. A listing macOS holds for
 * its prompt keeps one of the process's file threads until the person
 * answers, so a later pass waits on the same one rather than starting
 * another: one per source however many passes come while the prompt is up.
 */
const sourceListings = new Map<string, Promise<SourceListing>>();

function sourceListing(dir: AbsolutePath): Promise<SourceListing> {
  let listing = sourceListings.get(dir);
  if (listing === undefined) {
    listing = fs
      .readdir(dir, { withFileTypes: true })
      .then(
        (entries) => ({ entries }),
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        sourceListings.delete(dir);
      });
    sourceListings.set(dir, listing);
  }
  return listing;
}

/**
 * A source's entries, or none when it can't be read: a home folder's skills
 * folder is often a link into Documents or iCloud Drive, which macOS may
 * refuse, or be asking about, and one unreadable source must not take the
 * other sources' skills, or the chat they are read for, with it.
 */
async function listSource(dir: AbsolutePath): Promise<Dirent[]> {
  let timer: NodeJS.Timeout | undefined;
  const listing = sourceListing(dir);
  const capped = new Promise<{ waiting: true }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ waiting: true });
    }, SOURCE_LOOK_MS);
  });
  const asking = new Promise<{ waiting: true }>((resolve) => {
    // Unwatched, the cap still ends the wait.
    watchMacosPrompt(Promise.race([listing, capped]), () => {
      resolve({ waiting: true });
      return Promise.resolve();
    }).catch(() => undefined);
  });
  const listed = await Promise.race([listing, capped, asking]).finally(() => {
    clearTimeout(timer);
  });
  if ("entries" in listed) {
    return listed.entries;
  }
  if ("error" in listed) {
    await forgetRefusedFolder(dir, listed.error);
  }
  console.warn(
    `Skipping the skills in ${dir}: ${"waiting" in listed ? "its listing hasn't answered yet (macOS may be asking the person about the folder)" : String(listed.error)}`,
  );
  return [];
}

/**
 * A skills folder the person loaded that macOS now refuses (they turned it
 * off in System Settings) goes back to waiting to be loaded, so the next
 * pass skips it and Settings offers it again.
 */
async function forgetRefusedFolder(dir: string, error: unknown) {
  if (
    process.platform !== "darwin" ||
    !(error instanceof Error && "code" in error && error.code === "EPERM")
  ) {
    return;
  }
  const folder = await realPathByLinks(dir);
  if (macosGuardedRoot(folder) !== undefined) {
    await setSkillFolderLoaded(folder, false).catch(() => {});
  }
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
 * the runtime folder the app's own skills are prepared in is concerned, so
 * they have to be one name here too or one would land on top of the other.
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
