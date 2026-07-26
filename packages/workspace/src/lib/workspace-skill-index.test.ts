import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import {
  createMockTaskConfigForDir,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-task-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import {
  beginSkillChangeTracking,
  consumeSkillChanges,
  hasSkillChanges,
  readWorkspaceSkillIndex,
} from "./workspace-skill-index";

createMockTaskConfigForDir(
  `${MOCK_WORKSPACE_DIRS.tasks}/workspace-skill-index`,
);

// The shared mock workspace root is a real directory every test file's process
// sees, and this suite writes skills into it, so it needs a root of its own.
const rootDir = mkdtempSync(path.join(os.tmpdir(), "workspace-skill-index-"));
setWorkspaceConfig({
  ...getWorkspaceConfig(),
  rootDir: WorkspaceDirSchema.parse(rootDir),
});

const skillsDir = path.join(rootDir, "skills");
const turn = {
  id: TaskIdSchema.parse("workspace-skill-index"),
  sessionId: StoreId.newSessionId(),
};

afterEach(async () => {
  await fs.rm(skillsDir, { force: true, recursive: true });
});

describe("readWorkspaceSkillIndex", () => {
  it("is empty when the workspace has no skills directory", async () => {
    await expect(readWorkspaceSkillIndex()).resolves.toEqual(new Map());
  });

  it("indexes only directories holding a SKILL.md", async () => {
    await writeSkill("tidy", "Tidy things.");
    await fs.mkdir(path.join(skillsDir, "not-a-skill"), { recursive: true });
    await fs.writeFile(path.join(skillsDir, "loose.md"), "not a skill");

    const index = await readWorkspaceSkillIndex();
    expect([...index.keys()]).toEqual(["tidy"]);
  });
});

describe("consumeSkillChanges", () => {
  it("reports skills created, updated, and removed during the turn", async () => {
    await writeSkill("tidy", "Tidy things.");
    await writeSkill("stale", "Going away.");
    await beginSkillChangeTracking(turn);

    await writeSkill("brief", "Write a brief.");
    await writeSkill("tidy", "Tidy things, thoroughly and well.");
    await fs.rm(path.join(skillsDir, "stale"), { recursive: true });

    await expect(consumeSkillChanges(turn)).resolves.toMatchInlineSnapshot(`
      {
        "created": [
          "brief",
        ],
        "removed": [
          "stale",
        ],
        "updated": [
          "tidy",
        ],
      }
    `);
  });

  it("reports nothing when the turn left the skills alone", async () => {
    await writeSkill("tidy", "Tidy things.");
    await beginSkillChangeTracking(turn);

    const changes = await consumeSkillChanges(turn);
    expect(hasSkillChanges(changes)).toBe(false);
  });

  it("reports nothing for a turn that was never tracked", async () => {
    await writeSkill("tidy", "Tidy things.");

    const changes = await consumeSkillChanges(turn);
    expect(hasSkillChanges(changes)).toBe(false);
  });

  it("forgets the turn once consumed", async () => {
    await beginSkillChangeTracking(turn);
    await writeSkill("brief", "Write a brief.");

    const changes = await consumeSkillChanges(turn);
    expect(changes.created).toEqual(["brief"]);
    expect(hasSkillChanges(await consumeSkillChanges(turn))).toBe(false);
  });
});

async function writeSkill(name: string, description: string) {
  await fs.mkdir(path.join(skillsDir, name), { recursive: true });
  await fs.writeFile(
    path.join(skillsDir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`,
  );
}
