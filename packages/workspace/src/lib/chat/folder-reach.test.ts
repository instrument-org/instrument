import { ok } from "neverthrow";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { AbsolutePathSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { type ChatState } from "../../schemas/chat-state";
import { folderReach } from "./folder-reach";
import { type Topic } from "./topics";

const world = vi.hoisted(() => ({
  isChat: true,
  missing: new Set<string>(),
  tagged: [] as string[],
  topics: [] as Topic[],
}));

vi.mock(import("../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveChat: (id: string) =>
    world.isChat ? ChatIdSchema.parse(id) : undefined,
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

function held(
  ...folders: {
    access?: FolderAttachment.Access;
    createdAt: number;
    mountName?: string;
    path: string;
  }[]
): ChatState {
  return {
    browserTabs: [],
    attachedFolders: Object.fromEntries(
      folders.map((folder) => {
        const mountName = folder.mountName ?? path.basename(folder.path);
        return [
          mountName,
          {
            access: folder.access ?? "read-write",
            createdAt: folder.createdAt,
            id: FolderAttachment.IdSchema.parse(`held-${mountName}`),
            mountName,
            path: AbsolutePathSchema.parse(folder.path),
            source: "user",
          },
        ];
      }),
    ),
  };
}

/** Each mount the agent sees, by name, with the folder behind it. */
async function reach(state: ChatState) {
  const folders = await folderReach(chatId, state);
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
  world.isChat = true;
  world.missing = new Set();
  world.topics = [];
  world.tagged = [];
});

describe("folderReach", () => {
  it("is what a task was handed, and nothing more", async () => {
    world.isChat = false;

    expect(await reach(held({ createdAt: 1, path: elsewhere }))).toEqual([
      `Archive ${elsewhere}`,
    ]);
  });

  it("gives the window the home and workspace folders alone", async () => {
    world.isChat = false;
    world.tagged = ["top_Trips"];
    world.topics = [topic("Trips", [elsewhere])];

    expect(
      Object.values(await folderReach(WINDOW_ID)).map((folder) => folder.path),
    ).toEqual([home, workspace]);
  });

  it("gives a chat that holds nothing the home and workspace folders", async () => {
    const folders = await folderReach(chatId, { browserTabs: [] });

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

    const mounts = await reach(held({ createdAt: 1, path: elsewhere }));

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

    const mounts = await reach(held({ createdAt: 1, path: elsewhere }));

    expect(mounts.slice(2)).toEqual([
      `Archive ${elsewhere}`,
      `Old-Archive ${otherArchive}`,
    ]);
  });

  // The chat's messages name a sent folder by the name it arrived under.
  it("keeps the name a sent folder was given", async () => {
    const mounts = await reach(
      held({ createdAt: 1, mountName: "My archive", path: elsewhere }),
    );

    expect(mounts.slice(2)).toEqual([`My archive ${elsewhere}`]);
  });

  // An older chat may hold another folder under a standing folder's name;
  // its messages mean that folder by it.
  it("lets a folder on the record keep a name a standing folder would take", async () => {
    const mounts = await reach(
      held({ createdAt: 1, mountName: "Instrument", path: elsewhere }),
    );

    expect(mounts).toContain(`Instrument ${elsewhere}`);
    expect(mounts).toContain(`Instrument-2 ${workspace}`);
  });

  it("reaches a folder sent read-only to read and write", async () => {
    const folders = await folderReach(
      chatId,
      held({ access: "read-only", createdAt: 1, path: elsewhere }),
    );

    expect(folders.Archive?.access).toBe("read-write");
  });

  it("drops a topic's folders once the chat is no longer filed under it", async () => {
    world.topics = [topic("Cooking", [elsewhere])];
    world.tagged = [];

    expect(await reach({ browserTabs: [] })).toHaveLength(2);
  });
});
