import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { beginChatChangeTracking, consumeChatChanges } from "../chat-changes";
import { titlesToFollow } from "../chat-folders/follow-title";
import { ChatWrites } from "../chat-writes";
import { type ChatActivity } from "../chat/activity";
import { chatById, chatRecordTitle } from "../chat/chats";
import { undoChatChanges } from "../chat/organize";
import { createProject } from "../chat/projects";
import { createLocalBashEnv } from "../create-bash-env";
import { sessionOfChat } from "../record-folders";
import {
  beginSetupChangeTracking,
  consumeSetupChanges,
} from "../setup-changes";
import { withTurnContext } from "../turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

const running = vi.hoisted(() => {
  const value: ChatActivity["running"] = [];
  return { value };
});
const closedTabs = vi.hoisted(() => ({ value: [] as string[] }));

// Which tasks are at work is the machine's to say, so it is a dial here.
vi.mock(import("../chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: (chatId: ChatId) =>
    Promise.resolve({
      running: running.value.filter(
        (task) => task.chat === sessionOfChat(chatId),
      ),
    }),
}));
// No session has a live agent here.
vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: { sessionRefsByChatId: { get: () => [] } },
      }),
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));
// Closing a chat's tabs asks the window, which a test has none of.
vi.mock(import("../chat/tab-cap"), async (importOriginal) => ({
  ...(await importOriginal()),
  closeChatTabs: (chatId: ChatId) => {
    closedTabs.value.push(chatId);
    return Promise.resolve();
  },
}));

const at = (minute: number) => new Date(Date.UTC(2026, 8, 16, 12, minute));

let counter = 0;
const roots: string[] = [];
/** The chat whose agent runs the commands, and its session. */
let own: { chatId: ChatId; sessionId: StoreId.Session };

