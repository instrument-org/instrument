import { errAsync } from "neverthrow";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { beginChatChangeTracking, consumeChatChanges } from "../chat-changes";
import { ChatWrites } from "../chat-writes";
import { type ChatActivity } from "../chat/activity";
import { chatById, chatRecordTitle, markChatUnread } from "../chat/chats";
import { recordAsk } from "../chat/asks";
import { openAsks } from "../chat/open-asks";
import { undoChatChanges } from "../chat/organize";
import { createProject } from "../chat/projects";
import { createLocalBashEnv } from "../create-bash-env";
import { TypedError } from "../errors";
import { sessionOfChat } from "../record-folders";
import {
  beginSetupChangeTracking,
  consumeSetupChanges,
} from "../setup-changes";
import { withTurnContext } from "../turn-context";
import { shellPath } from "../shell-path";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

const running = vi.hoisted(() => {
  const value: ChatActivity["running"] = [];
  return { value };
});
/** What reached the workspace machine; a stop ends the work it names. */
const sent = vi.hoisted(() => ({ value: [] as unknown[] }));
const closedTabs = vi.hoisted(() => ({ value: [] as string[] }));
/** How many tabs each chat's close closes. */
const tabsOf = vi.hoisted(() => ({ value: new Map<string, number>() }));

