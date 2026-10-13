import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SKILL_NAMES } from "./skill-names";

// The two sources the app ships skills from: its own system skills, and the
// registry submodule at the repo root, which CI checks out recursively.
const BUNDLED_SKILLS_DIRS = [
  path.join(import.meta.dirname, "../../system-skills"),
  path.join(import.meta.dirname, "../../../../registry/skills"),
];

async function listBundledSkills(): Promise<string[]> {
  const listed = await Promise.all(
    BUNDLED_SKILLS_DIRS.map((dir) => readdir(dir, { withFileTypes: true })),
  );
  return listed
    .flat()
    .filter((entry) => entry.isDirectory())
    .map((e) => e.name);
}

describe("SKILL_NAMES", () => {
  it.each(Object.entries(SKILL_NAMES))(
    "%s resolves to a skill the app still ships",
    async (_key, skillName) => {
      expect(await listBundledSkills()).toContain(skillName);
    },
  );
});
