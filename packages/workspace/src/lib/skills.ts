import matter from "@11ty/gray-matter";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { REGISTRY_FOLDER_NAMES } from "../constants";
import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { getIgnore } from "./get-ignore";
import { pathExists } from "./path-exists";

export const FILE_LIST_LIMIT = 50;

/**
 * Installed dependencies and tool caches, which are not part of what a skill
 * teaches. An installed skill's node_modules runs to thousands of files, so
 * left in they consume the whole listing budget before the skill's own scripts
 * and references are reached -- in the agent's file list as much as the user's.
 *
 * Layered under the skill's own .gitignore rather than replacing it: a skill
 * that has one already says what its build leaves behind, but most do not, so
 * these have to hold on their own.
 */
const SKILL_NOISE_PATTERNS = [".*", "__pycache__", "node_modules", "venv"];

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
    }
  | { keys: string[]; ok: false; reason: "no-description" }
  | { ok: false; reason: "no-frontmatter" | "unparseable" };

export interface SkillInfo {
  content: string;
  description: string;
  /**
   * False when the skill's frontmatter sets `disable-model-invocation: true`.
   * Such a skill is kept out of the agent's catalog but stays listed in Studio
   * and invocable by name, so the user can still run it deliberately.
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
}

export interface SkillSource {
  dir: AbsolutePath;
  source: SkillSourceKind;
}

export type SkillSourceKind =
  | "agents"
  | "claude"
  | "codex"
  | "cursor"
  | "gemini"
  | "opencode"
  | "registry"
  | "system"
  | "workspace";

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
    fromHome("claude", ".claude", "skills"),
    fromHome("codex", ".codex", "skills"),
    fromHome("cursor", ".cursor", "skills"),
    fromHome("gemini", ".gemini", "skills"),
    fromHome("opencode", ".config", "opencode", "skills"),
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

export async function listSkillFiles(
  destDir: AbsolutePath,
  signal: AbortSignal,
): Promise<{ files: string[]; truncated: boolean }> {
  const results: string[] = [];
  let truncated = false;
  const baseIgnore = await getIgnore(destDir, { signal });
  const ignore = baseIgnore.add(SKILL_NOISE_PATTERNS);

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
  if (!raw.trimStart().startsWith("---")) {
    return { ok: false, reason: "no-frontmatter" };
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch {
    clearMatterCache();
    try {
      parsed = matter(sanitizeFrontmatter(raw));
    } catch {
      clearMatterCache();
      return { ok: false, reason: "unparseable" };
    }
  }

  const data: Record<string, unknown> = parsed.data;
  const description =
    typeof data.description === "string" ? data.description.trim() : undefined;
  if (!description) {
    return { keys: Object.keys(data), ok: false, reason: "no-description" };
  }

  const title = typeof data.name === "string" ? data.name.trim() : undefined;

  return {
    body: parsed.content.trim(),
    compatibility:
      typeof data.compatibility === "string" ? data.compatibility : undefined,
    description,
    keys: Object.keys(data),
    modelInvocable: data["disable-model-invocation"] !== true,
    ok: true,
    title: title || undefined,
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
 * Drop gray-matter's memo of the string that just failed to parse.
 *
 * It caches by input, and a parse that throws still leaves an empty entry
 * behind, so the next read of the same broken SKILL.md returns no data instead
 * of throwing -- the file reads as "no description" the second time and
 * "invalid YAML" the first. The cast is because `clearCache` is real but absent
 * from the package's type declarations.
 */
function clearMatterCache() {
  (matter as typeof matter & { clearCache: () => void }).clearCache();
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
      content: parsed.body,
      description: parsed.description,
      modelInvocable: parsed.modelInvocable,
      // Agent Skills are addressed by their containing directory name.
      name: entry.name,
      skillDir,
      source,
      title: parsed.title ?? entry.name,
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
function sanitizeFrontmatter(raw: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match?.[1]) {
    return raw;
  }

  const frontmatter = match[1];
  const lines = frontmatter.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
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

  return raw.replace(frontmatter, () => result.join("\n"));
}
