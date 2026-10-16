import { APP_NAME_SLUG } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import { SKILLS_FOLDER_NAME } from "../constants";

import { type WorkspaceDir } from "../schemas/paths";
import { pathIsWithin } from "./path-is-within";
import { type SkillInfo } from "./skills";

export const SKILL_ORIGINS = [
  "external",
  "in-repo",
  "workspace",
  APP_NAME_SLUG,
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
      : skill.source === APP_NAME_SLUG || skill.source === "system"
        ? APP_NAME_SLUG
        : "external";
  return {
    editable,
    installDependencies: origin !== "external",
    origin,
  };
}

/**
 * Canonical path of the workspace skills directory, which is the boundary
 * that decides whether a skill is the person's to edit. It has to name the
 * same folder the skills are loaded from, or every skill in the workspace
 * reads as someone else's and the app offers no way to change it.
 */
export async function getWritableSkillsRoot(rootDir: WorkspaceDir) {
  const root = path.join(rootDir, SKILLS_FOLDER_NAME);
  return fs.realpath(root).catch(() => root);
}
