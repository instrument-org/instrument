import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMORY_FOLDER_NAME,
  SKILLS_FOLDER_NAME,
  TOPIC_FILE_NAME,
  TOPICS_FOLDER_NAME,
} from "../constants";
import {
  AbsolutePathSchema,
  WorkDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { MountedFolder } from "../schemas/mounted-folder";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import {
  createMockChatConfigForDir,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-chat-config";
import { memoryDir, saveMemory } from "./memory/store";
import {
  beginSetupChangeTracking,
  consumeSetupChanges,
  recordSetupTouch,
} from "./setup-changes";
import { toolFs } from "./tool-fs";
import { withTurnContext } from "./turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { buildWorkspaceFsLayout, shellPath } from "./workspace-fs-layout";

createMockChatConfigForDir(`${MOCK_WORKSPACE_DIRS.chats}/setup-changes`);

// The shared mock workspace root is a real directory every test file's
// process sees, and this suite writes skills into it, so it needs its own.
const rootDir = mkdtempSync(path.join(os.tmpdir(), "setup-changes-"));
setWorkspaceConfig({
  ...getWorkspaceConfig(),
  rootDir: WorkspaceDirSchema.parse(rootDir),
});

const skillsDir = path.join(rootDir, SKILLS_FOLDER_NAME);
const turn = {
  id: ChatIdSchema.parse("setup-changes"),
  sessionId: StoreId.newSessionId(),
};

afterEach(async () => {
  await fs.rm(skillsDir, { force: true, recursive: true });
  await fs.rm(path.join(rootDir, MEMORY_FOLDER_NAME), {
    force: true,
    recursive: true,
  });
});

/** The agent's own filesystem, the one its shell and file tools write through. */
async function agentFs({ folders }: { folders?: string[] } = {}) {
  const files = await toolFs(
    // The chat's, which keeps the memories.
    buildWorkspaceFsLayout({
      apps: true,
      chatHostRoot: WorkDirSchema.parse(path.join(rootDir, "work")),
      ...(folders && {
        folders: Object.fromEntries(
          folders.map((folder, index) => [
            `folder-${index}`,
            {
              access: "read-write" as const,
              id: MountedFolder.IdSchema.parse(`folder-${index}`),
              path: AbsolutePathSchema.parse(folder),
            },
          ]),
        ),
      }),
    }),
  );
  const at = (...segments: string[]) =>
    shellPath(path.join(skillsDir, ...segments));
  return { at, fs: files.fs };
}

describe("consumeSetupChanges", () => {
  it("reads skills added, changed and removed off the turn's own writes", async () => {
    await writeSkill("tidy");
    await writeSkill("stale");
    const agent = await agentFs();
    beginSetupChangeTracking(turn);

    await withTurnContext(turn, async () => {
      await agent.fs.mkdir(agent.at("brief"), { recursive: true });
      await agent.fs.writeFile(agent.at("brief", "SKILL.md"), skill("brief"));
      // A script beside the instructions is a change to the skill too.
      await agent.fs.writeFile(agent.at("tidy", "run.sh"), "echo tidy\n");
      await agent.fs.rm(agent.at("stale"), { recursive: true });
    });

    await expect(consumeSetupChanges(turn)).resolves.toMatchInlineSnapshot(`
      [
        {
          "change": "added",
          "kind": "skill",
          "name": "brief",
        },
        {
          "change": "removed",
          "kind": "skill",
          "name": "stale",
        },
        {
          "change": "changed",
          "kind": "skill",
          "name": "tidy",
        },
      ]
    `);
  });

  it("reports nothing for a turn that wrote nothing, or was never tracked", async () => {
    await writeSkill("tidy");
    beginSetupChangeTracking(turn);
    await expect(consumeSetupChanges(turn)).resolves.toEqual([]);
    await expect(consumeSetupChanges(turn)).resolves.toEqual([]);
  });

  it("leaves out what someone else changed while the turn ran", async () => {
    await writeSkill("tidy");
    const agent = await agentFs();
    beginSetupChangeTracking(turn);

    // The person, or another chat: a write with no part in this turn.
    await writeSkill("from-finder");
    await fs.rm(path.join(skillsDir, "tidy"), { recursive: true });
    await withTurnContext(turn, () =>
      agent.fs.writeFile(agent.at("mine", "SKILL.md"), skill("mine")),
    );

    await expect(consumeSetupChanges(turn)).resolves.toEqual([
      { change: "added", kind: "skill", name: "mine" },
    ]);
  });

  it("credits a write only to the session that made it", async () => {
    const other = { ...turn, sessionId: StoreId.newSessionId() };
    const agent = await agentFs();
    beginSetupChangeTracking(turn);
    beginSetupChangeTracking(other);

    await withTurnContext(turn, () =>
      agent.fs.writeFile(agent.at("brief", "SKILL.md"), skill("brief")),
    );

    await expect(consumeSetupChanges(other)).resolves.toEqual([]);
    await expect(consumeSetupChanges(turn)).resolves.toEqual([
      { change: "added", kind: "skill", name: "brief" },
    ]);
  });

  it("drops a write that arrives after its turn ended", async () => {
    beginSetupChangeTracking(turn);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A continuation still running inside the finished turn's context. The
    // next turn on the session shares its chat and session, so only the turn
    // id keeps this write off that turn's report.
    const late = withTurnContext(turn, async () => {
      await blocked;
      recordSetupTouch({ existedBefore: false, kind: "skill", name: "brief" });
    });
    await consumeSetupChanges(turn);

    beginSetupChangeTracking(turn);
    await writeSkill("brief");
    release?.();
    await late;

    await expect(consumeSetupChanges(turn)).resolves.toEqual([]);
  });

  it("reports each skill when the turn empties the folder", async () => {
    await writeSkill("one");
    await writeSkill("two");
    const agent = await agentFs();
    beginSetupChangeTracking(turn);

    // What `rm -rf "$SKILLS"/*` hands the filesystem: the glob is the
    // shell's, so each skill arrives as its own path.
    await withTurnContext(turn, async () => {
      for (const name of await agent.fs.readdir(shellPath(skillsDir))) {
        await agent.fs.rm(agent.at(name), { force: true, recursive: true });
      }
    });

    await expect(consumeSetupChanges(turn)).resolves.toEqual([
      { change: "removed", kind: "skill", name: "one" },
      { change: "removed", kind: "skill", name: "two" },
    ]);
  });

  it("names a skill copied into the folder after what was copied", async () => {
    await writeSkill("existing");
    const agent = await agentFs();
    const source = path.join(rootDir, "work", "drafted");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "SKILL.md"), skill("drafted"));
    beginSetupChangeTracking(turn);

    await withTurnContext(turn, () =>
      agent.fs.cp(shellPath(source), agent.at("drafted"), { recursive: true }),
    );

    await expect(consumeSetupChanges(turn)).resolves.toEqual([
      { change: "added", kind: "skill", name: "drafted" },
    ]);
  });

  it("reads a memory saved, replaced or forgotten by what is on disk after", async () => {
    await saveMemory(memoryDir(), {
      name: "pacific-time",
      text: "You are on Pacific time.",
    });
    await saveMemory(memoryDir(), { name: "no-stevia", text: "No stevia." });
    beginSetupChangeTracking(turn);

    await withTurnContext(turn, async () => {
      await saveMemory(memoryDir(), {
        name: "mornings",
        text: "Mornings are best.",
      });
      recordSetupTouch({
        existedBefore: false,
        kind: "memory",
        name: "mornings",
      });
      recordSetupTouch({
        existedBefore: true,
        kind: "memory",
        name: "pacific-time",
      });
      await fs.rm(path.join(memoryDir(), "no-stevia.md"));
      recordSetupTouch({
        existedBefore: true,
        kind: "memory",
        name: "no-stevia",
      });
    });

    await expect(consumeSetupChanges(turn)).resolves.toEqual([
      { change: "added", kind: "memory", name: "mornings" },
      { change: "removed", kind: "memory", name: "no-stevia" },
      { change: "changed", kind: "memory", name: "pacific-time" },
    ]);
  });
});

