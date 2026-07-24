import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { REGISTRY_FOLDER_NAMES } from "../constants";
import { type AbsolutePath, type WorkspaceDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { findSkill } from "./skills";

export async function deleteSkill(
  {
    registryDir,
    rootDir,
    systemSkillsDir,
  }: {
    registryDir: AbsolutePath;
    rootDir: WorkspaceDir;
    systemSkillsDir: AbsolutePath;
  },
  name: string,
): Promise<
  Result<
    undefined,
    TypedError.FileSystem | TypedError.NotFound | TypedError.Parse
  >
> {
  const { skill } = await findSkill(
    { registryDir, rootDir, systemSkillsDir },
    name,
  );
  if (!skill) {
    return err(new TypedError.NotFound(`Skill "${name}" was not found`));
  }

  const writableRoot = await writableSkillsRoot(rootDir);
  if (!isWithinWritableSkillsRoot(skill.skillDir, writableRoot)) {
    return err(
      new TypedError.Parse(
        `Skill "${name}" is not editable because it lives outside /${REGISTRY_FOLDER_NAMES.skills}`,
      ),
    );
  }

  try {
    await fs.rm(skill.skillDir, { recursive: true });
  } catch (error) {
    return err(
      new TypedError.FileSystem(`Failed to delete skill "${name}"`, {
        cause: error,
      }),
    );
  }

  return ok(undefined);
}

function isWithinWritableSkillsRoot(skillDir: string, writableRoot: string) {
  return (
    skillDir === writableRoot || skillDir.startsWith(writableRoot + path.sep)
  );
}

async function writableSkillsRoot(rootDir: WorkspaceDir): Promise<string> {
  const root = absolutePathJoin(rootDir, REGISTRY_FOLDER_NAMES.skills);
  return fs.realpath(root).catch(() => root);
}
