import { afterEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { actionsModelNote } from "../actions-model-text";
import { ChatWrites } from "../chat-writes";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { actionsNoteRows, createActionsPart } from "./actions-part";
import {
  forgetRecordedActions,
  type RecordedAction,
  recordActions,
} from "../../test/helpers/recorded-actions";
import { type Action } from "./schema";

const MIN = 60_000;
const SENT = new Date("2026-11-05T20:30:00Z");
const chatId = ChatIdSchema.parse("actions-part");

/** Any action without its time. */
type Untimed = Action extends infer A
  ? A extends { at: string }
    ? Omit<A, "at">
    : never
  : never;

/** An action as a reader gives it back, `minutes` before the message. */
function at(minutes: number, input: Untimed): Action {
  return {
    ...input,
    at: new Date(SENT.getTime() - minutes * MIN).toISOString(),
  };
}

describe("actionsNoteRows", () => {
  it("merges a run of one kind into a count, at the newest one's minutes", () => {
    expect(
      actionsNoteRows(
        [
          at(12, { kind: "folder", path: "/Users/mac-user/Downloads" }),
          at(9, { kind: "file", path: "/Users/mac-user/a.txt" }),
          at(8, { kind: "file", path: "/Users/mac-user/b.txt" }),
          at(7.5, { kind: "file", path: "/Users/mac-user/c.txt" }),
          at(6, {
            from: "/Users/mac-user/Downloads",
            kind: "move",
            names: ["a.pdf", "b.pdf"],
            to: "/Users/mac-user/Archive",
          }),
          at(5, {
            from: "/Users/mac-user/Downloads",
            kind: "move",
            names: ["c.pdf"],
            to: "/Users/mac-user/Archive",
          }),
          at(0.5, { kind: "trash", paths: ["/Users/mac-user/old.txt"] }),
        ],
        { chatId, sentAt: SENT },
      ),
    ).toEqual([
      { count: 1, kind: "folder", minutes: 12 },
      { count: 3, kind: "file", minutes: 7 },
      { count: 3, kind: "move", minutes: 5 },
      { count: 1, kind: "trash", minutes: 0 },
    ]);
  });

  it("leaves out what a cap dropped and reading this very chat", () => {
    expect(
      actionsNoteRows(
        [
          at(9, { kind: "file", path: "/Users/mac-user/a.txt" }),
          at(8, { id: chatId, kind: "chat", title: "This one" }),
          at(7, { dropped: 12, kind: "capped", of: "file" }),
          at(6, { kind: "file", path: "/Users/mac-user/b.txt" }),
          at(5, { id: "another", kind: "chat", title: "Kitchen" }),
        ],
        { chatId, sentAt: SENT },
      ),
    ).toEqual([
      { count: 2, kind: "file", minutes: 6 },
      { count: 1, kind: "chat", minutes: 5 },
    ]);
  });

  it("says what was done with an app or a permission as the row's kind", () => {
    const permission = {
      id: "kitchen",
      kind: "permission" as const,
      title: "Kitchen remodel quotes",
    };
    expect(
      actionsNoteRows(
        [
          at(9, { did: "signed in", kind: "app", name: "Gmail" }),
          at(8, { did: "sign-in failed", kind: "app", name: "Linear" }),
          at(7, { did: "disconnected", kind: "app", name: "Gmail" }),
          at(6, { from: "2.0.13", kind: "update", to: "2.0.14" }),
          at(5, {
            ...permission,
            did: "allowed",
            path: "/Users/mac-user/Downloads",
          }),
          at(4, {
            ...permission,
            did: "allowed",
            path: "/Users/mac-user/Documents",
          }),
          at(3, { ...permission, app: "Mail", did: "allowed" }),
          at(2, { ...permission, did: "refused", path: "/Users/mac-user" }),
          at(1, { ...permission, app: "Music", did: "refused" }),
        ],
        { chatId, sentAt: SENT },
      ).map((row) => `${row.kind} ×${row.count}`),
    ).toEqual([
      "app-signed-in ×1",
      "app-sign-in-failed ×1",
      "app-disconnected ×1",
      "update ×1",
      "permission-allowed-folder ×2",
      "permission-allowed-app ×1",
      "permission-refused-folder ×1",
      "permission-refused-app ×1",
    ]);
  });

  it("keeps the newest 8 rows", () => {
    const rows = actionsNoteRows(
      Array.from({ length: 12 }, (_, index) =>
        index % 2 === 0
          ? at(20 - index, { kind: "file", path: `/f${index}` })
          : at(20 - index, { kind: "folder", path: `/d${index}` }),
      ),
      { chatId, sentAt: SENT },
    );
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual({ count: 1, kind: "file", minutes: 16 });
    expect(rows.at(-1)).toEqual({ count: 1, kind: "folder", minutes: 9 });
  });

  it("leaves out the app's own screens, which run on between what is kept", () => {
    expect(
      actionsNoteRows(
        [
          at(9, { kind: "file", path: "/Users/mac-user/a.txt" }),
          at(8, { kind: "screen", name: "Settings › Models" }),
          at(7, { kind: "file", path: "/Users/mac-user/b.txt" }),
        ],
        { chatId, sentAt: SENT },
      ),
    ).toEqual([{ count: 2, kind: "file", minutes: 7 }]);
  });
});

describe("actionsModelNote", () => {
  it("says what was done with apps and permissions, and an update", () => {
    expect(
      actionsModelNote({
        rows: [
          { count: 1, kind: "app-signed-in", minutes: 30 },
          { count: 1, kind: "app-disconnected", minutes: 29 },
          { count: 1, kind: "app-sign-in-failed", minutes: 28 },
          { count: 1, kind: "update", minutes: 27 },
          { count: 1, kind: "permission-allowed-folder", minutes: 4 },
          { count: 1, kind: "permission-allowed-app", minutes: 3 },
          { count: 2, kind: "permission-refused-folder", minutes: 2 },
          { count: 1, kind: "permission-refused-app", minutes: 1 },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Background, not something they sent: what the user did in this app before this message, oldest first, without names. \`instrument activity\` gives the names and paths, for when their words point at one of these.
      - 30m ago · signed in to an app
      - 29m ago · disconnected an app
      - 28m ago · couldn't sign in to an app
      - 27m ago · updated Instrument
      - 4m ago · allowed a chat to use a folder
      - 3m ago · allowed a chat to use an app
      - 2m ago · refused chats 2 folders
      - 1m ago · refused a chat an app
      </instrument-system-note>"
    `);
  });

  it("says the kinds of things done, without names, and where the names are", () => {
    expect(
      actionsModelNote({
        rows: [
          { count: 1, kind: "folder", minutes: 12 },
          { count: 3, kind: "file", minutes: 9 },
          { count: 3, kind: "move", minutes: 6 },
          { count: 1, kind: "chat", minutes: 2 },
          { count: 1, kind: "error", minutes: 0 },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Background, not something they sent: what the user did in this app before this message, oldest first, without names. \`instrument activity\` gives the names and paths, for when their words point at one of these.
      - 12m ago · opened a folder in Files
      - 9m ago · opened 3 files
      - 6m ago · moved 3 files
      - 2m ago · opened another chat
      - now · saw an error
      </instrument-system-note>"
    `);
  });
});

describe("createActionsPart", () => {
  async function setup() {
    createMockChatConfig(chatId);
    const sessionId = StoreId.newSessionId();
    await ChatWrites.saveSession(
      { createdAt: new Date(0), id: sessionId, title: "Test session" },
      chatId,
    );

    /** Records each action `ago` minutes before the message. */
    function logged(actions: [ago: number, RecordedAction][]) {
      recordActions(
        actions.map(([ago, action]) => [SENT.getTime() - ago * MIN, action]),
      );
    }

    /** A message the user typed in the chat, `ago` minutes before this one. */
    async function typed(ago: number, text = "Hello") {
      const createdAt = new Date(SENT.getTime() - ago * MIN);
      const messageId = StoreId.newMessageId();
      await ChatWrites.saveMessageWithParts(
        {
          id: messageId,
          metadata: { createdAt, sessionId },
          parts: [
            {
              metadata: {
                createdAt,
                id: StoreId.newPartId(),
                messageId,
                sessionId,
              },
              text,
              type: "text",
            },
          ],
          role: "user",
        } satisfies SessionMessage.UserWithParts,
        chatId,
      );
    }

    /** A task finishing, which wakes the chat on the user's role with no words. */
    async function wake(ago: number) {
      const createdAt = new Date(SENT.getTime() - ago * MIN);
      const messageId = StoreId.newMessageId();
      await ChatWrites.saveMessageWithParts(
        {
          id: messageId,
          metadata: { createdAt, sessionId },
          parts: [
            {
              data: { events: [] },
              metadata: {
                createdAt,
                id: StoreId.newPartId(),
                messageId,
                sessionId,
              },
              type: "data-taskEvent",
            },
          ],
          role: "user",
        } satisfies SessionMessage.UserWithParts,
        chatId,
      );
    }

    const rows = async () => {
      const part = await createActionsPart({
        chatId,
        createdAt: SENT,
        messageId: StoreId.newMessageId(),
        sessionId,
      });
      return part?.type === "data-actions" ? part.data : part;
    };

    return { logged, rows, typed, wake };
  }

  afterEach(() => {
    forgetRecordedActions();
  });

  it("reaches 30 minutes back on the chat's first message", async () => {
    const { logged, rows } = await setup();
    logged([
      [45, { kind: "folder", path: "/Users/mac-user/Old" }],
      [20, { kind: "file", path: "/Users/mac-user/a.txt" }],
      [2, { kind: "page", url: "https://example.com/" }],
    ]);

    expect(await rows()).toEqual({
      rows: [
        { count: 1, kind: "file", minutes: 20 },
        { count: 1, kind: "page", minutes: 2 },
      ],
    });
  });

  it("starts after the last message the user typed, past a task's wake", async () => {
    const { logged, rows, typed, wake } = await setup();
    logged([
      [20, { kind: "file", path: "/Users/mac-user/before.txt" }],
      [5, { kind: "folder", path: "/Users/mac-user/Taxes" }],
      [1, { kind: "file", path: "/Users/mac-user/Taxes/1099.txt" }],
    ]);
    await typed(10);
    await wake(3);

    expect(await rows()).toEqual({
      rows: [
        { count: 1, kind: "folder", minutes: 5 },
        { count: 1, kind: "file", minutes: 1 },
      ],
    });
  });

  it("adds nothing when nothing was done since", async () => {
    const { logged, rows, typed } = await setup();
    logged([[20, { kind: "file", path: "/Users/mac-user/a.txt" }]]);
    await typed(10);

    expect(await rows()).toBeUndefined();
  });

  it("adds nothing while the user keeps what they do to themselves", async () => {
    const { logged, rows } = await setup();
    logged([[2, { kind: "file", path: "/Users/mac-user/a.txt" }]]);
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      mayShareActions: () => false,
    });

    expect(await rows()).toBeUndefined();
  });
});
