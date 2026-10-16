import { okAsync } from "neverthrow";
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
  places: {} as Record<string, "allow" | "ask" | "never">,
  tagged: [] as string[],
  topics: [] as Topic[],
}));

vi.mock(import("../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionOfChat: () => StoreId.newSessionId(),
}));
vi.mock(import("../chat-reads"), () => ({
  ChatReads: {
    session: () => okAsync({ topics: world.tagged } as never),
  } as never,
}));
vi.mock(import("./topics"), () => ({
  listTopics: () => Promise.resolve(world.topics),
}));
vi.mock(import("../permissions/rules"), async (importOriginal) => ({
  ...(await importOriginal()),
  readPermissionSettings: () =>
    Promise.resolve({
      apps: [],
      chats: {},
      folders: [],
      places: world.places,
      dangerouslyAllowEveryFolder: false,
    }),
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

/** The folders the chat reaches, in order. */
async function reach(grants: ChatGrant[]) {
  const folders = await folderReach(chatId, grants);
  return Object.entries(folders).map(([key, folder]) => {
    expect(key).toBe(folder.path);
    return folder.path;
  });
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
  world.places = {};
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

    // The sent folder and the topic's copy of it are one folder.
    expect(mounts.slice(2)).toEqual([elsewhere, recipes]);
  });

  // A topic's folder arrives after the folders already sent.
  it("puts a topic's folder after the folders sent, namesakes included", async () => {
    const otherArchive = path.resolve(path.sep, "Volumes", "Old", "Archive");
    world.topics = [topic("History", [otherArchive])];
    world.tagged = ["top_History"];

    const mounts = await reach(granted({ at: 1, path: elsewhere }));

    expect(mounts.slice(2)).toEqual([elsewhere, otherArchive]);
  });

  it("orders grants by when each was granted, whatever order they are listed in", async () => {
    const otherArchive = path.resolve(path.sep, "Volumes", "Old", "Archive");

    const after = await reach(
      granted({ at: 2, path: otherArchive }, { at: 1, path: elsewhere }),
    );

    expect(after.slice(2)).toEqual([elsewhere, otherArchive]);
  });

  it("reaches a grant beside the standing folders", async () => {
    const other = path.resolve(path.sep, "Volumes", "Work", "Instrument");

    const mounts = await reach(granted({ at: 1, path: other }));

    expect(mounts).toEqual([home, workspace, other]);
  });

  it("reaches the folders of a place of work set to Allowed, and no other place's", async () => {
    world.places = {
      appFiles: "allow",
      documents: "allow",
      passwords: "allow",
    };

    expect(await reach([])).toEqual([
      home,
      workspace,
      path.join(home, "Documents"),
    ]);
  });

  it("drops a topic's folders once the chat is no longer filed under it", async () => {
    world.topics = [topic("Cooking", [elsewhere])];
    world.tagged = [];

    expect(await reach([])).toHaveLength(2);
  });
});
