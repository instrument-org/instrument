import { ok } from "neverthrow";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { type ChatGrant } from "../../schemas/chat-settings";
import { folderReach } from "./folder-reach";
import { type Topic } from "./topics";

const world = vi.hoisted(() => ({
  missing: new Set<string>(),
  tagged: [] as string[],
  topics: [] as Topic[],
}));

vi.mock(import("../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionOfChat: () => StoreId.newSessionId(),
}));
vi.mock(import("../store"), () => ({
  Store: {
    getSession: () => Promise.resolve(ok({ topics: world.tagged } as never)),
  } as never,
}));
vi.mock(import("./topics"), () => ({
  listTopics: () => Promise.resolve(world.topics),
}));
vi.mock(import("../path-exists"), () => ({
  pathExists: (folderPath: string) =>
    Promise.resolve(!world.missing.has(folderPath)),
}));

const chatId = ChatIdSchema.parse("chat-reach");
const home = os.homedir();
const workspace = path.join(home, "Documents", "Instrument");
const elsewhere = path.resolve(path.sep, "Volumes", "Archive");

function granted(...grants: { at: number; path: string }[]): ChatGrant[] {
  return grants.map((grant) => ({
    grantedAt: new Date(grant.at),
    path: AbsolutePathSchema.parse(grant.path),
    source: "attached",
  }));
}

/** Each mount the agent sees, by name, with the folder behind it. */
async function reach(grants: ChatGrant[]) {
  const folders = await folderReach(chatId, grants);
  return Object.entries(folders).map(
    ([mountName, folder]) => `${mountName} ${folder.path}`,
  );
}

function topic(name: string, folders: string[]): Topic {
  return {
    createdAt: 0,
    folders: folders.map((folderPath) => ({ path: folderPath })),
    id: `top_${name}`,
    name,
  };
}

beforeEach(() => {
  world.missing = new Set();
  world.topics = [];
  world.tagged = [];
});

describe("folderReach", () => {
  it("gives the window the home and workspace folders alone", async () => {
    world.tagged = ["top_Trips"];
    world.topics = [topic("Trips", [elsewhere])];

    expect(
      Object.values(await folderReach(WINDOW_ID)).map((folder) => folder.path),
    ).toEqual([home, workspace]);
  });

  it("gives a chat that holds nothing the home and workspace folders", async () => {
    const folders = await folderReach(chatId, []);

    expect(
      Object.values(folders).map(({ access, path: folderPath }) => ({
        access,
        path: folderPath,
      })),
    ).toEqual([
      { access: "read-write", path: home },
      { access: "read-write", path: workspace },
    ]);
  });

  it("adds what the chat was sent, then its topics' folders that are still there", async () => {
    const recipes = path.resolve(path.sep, "Volumes", "Kitchen", "Recipes");
    const gone = path.resolve(path.sep, "Volumes", "Gone");
    world.topics = [topic("Cooking", [recipes, gone, elsewhere])];
    world.tagged = ["top_Cooking"];
    world.missing = new Set([gone]);

    const mounts = await reach(granted({ at: 1, path: elsewhere }));

    // The sent folder and the topic's copy of it are one mount.
    expect(mounts.slice(2)).toEqual([
      `Archive ${elsewhere}`,
      `Recipes ${recipes}`,
    ]);
  });

  // A topic's folder arrives after the folders already sent, so filing a
  // chat never moves a folder the agent is working in to another name.
  it("keeps a sent folder's name when a topic brings a namesake", async () => {
    const otherArchive = path.resolve(path.sep, "Volumes", "Old", "Archive");
    world.topics = [topic("History", [otherArchive])];
    world.tagged = ["top_History"];

    const mounts = await reach(granted({ at: 1, path: elsewhere }));

    expect(mounts.slice(2)).toEqual([
      `Archive ${elsewhere}`,
      `Old-Archive ${otherArchive}`,
    ]);
  });

  // A path the chat already used never moves: whichever was granted first
  // keeps the plain name, in whatever order the grants are listed, and only
  // the later namesake is qualified.
  it("qualifies only the later of two grants that share a name", async () => {
    const otherArchive = path.resolve(path.sep, "Volumes", "Old", "Archive");

    const before = await reach(granted({ at: 1, path: elsewhere }));
    const after = await reach(
      granted({ at: 2, path: otherArchive }, { at: 1, path: elsewhere }),
    );

    expect(before.slice(2)).toEqual([`Archive ${elsewhere}`]);
    expect(after.slice(2)).toEqual([
      `Archive ${elsewhere}`,
      `Old-Archive ${otherArchive}`,
    ]);
  });

  it("leaves a grant's name to a standing folder that holds it", async () => {
    const other = path.resolve(path.sep, "Volumes", "Work", "Instrument");

    const mounts = await reach(granted({ at: 1, path: other }));

    expect(mounts).toEqual([
      expect.stringContaining(home),
      `Instrument ${workspace}`,
      `Work-Instrument ${other}`,
    ]);
  });

  it("drops a topic's folders once the chat is no longer filed under it", async () => {
    world.topics = [topic("Cooking", [elsewhere])];
    world.tagged = [];

    expect(await reach([])).toHaveLength(2);
  });
});