describe("the workspace's top level as a folder of the chat's", () => {
  // As it is when the output folder is the workspace itself.
  it("reads topics and memories the agent's shell wrote there", async () => {
    try {
      const agent = await agentFs({ folders: [rootDir] });
      const at = (...segments: string[]) =>
        shellPath(path.join(rootDir, ...segments));
      beginSetupChangeTracking(turn);

      await withTurnContext(turn, async () => {
        await agent.fs.mkdir(at(TOPICS_FOLDER_NAME, "Travel"), {
          recursive: true,
        });
        await agent.fs.writeFile(
          at(TOPICS_FOLDER_NAME, "Travel", TOPIC_FILE_NAME),
          "---\nid: travel\n---\n",
        );
        await agent.fs.mkdir(at(MEMORY_FOLDER_NAME), { recursive: true });
        await agent.fs.writeFile(
          at(MEMORY_FOLDER_NAME, "mornings.md"),
          "Mornings are best.\n",
        );
      });

      await expect(consumeSetupChanges(turn)).resolves.toEqual([
        { change: "added", kind: "memory", name: "mornings" },
        { change: "added", kind: "topic", name: "Travel" },
      ]);
    } finally {
      await fs.rm(path.join(rootDir, TOPICS_FOLDER_NAME), {
        force: true,
        recursive: true,
      });
    }
  });
});

function skill(name: string) {
  return `---\nname: ${name}\ndescription: ${name}\n---\n\nBody.\n`;
}

async function writeSkill(name: string) {
  await fs.mkdir(path.join(skillsDir, name), { recursive: true });
  await fs.writeFile(path.join(skillsDir, name, "SKILL.md"), skill(name));
}
