import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { getIgnore } from "./get-ignore";
import { normalizedPathJoin, normalizePath } from "./normalize-path";
import { getTaskWorkDir } from "./task-dir-utils";

const SKILL_DEVELOPMENT_ARTIFACTS = [
  ".coverage",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "node_modules",
];

export async function copySkill({
  dir,
  signal,
  skillDir,
  skillName,
}: {
  dir: TaskDir;
  signal: AbortSignal;
  skillDir: AbsolutePath;
  skillName: string;
}): Promise<Result<AbsolutePath, TypedError.Conflict>> {
  const destDir = absolutePathJoin(
    getTaskWorkDir(dir),
    TASK_FOLDER_NAMES.skills,
    skillName,
  );

  try {
    await fs.access(destDir);
    return err(
      new TypedError.Conflict(
        `Skill "${skillName}" is already loaded. Read ${normalizedPathJoin(TASK_FOLDER_NAMES.work, TASK_FOLDER_NAMES.skills, skillName, "SKILL.md")} if you haven't yet -- do not read other files in that folder unless the skill instructs you to.`,
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await fs.mkdir(destDir, { recursive: true });
  const baseIgnore = await getIgnore(dir, { signal });
  // Omit test infrastructure -- it's only used during skill development before
  // the skill is committed to the registry and made available to the agent.
  const ignore = baseIgnore.add([
    "SKILL.template.md",
    ...SKILL_DEVELOPMENT_ARTIFACTS,
    "tests",
    "vitest.config.ts",
  ]);
  await fs.cp(skillDir, destDir, {
    filter: (src) => {
      const relativePath = path.relative(skillDir, src);
      if (relativePath === "") {
        return true;
      }
      return !ignore.ignores(normalizePath(relativePath));
    },
    recursive: true,
  });
  return ok(destDir);
}
