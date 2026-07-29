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
import { type TurnKey, withTurnContext } from "./turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import {
  beginMountChangeTracking,
  consumeMountChanges,
  readWorkspaceMountIndex,
  recordWorkspaceMountMutation,
} from "./workspace-mount-index";
import { writeFileWithDir } from "./write-file-with-dir";

createMockTaskConfigForDir(
  `${MOCK_WORKSPACE_DIRS.tasks}/workspace-mount-index`,
);

// The shared mock workspace root is a real directory every test file's process
// sees, and this suite writes into it, so it needs a root of its own.
const rootDir = mkdtempSync(path.join(os.tmpdir(), "workspace-mount-index-"));
const skillsDir = path.join(rootDir, "skills");
setWorkspaceConfig({
  ...getWorkspaceConfig(),
  rootDir: WorkspaceDirSchema.parse(rootDir),
});

const turn = {
  id: TaskIdSchema.parse("workspace-mount-index"),
  sessionId: StoreId.newSessionId(),
};

afterEach(async () => {
  await fs.rm(skillsDir, { force: true, recursive: true });
});

describe("readWorkspaceMountIndex", () => {
  it("is empty when the workspace has no skills directory", async () => {
    await expect(readWorkspaceMountIndex("skills")).resolves.toEqual(new Map());
  });

  it("indexes only directories holding the mount's entry file", async () => {
    await writeSkill("tidy", "Tidy things.");
    await fs.mkdir(path.join(skillsDir, "not-a-skill"), { recursive: true });
    await fs.writeFile(path.join(skillsDir, "loose.md"), "not a skill");

    const index = await readWorkspaceMountIndex("skills");
    expect([...index.keys()]).toEqual(["tidy"]);
  });
});

