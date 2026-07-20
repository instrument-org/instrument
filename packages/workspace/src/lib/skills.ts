import matter from "@11ty/gray-matter";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { REGISTRY_FOLDER_NAMES } from "../constants";
import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { pathExists } from "./path-exists";

export const FILE_LIST_LIMIT = 50;

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

export async function findSkills(sources: SkillSource[]): Promise<SkillInfo[]> {
  const skillMap = new Map<string, SkillInfo>();

  for (const { dir, source } of sources) {
    const skills = await findSkillsInDir(dir, source);
    for (const skill of skills) {
      skillMap.set(skill.name, skill);
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
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath);
      } else if (entry.name !== "SKILL.md") {
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

export function parseFrontmatter(
  raw: string,
): null | { body: string; description: string; modelInvocable: boolean } {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch {
    try {
      parsed = matter(sanitizeFrontmatter(raw));
    } catch {
      return null;
    }
  }

  const description =
    typeof parsed.data.description === "string"
      ? parsed.data.description.trim()
      : undefined;
  if (!description) {
    return null;
  }

  return {
    body: parsed.content.trim(),
    description,
    modelInvocable: parsed.data["disable-model-invocation"] !== true,
  };
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
    if (!parsed) {
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