// Which tasks are at work is the machine's to say, so it is a dial here.
vi.mock(import("../chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: (chatId: ChatId) =>
    running.value.some((task) => task.chat === sessionOfChat(chatId)),
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
      send: (event: { value: { id: ChatId } }) => {
        sent.value.push(event);
        running.value = running.value.filter(
          (task) => task.chat !== sessionOfChat(event.value.id),
        );
      },
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));
// Closing a chat's tabs asks the window, which a test has none of.
vi.mock(import("../chat/tab-cap"), async (importOriginal) => ({
  ...(await importOriginal()),
  closeChatTabs: (chatId: ChatId) => {
    closedTabs.value.push(chatId);
    return {
      closed: Promise.resolve(tabsOf.value.get(chatId) ?? 0),
      done: Promise.resolve(),
    };
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

/** The agent's words in a chat, after the person's. */
async function reply(chatId: ChatId, text: string) {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    throw new Error(`no session of ${chatId}`);
  }
  const messageId = StoreId.newMessageId();
  const saved = await ChatWrites.saveMessageWithParts(
    {
      metadata: {
        createdAt: at(4),
        finishReason: "stop",
        finishedAt: at(4),
        modelId: "maker/model",
        providerId: "test",
        sessionId,
      },
      id: messageId,
      parts: [
        {
          metadata: {
            createdAt: at(4),
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text,
          type: "text",
        },
      ],
      role: "assistant",
    },
    chatId,
  );
  expect(saved.isOk()).toBe(true);
}

beforeEach(async () => {
  running.value = [];
  closedTabs.value = [];
  tabsOf.value = new Map();
  sent.value = [];
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
      "4 chats, newest first (id, began, last active, title, where it stands, latest line):
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
        "2 chats, newest first (id, began, last active, title, where it stands, latest line):
          porto  2026-09-16  2026-09-16  [Travel]  about porto  (unnamed)
          lisbon  2026-09-16  2026-09-16  [Travel]  Trip to Lisbon
        "
      `);
    expect((await one("instrument chats list --archived")).stdout)
      .toMatchInlineSnapshot(`
        "1 chat, newest first (id, began, last active, title, where it stands, latest line):
          groceries  2026-09-16  2026-09-16  Groceries for the week
        "
      `);
    expect((await one("instrument chats list --unnamed")).stdout)
      .toMatchInlineSnapshot(`
        "1 chat, newest first (id, began, last active, title, where it stands, latest line):
          porto  2026-09-16  2026-09-16  [Travel]  about porto  (unnamed)
        "
      `);
    expect((await one("instrument chats list --project none")).stdout)
      .toMatchInlineSnapshot(`
        "1 chat, newest first (id, began, last active, title, where it stands, latest line):
          organizer  2026-09-16  2026-09-16  Tidy up my chats  (this chat)
        "
      `);
  });

  it("says which are unread, waiting or working, with the line each row shows", async () => {
    const lisbon = ChatIdSchema.parse("lisbon");
    const groceries = ChatIdSchema.parse("groceries");
    await reply(lisbon, "The castle **first**, then Belém.\n\nBook ahead.");
    await markChatUnread(lisbon, { byUser: false });
    running.value = [
      {
        chat: sessionOfChat(groceries),
        sessionId: StoreId.newSessionId(),
        step: "Comparing prices",
        title: "Find the cheapest store",
        updatedAt: at(4).getTime(),
      },
    ];
    const porto = ChatIdSchema.parse("porto");
    const portoSession = sessionOfChat(porto);
    if (!portoSession) {
      throw new Error("no session of porto");
    }
    vi.setSystemTime(at(5));
    await recordAsk(
      {
        chatId: porto,
        reason: "The timetable needs your account.",
        sessionId: portoSession,
        title: "Log in to the railway",
      },
      "page",
      "tab_1",
      { page: { title: "Railway", url: "https://rail.example.com/" } },
    );
    expect((await one("instrument chats list")).stdout).toMatchInlineSnapshot(`
        "4 chats, newest first (id, began, last active, title, where it stands, latest line):
          lisbon  2026-09-16  2026-09-16  Trip to Lisbon  (unread)  latest: The castle first, then Belém.
          organizer  2026-09-16  2026-09-16  Tidy up my chats  (this chat)
          porto  2026-09-16  2026-09-16  about porto  (unnamed)  (waiting on the user)  latest: Log in to the railway
          groceries  2026-09-16  2026-09-16  Groceries for the week  (working)  latest: Comparing prices
        "
      `);
    expect((await one("instrument chats list --unread")).stdout)
      .toMatchInlineSnapshot(`
        "1 chat, newest first (id, began, last active, title, where it stands, latest line):
          lisbon  2026-09-16  2026-09-16  Trip to Lisbon  (unread)  latest: The castle first, then Belém.
        "
      `);
    expect((await one("instrument chats list --working --waiting")).stdout)
      .toMatchInlineSnapshot(`
        "2 chats, newest first (id, began, last active, title, where it stands, latest line):
          porto  2026-09-16  2026-09-16  about porto  (unnamed)  (waiting on the user)  latest: Log in to the railway
          groceries  2026-09-16  2026-09-16  Groceries for the week  (working)  latest: Comparing prices
        "
      `);
    const listed = z
      .array(z.record(z.string(), z.unknown()))
      .parse(
        JSON.parse((await one("instrument chats list --json")).stdout ?? ""),
      );
    expect(listed.find((each) => each["id"] === "lisbon"))
      .toMatchInlineSnapshot(`
        {
          "archived": false,
          "began": "2026-09-16",
          "id": "lisbon",
          "last_activity": "2026-09-16",
          "latest": "The castle first, then Belém.",
          "named": true,
          "starred": false,
          "status": "idle",
          "title": "Trip to Lisbon",
          "unread": true,
          "working": false,
        }
      `);
    expect(listed.find((each) => each["id"] === "groceries"))
      .toMatchInlineSnapshot(`
        {
          "archived": false,
          "began": "2026-09-16",
          "id": "groceries",
          "last_activity": "2026-09-16",
          "latest": "Comparing prices",
          "named": true,
          "starred": false,
          "status": "working",
          "title": "Groceries for the week",
          "unread": false,
          "working": true,
        }
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

  it("stops what it archives as the person's Archive does, and never its own chat", async () => {
    running.value = [
      {
        chat: sessionOfChat(ChatIdSchema.parse("lisbon")),
        sessionId: StoreId.newSessionId(),
        title: "A task",
        updatedAt: 0,
      },
    ];
    const archived = await one(
      "instrument chats archive lisbon groceries organizer",
    );
    expect(archived.stdout).toMatchInlineSnapshot(`
      "Archived lisbon: Trip to Lisbon (its turn and tasks stopped)
      Archived groceries: Groceries for the week
      "
    `);
    expect(archived.stderr).toMatchInlineSnapshot(`
      "instrument chats: archive: organizer is this chat, which archiving would stop mid-turn; the user archives it.
      "
    `);
    expect(sent.value).toMatchInlineSnapshot(`
      [
        {
          "type": "stopSessions",
          "value": {
            "id": "lisbon",
            "notice": {
              "by": "person",
              "wakesChat": true,
            },
          },
        },
      ]
    `);
    expect((await chatById(ChatIdSchema.parse("organizer")))?.archived).toBe(
      false,
    );
  });

  it("says what archiving stopped and closed", async () => {
    running.value = [
      {
        chat: sessionOfChat(ChatIdSchema.parse("lisbon")),
        sessionId: StoreId.newSessionId(),
        title: "A task",
        updatedAt: 0,
      },
    ];
    const porto = ChatIdSchema.parse("porto");
    const portoSession = sessionOfChat(porto);
    if (!portoSession) {
      throw new Error("porto has no session");
    }
    await recordAsk(
      {
        chatId: porto,
        reason: "The timetable needs your account.",
        sessionId: portoSession,
        title: "Log in to the railway",
      },
      "page",
      "tab_1",
      { page: { title: "Railway", url: "https://rail.example.com/" } },
    );
    tabsOf.value.set("lisbon", 3);
    tabsOf.value.set("groceries", 1);
    const archived = await one(
      "instrument chats archive lisbon porto groceries",
    );
    expect(archived.stdout).toMatchInlineSnapshot(`
      "Archived lisbon: Trip to Lisbon (its turn and tasks stopped, 3 tabs closed)
      Archived porto: about porto (its open question closed)
      Archived groceries: Groceries for the week (1 tab closed)
      "
    `);
  });

  it("fails the line of a chat that could not be changed and goes on to the rest", async () => {
    const saveSession = ChatWrites.saveSession.bind(ChatWrites);
    const spy = vi
      .spyOn(ChatWrites, "saveSession")
      .mockImplementation((session, chatId, startedAs) =>
        chatId === "porto"
          ? errAsync(new TypedError.Storage("The disk is full"))
          : saveSession(session, chatId, startedAs),
      );
    const archived = await one(
      "instrument chats archive lisbon porto groceries",
    );
    spy.mockRestore();

    expect(archived.exitCode).toBe(1);
    expect(archived.stdout).toMatchInlineSnapshot(`
      "Archived lisbon: Trip to Lisbon
      Archived groceries: Groceries for the week
      "
    `);
    expect(archived.stderr).toMatchInlineSnapshot(`
      "instrument chats: archive: porto could not be changed.
      "
    `);
    const marks = await Promise.all(
      ["lisbon", "porto", "groceries"].map(
        async (id) => (await chatById(ChatIdSchema.parse(id)))?.archived,
      ),
    );
    expect(marks).toEqual([true, false, true]);
    expect(archived.changes.map((change) => change.chat)).toEqual([
      "lisbon",
      "groceries",
    ]);
  });

  it("records nothing for a mark set and taken back in one turn", async () => {
    const { changes } = await turn(
      "instrument chats archive lisbon",
      "instrument chats unarchive lisbon",
    );
    expect(changes).toEqual([]);
  });
});

describe("instrument chats mark-read and mark-unread", () => {
  it("marks every unread chat as read in one call, and the ones named as unread", async () => {
    const lisbon = ChatIdSchema.parse("lisbon");
    const porto = ChatIdSchema.parse("porto");
    await markChatUnread(lisbon, { byUser: false });
    await markChatUnread(porto, { byUser: true });
    const { changes, results } = await turn(
      "instrument chats mark-read --all",
      "instrument chats mark-unread groceries",
    );
    expect(results.map((result) => result.stdout).join(""))
      .toMatchInlineSnapshot(`
        "Marked as read lisbon: Trip to Lisbon
        Marked as read porto: about porto
        Marked as unread groceries: Groceries for the week
        "
      `);
    expect(changes).toMatchInlineSnapshot(`
      [
        {
          "after": false,
          "before": true,
          "chat": "lisbon",
          "field": "unread",
        },
        {
          "after": false,
          "before": true,
          "chat": "porto",
          "field": "unread",
        },
        {
          "after": true,
          "before": false,
          "chat": "groceries",
          "field": "unread",
        },
      ]
    `);
    expect((await chatById(lisbon))?.unread).toBe(false);
    const groceries = await chatById(ChatIdSchema.parse("groceries"));
    expect(groceries?.unread).toBe(true);
    expect(groceries?.unreadByUser).toBe(true);
    expect((await one("instrument chats mark-read --all")).stdout).toContain(
      "groceries",
    );
    expect(await undoChatChanges(changes)).toEqual({ skipped: 1, undone: 2 });
    expect((await chatById(lisbon))?.unread).toBe(true);
  });

  it("asks which chats, and takes no ids with --all", async () => {
    expect((await one("instrument chats mark-read")).stderr)
      .toMatchInlineSnapshot(`
        "instrument chats: which chats? instrument chats list names them.
        "
      `);
    expect((await one("instrument chats mark-read --all lisbon")).stderr)
      .toMatchInlineSnapshot(`
        "instrument chats: --all takes every chat, so give no ids with it.
        "
      `);
    expect((await one("instrument chats mark-read --all")).stdout)
      .toMatchInlineSnapshot(`
        "No chat to change.
        "
      `);
  });
});

describe("instrument chats stop", () => {
  it("stops the working chats named as the person's Stop does, and never its own", async () => {
    const taskOf = (name: string) => ({
      chat: sessionOfChat(ChatIdSchema.parse(name)),
      sessionId: StoreId.newSessionId(),
      title: "A task",
      updatedAt: 0,
    });
    running.value = [taskOf("lisbon"), taskOf("porto"), taskOf("organizer")];
    const stop = await one(
      "instrument chats stop lisbon groceries organizer nowhere",
    );
    expect(stop.exitCode).toBe(1);
    expect(stop.stdout).toMatchInlineSnapshot(`
      "Stopped lisbon: Trip to Lisbon
      groceries was not working or waiting on the user: Groceries for the week
      "
    `);
    expect(stop.stderr).toMatchInlineSnapshot(`
      "instrument chats: stop: organizer is this chat; ending your turn ends it, and \`instrument task stop\` a task of yours.
      instrument chats: no chat with the id nowhere. instrument chats list names them.
      "
    `);
    expect(sent.value).toMatchInlineSnapshot(`
      [
        {
          "type": "stopSessions",
          "value": {
            "id": "lisbon",
            "notice": {
              "by": "person",
              "wakesChat": true,
            },
          },
        },
      ]
    `);
    expect((await chatById(ChatIdSchema.parse("porto")))?.working).toBe(true);
    expect(stop.changes).toEqual([]);
  });
});

describe("instrument chats stop on a card", () => {
  it("stops a chat waiting on the user's answer, as their own Stop does", async () => {
    const porto = ChatIdSchema.parse("porto");
    const portoSession = sessionOfChat(porto);
    if (!portoSession) {
      throw new Error("porto has no session");
    }
    await recordAsk(
      {
        chatId: porto,
        reason: "The timetable needs your account.",
        sessionId: portoSession,
        title: "Log in to the railway",
      },
      "page",
      "tab_1",
      { page: { title: "Railway", url: "https://rail.example.com/" } },
    );
    const stop = await one("instrument chats stop porto");
    expect(stop.stdout).toMatchInlineSnapshot(`
      "Stopped porto: about porto
      "
    `);
    expect(await openAsks(porto)).toEqual([]);
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

  it("tells the chat filing itself where its project's folder is and how its instructions begin", async () => {
    await createProject({
      instructions: "Prices in euros.\nOne\nTwo\nThree\nFour\nFive",
      name: "Travel",
    });
    await createProject({ name: "Work" });
    const travel = await one("instrument chats project travel organizer");
    expect(
      travel.stdout?.replaceAll(
        shellPath(getWorkspaceConfig().rootDir),
        "<workspace>",
      ),
    ).toMatchInlineSnapshot(`
      "Filed organizer under Travel: Tidy up my chats
      This chat's project folder is <workspace>/Projects/Travel/, $INSTRUMENT_PROJECT from your next command. Its AGENTS.md, which every chat under it follows, begins:
      Prices in euros.
      One
      Two
      Three
      Four
      [The rest is in <workspace>/Projects/Travel/AGENTS.md.]
      "
    `);
    const work = await one("instrument chats project work organizer lisbon");
    expect(
      work.stdout?.replaceAll(
        shellPath(getWorkspaceConfig().rootDir),
        "<workspace>",
      ),
    ).toMatchInlineSnapshot(`
      "Filed organizer under Work: Tidy up my chats
      This chat's project folder is <workspace>/Projects/Work/, $INSTRUMENT_PROJECT from your next command. It has no AGENTS.md.
      Filed lisbon under Work: Trip to Lisbon
      "
    `);
  });

  it("tells the chat filing itself which folders are granted under the project", async () => {
    const taxDocs = fs.mkdtempSync(path.join(os.tmpdir(), "tax-docs-"));
    await createProject({
      folders: [{ path: taxDocs }, { path: path.join(taxDocs, "gone") }],
      name: "Taxes",
    });
    const filed = await one("instrument chats project taxes organizer");
    expect(
      filed.stdout
        ?.replaceAll(shellPath(getWorkspaceConfig().rootDir), "<workspace>")
        .replaceAll(shellPath(taxDocs), "<tax-docs>"),
    ).toMatchInlineSnapshot(`
      "Filed organizer under Taxes: Tidy up my chats
      This chat's project folder is <workspace>/Projects/Taxes/, $INSTRUMENT_PROJECT from your next command. It has no AGENTS.md.
      Folders granted under it, open to you from your next command: <tax-docs>.
      "
    `);
    fs.rmSync(taxDocs, { force: true, recursive: true });
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
      "instrument chats: only the chat organizes the user's chats. Say in your report what the chat should rename, archive, file, bookmark, mark read or stop.
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
      "instrument chats project Travel lisbon",
    );
    expect(await undoChatChanges(changes)).toEqual({ skipped: 0, undone: 3 });

    const porto = ChatIdSchema.parse("porto");
    expect(await chatRecordTitle(porto)).toBe("Untitled chat 2");
    expect((await chatById(ChatIdSchema.parse("groceries")))?.archived).toBe(
      false,
    );
    const lisbon = await chatById(ChatIdSchema.parse("lisbon"));
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