describe("consumeMountChanges", () => {
  it("reports packages created, updated, and removed during the turn", async () => {
    await writeSkill("tidy", "Tidy things.");
    await writeSkill("stale", "Going away.");
    await beginMountChangeTracking(turn);

    await writeSkill("brief", "Write a brief.");
    await writeSkill("tidy", "Tidy things, thoroughly and well.");
    await fs.rm(path.join(skillsDir, "stale"), { recursive: true });
    withTurnContext(turn, () => {
      for (const name of ["brief", "tidy", "stale"]) {
        recordWorkspaceMountMutation("skills", `/${name}`);
      }
    });

    await expect(consumeSkills(turn)).resolves.toMatchInlineSnapshot(`
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

  it("reports nothing when the turn left the mounts alone", async () => {
    await writeSkill("tidy", "Tidy things.");
    await beginMountChangeTracking(turn);

    await expect(consumeSkills(turn)).resolves.toEqual(noChanges());
  });

  it("reports nothing for a turn that was never tracked", async () => {
    await writeSkill("tidy", "Tidy things.");

    await expect(consumeSkills(turn)).resolves.toEqual(noChanges());
  });

  it("forgets the turn once consumed", async () => {
    await beginMountChangeTracking(turn);
    await writeSkill("brief", "Write a brief.");
    withTurnContext(turn, () => {
      recordWorkspaceMountMutation("skills", "/brief/SKILL.md");
    });

    const changes = await consumeSkills(turn);
    expect(changes.created).toEqual(["brief"]);
    await expect(consumeSkills(turn)).resolves.toEqual(noChanges());
  });

  it("forgets a turn consumed while its initial snapshot is pending", async () => {
    let unblockRead: (() => void) | undefined;
    const blockedRead = new Promise<void>((resolve) => {
      unblockRead = resolve;
    });
    const readdir = vi.spyOn(fs, "readdir").mockImplementationOnce(async () => {
      await blockedRead;
      return [];
    });

    const begin = beginMountChangeTracking(turn);
    await vi.waitFor(() => {
      expect(readdir).toHaveBeenCalled();
    });
    const consume = consumeMountChanges(turn);
    unblockRead?.();
    await Promise.all([begin, consume]);

    await writeSkill("brief", "Write a brief.");
    withTurnContext(turn, () => {
      recordWorkspaceMountMutation("skills", "/brief/SKILL.md");
    });
    await expect(consumeSkills(turn)).resolves.toEqual(noChanges());
  });

  it("does not attribute another session's write", async () => {
    const otherTurn = { ...turn, sessionId: StoreId.newSessionId() };
    await Promise.all([
      beginMountChangeTracking(turn),
      beginMountChangeTracking(otherTurn),
    ]);

    await writeSkill("brief", "Write a brief.");
    withTurnContext(turn, () => {
      recordWorkspaceMountMutation("skills", "/brief/SKILL.md");
    });

    await expect(consumeSkills(otherTurn)).resolves.toEqual(noChanges());
    await expect(consumeSkills(turn)).resolves.toEqual({
      created: ["brief"],
      removed: [],
      updated: [],
    });
  });

  it("drops a write that arrives after its turn ended", async () => {
    await beginMountChangeTracking(turn);
    let releaseWrite: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    // A continuation still running inside the finished turn's context. The next
    // turn on this session shares its task and session, so only the turn id
    // keeps this write off that turn's report.
    const lateWrite = withTurnContext(turn, async () => {
      await blocked;
      recordWorkspaceMountMutation("skills", "/brief/SKILL.md");
    });
    await consumeMountChanges(turn);

    await beginMountChangeTracking(turn);
    await writeSkill("brief", "Write a brief.");
    releaseWrite?.();
    await lateWrite;

    await expect(consumeSkills(turn)).resolves.toEqual(noChanges());
  });

  it("reports only the changed packages when a mutation names none", async () => {
    await writeSkill("tidy", "Tidy things.");
    await writeSkill("brief", "Write a brief.");
    await beginMountChangeTracking(turn);

    await writeSkill("tidy", "Tidy things, thoroughly and well.");
    // A mutation aimed at the mount root: the boundary cannot say which package
    // it landed in, so the turn falls back to diffing the whole directory.
    withTurnContext(turn, () => {
      recordWorkspaceMountMutation("skills", "/");
    });

    await expect(consumeSkills(turn)).resolves.toEqual({
      created: [],
      removed: [],
      updated: ["tidy"],
    });
  });

  it("keeps a named package's change when the turn also mutates the root", async () => {
    await writeSkill("tidy", "Tidy things.");
    await beginMountChangeTracking(turn);

    await fs.mkdir(path.join(skillsDir, "tidy", "scripts"));
    await fs.writeFile(path.join(skillsDir, "tidy", "scripts", "run.ts"), "");
    withTurnContext(turn, () => {
      recordWorkspaceMountMutation("skills", "/tidy/scripts/run.ts");
      // Installing a package copies into the mount root, which names nothing.
      // The turn still named `tidy`, so that evidence has to survive.
      recordWorkspaceMountMutation("skills", "/");
    });

    await expect(consumeSkills(turn)).resolves.toEqual({
      created: [],
      removed: [],
      updated: ["tidy"],
    });
  });

  it("attributes a change outside the entry file to the writing session", async () => {
    await writeSkill("tidy", "Tidy things.");
    await beginMountChangeTracking(turn);

    await fs.mkdir(path.join(skillsDir, "tidy", "scripts"));
    await fs.writeFile(path.join(skillsDir, "tidy", "scripts", "run.ts"), "");
    withTurnContext(turn, () => {
      recordWorkspaceMountMutation("skills", "/tidy/scripts/run.ts");
    });

    await expect(consumeSkills(turn)).resolves.toEqual({
      created: [],
      removed: [],
      updated: ["tidy"],
    });
  });

  it("attributes dedicated file writes through the shared write boundary", async () => {
    await beginMountChangeTracking(turn);

    await withTurnContext(turn, () =>
      writeFileWithDir(
        AbsolutePathSchema.parse(path.join(skillsDir, "brief", "SKILL.md")),
        "---\ndescription: Brief\n---\n\nBody.\n",
      ),
    );

    await expect(consumeSkills(turn)).resolves.toEqual({
      created: ["brief"],
      removed: [],
      updated: [],
    });
  });
});

async function consumeSkills(key: TurnKey) {
  const changes = await consumeMountChanges(key);
  return changes.skills;
}

function noChanges() {
  return { created: [], removed: [], updated: [] };
}

async function writeSkill(name: string, description: string) {
  await fs.mkdir(path.join(skillsDir, name), { recursive: true });
  await fs.writeFile(
    path.join(skillsDir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`,
  );
}
