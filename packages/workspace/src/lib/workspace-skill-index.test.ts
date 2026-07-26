import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
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
  readWorkspaceSkillIndex,
  recordWorkspaceSkillMutation,
  withWorkspaceSkillTracking,
} from "./workspace-skill-index";
import { writeFileWithDir } from "./write-file-with-dir";

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
    withWorkspaceSkillTracking(turn, () => {
      for (const name of ["brief", "tidy", "stale"]) {
        recordWorkspaceSkillMutation(`/${name}`);
      }
    });

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
    expect(changes).toEqual({ created: [], removed: [], updated: [] });
  });

  it("reports nothing for a turn that was never tracked", async () => {
    await writeSkill("tidy", "Tidy things.");

    const changes = await consumeSkillChanges(turn);
    expect(changes).toEqual({ created: [], removed: [], updated: [] });
  });

  it("forgets the turn once consumed", async () => {
    await beginSkillChangeTracking(turn);
    await writeSkill("brief", "Write a brief.");
    withWorkspaceSkillTracking(turn, () => {
      recordWorkspaceSkillMutation("/brief/SKILL.md");
    });

    const changes = await consumeSkillChanges(turn);
    expect(changes.created).toEqual(["brief"]);
    await expect(consumeSkillChanges(turn)).resolves.toEqual({
      created: [],
      removed: [],
      updated: [],
    });
  });

  it("forgets a turn consumed while its initial snapshot is pending", async () => {
    let unblockRead = () => {};
    const blockedRead = new Promise<void>((resolve) => {
      unblockRead = resolve;
    });
    const readdir = vi.spyOn(fs, "readdir").mockImplementationOnce(async () => {
      await blockedRead;
      return [];
    });

    const begin = beginSkillChangeTracking(turn);
    await vi.waitFor(() => {
      expect(readdir).toHaveBeenCalledOnce();
    });
    const consume = consumeSkillChanges(turn);
    unblockRead();
    await Promise.all([begin, consume]);

    await writeSkill("brief", "Write a brief.");
    withWorkspaceSkillTracking(turn, () => {
      recordWorkspaceSkillMutation("/brief/SKILL.md");
    });
    await expect(consumeSkillChanges(turn)).resolves.toEqual({
      created: [],
      removed: [],
      updated: [],
    });
  });

  it("does not attribute another session's write", async () => {
    const otherTurn = { ...turn, sessionId: StoreId.newSessionId() };
    await Promise.all([
      beginSkillChangeTracking(turn),
      beginSkillChangeTracking(otherTurn),
    ]);

    await writeSkill("brief", "Write a brief.");
    withWorkspaceSkillTracking(turn, () => {
      recordWorkspaceSkillMutation("/brief/SKILL.md");
    });

    await expect(consumeSkillChanges(otherTurn)).resolves.toEqual({
      created: [],
      removed: [],
      updated: [],
    });
    await expect(consumeSkillChanges(turn)).resolves.toEqual({
      created: ["brief"],
      removed: [],
      updated: [],
    });
  });

  it("attributes a change outside SKILL.md to the writing session", async () => {
    await writeSkill("tidy", "Tidy things.");
    await beginSkillChangeTracking(turn);

    await fs.mkdir(path.join(skillsDir, "tidy", "scripts"));
    await fs.writeFile(path.join(skillsDir, "tidy", "scripts", "run.ts"), "");
    withWorkspaceSkillTracking(turn, () => {
      recordWorkspaceSkillMutation("/tidy/scripts/run.ts");
    });

    await expect(consumeSkillChanges(turn)).resolves.toEqual({
      created: [],
      removed: [],
      updated: ["tidy"],
    });
  });

  it("attributes dedicated file writes through the shared write boundary", async () => {
    await beginSkillChangeTracking(turn);

    await withWorkspaceSkillTracking(turn, () =>
      writeFileWithDir(
        AbsolutePathSchema.parse(path.join(skillsDir, "brief", "SKILL.md")),
        "---\ndescription: Brief\n---\n\nBody.\n",
      ),
    );

    await expect(consumeSkillChanges(turn)).resolves.toEqual({
      created: ["brief"],
      removed: [],
      updated: [],
    });
  });
});

async function writeSkill(name: string, description: string) {
  await fs.mkdir(path.join(skillsDir, name), { recursive: true });
  await fs.writeFile(
    path.join(skillsDir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`,
  );
}
