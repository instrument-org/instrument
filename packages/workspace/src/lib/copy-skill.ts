import fs from "node:fs/promises";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getIgnore } from "./get-ignore";
import { normalizePath } from "./normalize-path";
import { SKILL_COPY_IGNORE } from "./skill-artifact-ignore";
import { type SkillSourceId } from "./skills";
import { getTaskWorkDir } from "./task-dir-utils";

/**
 * Copy a skill into a task, restoring anything a previous load left missing.
 *
 * Loading the same skill twice is expected rather than exceptional: a load can
 * be cut short by a timeout or a stop with the directory already created, and a
 * skill whose instructions have scrolled out of context is worth asking for
 * again. So an existing copy is filled in, never replaced -- the files are the
 * agent's to edit once they are here, and overwriting them would discard work
 * on the second load of a skill the agent had already adapted.
 */
export async function copySkill({
  dir,
  signal,
  skillDir,
  skillName,
  skillSource,
}: {
  dir: TaskDir;
  signal: AbortSignal;
  skillDir: AbsolutePath;
  skillName: string;
  skillSource: SkillSourceId;
}): Promise<{ alreadyLoaded: boolean; destDir: AbsolutePath }> {
  await ensureNestedSkillWorkspace(dir);
  const destDir = absolutePathJoin(
    getTaskWorkDir(dir),
    TASK_FOLDER_NAMES.skills,
    skillSource,
    skillName,
  );

  const alreadyLoaded = await fs
    .access(destDir)
    .then(() => true)
    .catch(() => false);

  await fs.mkdir(destDir, { recursive: true });
  // The skill's own .gitignore, not the task's: it is the only file that speaks
  // for what this directory leaves behind, and another agent that ran the skill
  // in place may have filled it with build output or an installed environment.
  const baseIgnore = await getIgnore(skillDir, { signal });
  // Omit test infrastructure -- it's only used during skill development before
  // the skill is committed to the registry and made available to the agent.
  const ignore = baseIgnore.add(SKILL_COPY_IGNORE);
  await fs.cp(skillDir, destDir, {
    errorOnExist: false,
    filter: (src) => {
      const relativePath = normalizePath(path.relative(skillDir, src));
      if (relativePath === "") {
        return true;
      }
      // A directory-only rule (`build/`) matches only with the trailing slash,
      // and the filter is not told whether `src` is a directory. Testing both
      // forms prunes the subtree rather than copying an empty shell of it.
      return (
        !ignore.ignores(relativePath) && !ignore.ignores(`${relativePath}/`)
      );
    },
    force: false,
    recursive: true,
  });
  return { alreadyLoaded, destDir };
}

/**
 * Keep older tasks' package workspace aware of the collision-free skill path.
 * The original one-level pattern remains for skills loaded before this layout.
 */
async function ensureNestedSkillWorkspace(dir: TaskDir) {
  const workspaceFile = absolutePathJoin(
    getTaskWorkDir(dir),
    "pnpm-workspace.yaml",
  );
  let contents;
  try {
    contents = await fs.readFile(workspaceFile, "utf8");
  } catch {
    return;
  }
  if (contents.split(/\r?\n/).some((line) => line.trim() === "- skills/*/*")) {
    return;
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const legacyIndex = lines.findIndex((line) => line.trim() === "- skills/*");
  const legacyLine = lines[legacyIndex];
  if (legacyIndex === -1 || legacyLine === undefined) {
    return;
  }
  const indent = legacyLine.slice(0, legacyLine.indexOf("-"));
  lines.splice(legacyIndex + 1, 0, `${indent}- skills/*/*`);
  await fs.writeFile(workspaceFile, lines.join(newline));
}
