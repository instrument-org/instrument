import fs from "node:fs/promises";

import { REGISTRY_FOLDER_NAMES } from "../constants";
import { type WorkspaceDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { pathIsWithin } from "./path-is-within";
import { type SkillInfo } from "./skills";

export const SKILL_ORIGINS = [
  "external",
  "in-repo",
  "instrument",
  "workspace",
] as const;

export interface SkillProvenance {
  editable: boolean;
  installDependencies: boolean;
  origin: (typeof SKILL_ORIGINS)[number];
}

/**
 * Resolves editability, user-facing origin, and dependency trust from the same
 * canonical writable-root boundary.
 */
export function getSkillProvenance(
  skill: Pick<SkillInfo, "skillDir" | "source">,
  writableRoot: string,
): SkillProvenance {
  const editable = pathIsWithin(skill.skillDir, writableRoot);
  const origin = editable
    ? "workspace"
    : skill.source === "workspace"
      ? "in-repo"
      : skill.source === "registry" || skill.source === "system"
        ? "instrument"
        : "external";
  return {
    editable,
    installDependencies: origin !== "external",
    origin,
  };
}

/** Canonical path of the workspace skills directory mounted at `/skills`. */
export async function getWritableSkillsRoot(rootDir: WorkspaceDir) {
  const root = absolutePathJoin(rootDir, REGISTRY_FOLDER_NAMES.skills);
  return fs.realpath(root).catch(() => root);
}
