import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readPermissionSettings } from "../../lib/permissions/rules";
import { TOPIC_FILE_NAME, topicsDir } from "../../lib/chat/topics";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type WorkspaceRPCContext } from "../base";
import { topics } from "./topics";

// Whether granting a topic's folders fails, which a test sets.
const grant = vi.hoisted(() => ({ fails: false }));
vi.mock(
  import("../../lib/permissions/topic-folders"),
  async (importOriginal) => {
    const original = await importOriginal();
    return {
      ...original,
      setTopicFolders: (
        ...args: Parameters<typeof original.setTopicFolders>
      ) =>
        grant.fails
          ? Promise.reject(new Error("permissions.json is not writable"))
          : original.setTopicFolders(...args),
    };
  },
);

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // These routes never read the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

let root: string;
let folder: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "topics-route-"));
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "topics-route-folder-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
    workspaceMachineDir: AbsolutePathSchema.parse(`${root}-machine`),
  });
  grant.fails = false;
});

afterEach(() => {
  for (const dir of [root, `${root}-machine`, folder]) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

function list() {
  return call(topics.list, undefined, { context: createContext() });
}

it("makes a topic with its instructions and folders in one call", async () => {
  const created = await call(
    topics.create,
    {
      color: "#3b6ef6",
      emoji: "🌱",
      folders: [{ path: folder }],
      instructions: "  Answer in metric.  ",
      name: "Garden",
    },
    { context: createContext() },
  );

  const [listed] = await list();
  expect(listed).toMatchObject({
    folders: [{ path: folder }],
    id: created.id,
    instructions: "Answer in metric.",
    name: "Garden",
  });
  expect(
    fs.readFileSync(path.join(topicsDir(), "Garden", TOPIC_FILE_NAME), "utf8"),
  ).toContain("Answer in metric.");
  const settings = await readPermissionSettings();
  expect(settings.topics[created.id]?.folders.map((each) => each.path)).toEqual(
    [folder],
  );
});

it("leaves no topic behind when its folders cannot be granted", async () => {
  grant.fails = true;
  await expect(
    call(
      topics.create,
      { folders: [{ path: folder }], instructions: "Notes", name: "Garden" },
      { context: createContext() },
    ),
  ).rejects.toThrow();

  expect(await list()).toEqual([]);
  expect(fs.existsSync(path.join(topicsDir(), "Garden"))).toBe(false);
});

it("keeps a folder of the person's that stood where a failed topic was made", async () => {
  const theirs = path.join(topicsDir(), "Garden");
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(theirs, "seeds.txt"), "tomatoes");
  grant.fails = true;

  await expect(
    call(
      topics.create,
      { folders: [{ path: folder }], name: "Garden" },
      { context: createContext() },
    ),
  ).rejects.toThrow();

  expect(fs.readdirSync(theirs)).toEqual(["seeds.txt"]);
});

it("puts a retired topic back as it was when its folders cannot be granted", async () => {
  const first = await call(
    topics.create,
    { instructions: "Old words", name: "Garden" },
    { context: createContext() },
  );
  await call(
    topics.retire,
    { topicId: first.id },
    { context: createContext() },
  );
  grant.fails = true;

  await expect(
    call(
      topics.create,
      {
        folders: [{ path: folder }],
        instructions: "New words",
        name: "Garden",
      },
      { context: createContext() },
    ),
  ).rejects.toThrow();

  const [listed] = await list();
  expect(listed).toMatchObject({
    id: first.id,
    instructions: "Old words",
    retired: true,
  });
});

it("returns a topic in use under the name as it is, given only the name", async () => {
  const first = await call(
    topics.create,
    { instructions: "Keep these", name: "Garden" },
    { context: createContext() },
  );

  const again = await call(
    topics.create,
    { name: "garden" },
    { context: createContext() },
  );

  expect(again.id).toBe(first.id);
});

it("refuses a name in use given instructions or folders, leaving that topic alone", async () => {
  await call(
    topics.create,
    { instructions: "Keep these", name: "Garden" },
    { context: createContext() },
  );

  await expect(
    call(
      topics.create,
      {
        folders: [{ path: folder }],
        instructions: "Not these",
        name: "garden",
      },
      { context: createContext() },
    ),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "There is already a topic called “Garden”",
  });
  const [listed] = await list();
  expect(listed?.instructions).toBe("Keep these");
  expect(listed?.folders).toBeUndefined();
});
