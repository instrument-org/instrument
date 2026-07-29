import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SKILL_NAMES } from "./skill-names";

// The registry submodule at the repo root; CI checks it out recursively.
const REGISTRY_SKILLS_DIR = path.join(
  import.meta.dirname,
  "../../../../registry/skills",
);

async function listRegistrySkills(): Promise<string[]> {
  const entries = await readdir(REGISTRY_SKILLS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((e) => e.name);
}

describe("SKILL_NAMES", () => {
  it.each(Object.entries(SKILL_NAMES))(
    "%s resolves to a skill that still exists in the registry",
    async (_key, skillName) => {
      expect(await listRegistrySkills()).toContain(skillName);
    },
  );
});