/** A chat with one message from the person, named by its folder. */
async function chat(name: string, title: string, minute: number) {
  // Each chat's stamps are its minute's, so the list's order and days hold.
  vi.useFakeTimers({ now: at(minute), toFake: ["Date"] });
  const sessionId = StoreId.newSessionId();
  const chatId = await chatFor(sessionId, ChatIdSchema.parse(name), {
    createdAt: at(minute),
  });
  await ChatWrites.saveSession(
    { createdAt: at(minute), id: sessionId, title, updatedAt: at(minute) },
    chatId,
  );
  const messageId = StoreId.newMessageId();
  const saved = await ChatWrites.saveMessageWithParts(
    {
      metadata: { createdAt: at(minute), sessionId },
      id: messageId,
      parts: [
        {
          metadata: {
            createdAt: at(minute),
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text: `about ${name}`,
          type: "text",
        },
      ],
      role: "user",
    },
    chatId,
  );
  expect(saved.isOk()).toBe(true);
  return { chatId, sessionId };
}

beforeEach(async () => {
  running.value = [];
  closedTabs.value = [];
  titlesToFollow.clear();
  createMockChatConfig(
    ChatIdSchema.parse(`chats-command-${Date.now()}-${(counter += 1)}`),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chats-command-"));
  roots.push(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  await chat("lisbon", "Trip to Lisbon", 1);
  await chat("porto", "Untitled chat 2", 2);
  await chat("groceries", "Groceries for the week", 3);
  own = await chat("organizer", "Tidy up my chats", 9);
});

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

/** Runs commands in the organizer's shell as one turn, and answers what the turn changed. */
async function turn(...commands: string[]) {
  const key = { id: own.chatId, sessionId: own.sessionId };
  beginSetupChangeTracking(key);
  beginChatChangeTracking(key);
  const bash = await createLocalBashEnv({ ...own, role: "chat" });
  const results = [];
  for (const command of commands) {
    results.push(await withTurnContext(key, () => bash.exec(command)));
  }
  const changes = consumeChatChanges(key);
  await consumeSetupChanges(key);
  return { changes, results };
}

async function one(command: string) {
  const { changes, results } = await turn(command);
  const [result] = results;
  return {
    changes,
    exitCode: result?.exitCode,
    stderr: result?.stderr,
    stdout: result?.stdout,
  };
}

describe("instrument chats list", () => {
  it("lists the chats newest first, each by id, day, project and title", async () => {
    const travel = await createProject({ name: "Travel" });
    await one(`instrument chats project Travel lisbon`);
    expect(travel.name).toBe("Travel");
    expect((await one("instrument chats list")).stdout).toMatchInlineSnapshot(
      `
      "4 chats, newest first (id, began, last active, title):
        organizer  2026-09-16  2026-09-16  Tidy up my chats  (this chat)
        groceries  2026-09-16  2026-09-16  Groceries for the week
        porto  2026-09-16  2026-09-16  about porto  (unnamed)
        lisbon  2026-09-16  2026-09-16  [Travel]  Trip to Lisbon
      "
    `,
    );
  });

  it("narrows to a project, to the archived, and to the unnamed", async () => {
    await createProject({ name: "Travel" });
    await turn(
      "instrument chats project travel lisbon porto",
      "instrument chats archive groceries",
    );
    expect((await one("instrument chats list --project Travel")).stdout)
      .toMatchInlineSnapshot(`
        "2 chats, newest first (id, began, last active, title):
          porto  2026-09-16  2026-09-16  [Travel]  about porto  (unnamed)
          lisbon  2026-09-16  2026-09-16  [Travel]  Trip to Lisbon
        "
      `);
    expect((await one("instrument chats list --archived")).stdout)
      .toMatchInlineSnapshot(`
        "1 chat, newest first (id, began, last active, title):
          groceries  2026-09-16  2026-09-16  Groceries for the week
        "
      `);
    expect((await one("instrument chats list --unnamed")).stdout)
      .toMatchInlineSnapshot(`
        "1 chat, newest first (id, began, last active, title):
          porto  2026-09-16  2026-09-16  [Travel]  about porto  (unnamed)
        "
      `);
    expect((await one("instrument chats list --project none")).stdout)
      .toMatchInlineSnapshot(`
        "1 chat, newest first (id, began, last active, title):
          organizer  2026-09-16  2026-09-16  Tidy up my chats  (this chat)
        "
      `);
  });

  it("names the projects when asked for one that is not there", async () => {
    await createProject({ name: "Travel" });
    expect((await one("instrument chats list --project Trips")).stderr)
      .toMatchInlineSnapshot(`
      "instrument chats: no project named "Trips". The projects: Travel.
      "
    `);
  });
});

describe("instrument projects", () => {
  it("names each project in use", async () => {
    const travel = await createProject({ name: "Travel" });
    expect((await one("instrument projects")).stdout).toBe(
      `  Travel  ${travel.id}\n`,
    );
  });

  it("says so when there are none", async () => {
    expect((await one("instrument projects")).stdout).toMatchInlineSnapshot(`
      "There are no projects yet.
      "
    `);
  });
});

describe("instrument chats rename", () => {
  it("names a chat and records the title it had", async () => {
    const renamed = await one("instrument chats rename porto A week in Porto");
    expect(renamed.stdout).toMatchInlineSnapshot(`
      "Renamed porto: A week in Porto
      "
    `);
    expect((await chatById(ChatIdSchema.parse("porto")))?.title).toBe(
      "A week in Porto",
    );
    expect(renamed.changes).toMatchInlineSnapshot(`
      [
        {
          "after": "A week in Porto",
          "before": "Untitled chat 2",
          "chat": "porto",
          "field": "title",
        },
      ]
    `);
  });

  it("leaves a working chat's folder until its turn ends", async () => {
    running.value = [
      {
        chat: own.sessionId,
        sessionId: StoreId.newSessionId(),
        title: "A task",
        updatedAt: at(9).getTime(),
      },
    ];
    await one("instrument chats rename organizer Tidying");
    expect(titlesToFollow.has(own.chatId)).toBe(true);

    await one("instrument chats rename lisbon Lisbon in October");
    expect(titlesToFollow.has(ChatIdSchema.parse("lisbon"))).toBe(false);
  });

  it("refuses an id that is no chat's", async () => {
    const refused = await one("instrument chats rename nowhere A name");
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatchInlineSnapshot(`
      "instrument chats: no chat with the id nowhere. instrument chats list names them.
      "
    `);
    expect(refused.changes).toEqual([]);
  });
});

describe("instrument chats archive and unarchive", () => {
  it("puts chats away, closing their tabs, and brings them back", async () => {
    const archived = await one("instrument chats archive lisbon porto nowhere");
    expect(archived.exitCode).toBe(1);
    expect(archived.stdout).toMatchInlineSnapshot(`
      "Archived lisbon: Trip to Lisbon
      Archived porto: about porto
      "
    `);
    expect(archived.stderr).toMatchInlineSnapshot(`
      "instrument chats: no chat with the id nowhere. instrument chats list names them.
      "
    `);
    expect(closedTabs.value).toEqual(["lisbon", "porto"]);
    expect(archived.changes).toMatchInlineSnapshot(`
      [
        {
          "after": true,
          "before": false,
          "chat": "lisbon",
          "field": "archived",
        },
        {
          "after": true,
          "before": false,
          "chat": "porto",
          "field": "archived",
        },
      ]
    `);

    const back = await one("instrument chats unarchive lisbon groceries");
    expect(back.stdout).toMatchInlineSnapshot(`
      "Unarchived lisbon: Trip to Lisbon
      groceries was not archived: Groceries for the week
      "
    `);
    expect((await chatById(ChatIdSchema.parse("lisbon")))?.archived).toBe(
      false,
    );
    expect(back.changes).toHaveLength(1);
  });

  it("records nothing for a mark set and taken back in one turn", async () => {
    const { changes } = await turn(
      "instrument chats archive lisbon",
      "instrument chats unarchive lisbon",
    );
    expect(changes).toEqual([]);
  });
});

describe("instrument chats star and unstar", () => {
  it("stars chats and takes the star off", async () => {
    const starred = await one("instrument chats star lisbon");
    expect(starred.stdout).toMatchInlineSnapshot(`
      "Starred lisbon: Trip to Lisbon
      "
    `);
    expect((await chatById(ChatIdSchema.parse("lisbon")))?.starred).toBe(true);
    expect(starred.changes).toMatchInlineSnapshot(`
      [
        {
          "after": true,
          "before": false,
          "chat": "lisbon",
          "field": "starred",
        },
      ]
    `);

    const unstarred = await one("instrument chats unstar lisbon");
    expect(unstarred.stdout).toMatchInlineSnapshot(`
      "Unstarred lisbon: Trip to Lisbon
      "
    `);
    expect((await chatById(ChatIdSchema.parse("lisbon")))?.starred).toBe(false);
  });
});

describe("instrument chats project", () => {
  it("files chats under a project by name, and under none", async () => {
    const travel = await createProject({ name: "Travel" });
    const filed = await one("instrument chats project travel lisbon porto");
    expect(filed.stdout).toMatchInlineSnapshot(`
      "Filed lisbon under Travel: Trip to Lisbon
      Filed porto under Travel: about porto
      "
    `);
    expect((await chatById(ChatIdSchema.parse("porto")))?.project).toBe(
      travel.id,
    );
    expect(filed.changes).toEqual([
      { after: travel.id, before: null, chat: "lisbon", field: "project" },
      { after: travel.id, before: null, chat: "porto", field: "project" },
    ]);

    const out = await one("instrument chats project none lisbon");
    expect(out.stdout).toMatchInlineSnapshot(`
      "Filed lisbon under no project: Trip to Lisbon
      "
    `);
    expect(out.changes).toEqual([
      { after: null, before: travel.id, chat: "lisbon", field: "project" },
    ]);
  });

  it("refuses a project the workspace does not have, with the list", async () => {
    await createProject({ name: "Travel" });
    const refused = await one("instrument chats project Trips lisbon");
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatchInlineSnapshot(`
      "instrument chats: project: no project named "Trips", so nothing was filed. The projects: Travel.
      "
    `);
    expect(
      (await chatById(ChatIdSchema.parse("lisbon")))?.project,
    ).toBeUndefined();
  });
});

describe("a task's instrument chats", () => {
  it("is refused, with what to do instead", async () => {
    const bash = await createLocalBashEnv({
      chatId: own.chatId,
      role: "task",
      sessionId: StoreId.newSessionId(),
    });
    const refused = await bash.exec("instrument chats archive lisbon");
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatchInlineSnapshot(`
      "instrument chats: only the chat organizes the user's chats. Say in your report what the chat should rename, archive, file or star.
      "
    `);
    expect((await chatById(ChatIdSchema.parse("lisbon")))?.archived).toBe(
      false,
    );
  });
});

describe("undoChatChanges", () => {
  it("sets each field back to what it held before", async () => {
    await createProject({ name: "Travel" });
    const { changes } = await turn(
      "instrument chats rename porto A week in Porto",
      "instrument chats archive groceries",
      "instrument chats star lisbon",
      "instrument chats project Travel lisbon",
    );
    expect(await undoChatChanges(changes)).toEqual({ skipped: 0, undone: 4 });

    const porto = ChatIdSchema.parse("porto");
    expect(await chatRecordTitle(porto)).toBe("Untitled chat 2");
    expect((await chatById(ChatIdSchema.parse("groceries")))?.archived).toBe(
      false,
    );
    const lisbon = await chatById(ChatIdSchema.parse("lisbon"));
    expect(lisbon?.starred).toBe(false);
    expect(lisbon?.project).toBeUndefined();
  });

  it("skips a field changed since", async () => {
    const { changes } = await turn(
      "instrument chats rename porto A week in Porto",
      "instrument chats archive groceries lisbon",
    );
    // The person renames one and brings another back.
    await turn(
      "instrument chats rename porto Porto, in the end",
      "instrument chats unarchive groceries",
    );
    expect(await undoChatChanges(changes)).toEqual({ skipped: 2, undone: 1 });
    expect(await chatRecordTitle(ChatIdSchema.parse("porto"))).toBe(
      "Porto, in the end",
    );
    expect((await chatById(ChatIdSchema.parse("groceries")))?.archived).toBe(
      false,
    );
    expect((await chatById(ChatIdSchema.parse("lisbon")))?.archived).toBe(
      false,
    );
  });
});
