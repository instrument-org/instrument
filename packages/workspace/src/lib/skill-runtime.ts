import fsSync from "node:fs";
import path from "node:path";

import { isRecord } from "./skills";

/**
 * Which dependency installs a skill triggers when it is loaded, or the reason
 * it cannot be loaded at all.
 *
 * `load_skill` refuses a skill in the error case, so anything reported here is
 * a hard failure the author sees only when they try to use the skill.
 */
export type SkillRuntime =
  | { error: string }
  | { node: boolean; python: boolean };

export function getSkillRuntime(
  skillDir: string,
  skillName: string,
): SkillRuntime {
  const packageJsonPath = path.join(skillDir, "package.json");
  let node = false;

  if (fsSync.existsSync(packageJsonPath)) {
    let packageJson: unknown;
    try {
      packageJson = JSON.parse(fsSync.readFileSync(packageJsonPath, "utf8"));
    } catch {
      return {
        error: `Skill "${skillName}" has an invalid package.json.`,
      };
    }

    if (!isRecord(packageJson)) {
      return {
        error: `Skill "${skillName}" has an invalid package.json.`,
      };
    }

    for (const field of ["dependencies", "optionalDependencies"]) {
      const dependencies = packageJson[field];
      if (dependencies === undefined) {
        continue;
      }
      if (
        !isRecord(dependencies) ||
        Object.values(dependencies).some(
          (version) => typeof version !== "string",
        )
      ) {
        return {
          error: `Skill "${skillName}" has an invalid ${field} field in package.json.`,
        };
      }
      node ||= Object.keys(dependencies).length > 0;
    }
  }

  const python = fsSync.existsSync(path.join(skillDir, "pyproject.toml"));
  if (python && !fsSync.existsSync(path.join(skillDir, "uv.lock"))) {
    return {
      error: `Skill "${skillName}" is missing uv.lock for its Python dependencies.`,
    };
  }

  return { node, python };
}
