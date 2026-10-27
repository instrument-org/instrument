import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { writeMessage } from "../../test/helpers/told-history";
import { ChatWrites } from "../chat-writes";
import { questionAnswerModelNote } from "../question-answer-model-text";
import { sessionOfChat } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  type AppConnectionStatus,
  readConnection,
  waitInChat,
} from "./connection";
import { startAppEvents } from "./events";
import { AppSlugSchema } from "./manifest";
import { createMemoryAppsConfig } from "./memory-config";
import { openSignInsOf } from "./sign-in-group";
import { writeAppFolder } from "./store";

const woken = vi.hoisted(() =>
  vi.fn(
    (_events: unknown, _ref: unknown, _chatId: string, _signIns?: unknown) =>
      Promise.resolve(),
  ),
);

vi.mock(import("../chat/wake"), () => ({ wakeChatForApp: woken }));

const LISBON = ChatIdSchema.parse("2026-10-08-lisbon");
const PORTO = ChatIdSchema.parse("2026-10-09-porto");

/** Says the user answered the ask for Linear, the way the host app does. */
async function answer(event: "connected" | "declined" | "failed") {
  publisher.publish("app.event", { event, name: "Linear", slug: "linear" });
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeAll(() => {
  // A subscriber for the file's life, as the workspace starts one.
  startAppEvents({} as WorkspaceActorRef);
});

describe("startAppEvents", () => {
  beforeEach(async () => {
    woken.mockClear();
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: createMemoryAppsConfig(),
    });
    await getWorkspaceConfig().apps.connections.set("linear", {
      status: "needs-sign-in",
      waitingChats: [LISBON, PORTO],
      updatedAt: 1,
    });
  });

  it.each(["connected", "declined"] as const)(
    "wakes every chat that asked when %s, and takes the asks off",
    async (event) => {
      await answer(event);

      expect(woken.mock.calls.map(([, , chatId]) => chatId)).toEqual([
        LISBON,
        PORTO,
      ]);
      expect(woken).toHaveBeenCalledWith(
        [expect.objectContaining({ event })],
        expect.anything(),
        LISBON,
      );
      expect((await readConnection("linear"))?.waitingChats).toBeUndefined();
    },
  );

  it("keeps the asks after a failure, for the user to try again from a card", async () => {
    await answer("failed");

    expect(woken).toHaveBeenCalledTimes(2);
    expect((await readConnection("linear"))?.waitingChats).toEqual([
      LISBON,
      PORTO,
    ]);
  });

  it("wakes nobody for an app no chat is waiting on", async () => {
    await answer("declined");
    woken.mockClear();

    await answer("connected");

    expect(woken).not.toHaveBeenCalled();
  });
});

const GOOGLE = [
  ["drive", "Google Drive"],
  ["docs", "Google Docs"],
  ["gmail", "Gmail"],
] as const;

let chats = 0;

/** Writes the chat's own session with one card asking for every Google app. */
async function chatWithCard(): Promise<{
  chatId: ChatId;
  sessionId: StoreId.Session;
}> {
  const chatId = createMockChatConfig(
    ChatIdSchema.parse(`2026-10-27-google-${++chats}`),
  );
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    throw new Error("The mock chat has no session.");
  }
  await ChatWrites.saveSession(
    { createdAt: new Date(), id: sessionId, title: "Connect my Google apps" },
    chatId,
  );
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    apps: createMemoryAppsConfig(),
  });
  for (const [slug, name] of GOOGLE) {
    await writeAppFolder({
      appsDir: getWorkspaceConfig().appsDir,
      guide: "",
      manifest: {
        auth: { kind: "oauth" },
        type: "mcp",
        url: `https://${slug}.example.com/mcp`,
      },
      name,
      slug: AppSlugSchema.parse(slug),
    });
    await setStatus(slug, "needs-sign-in", [chatId]);
  }
  const at = new Date();
  await writeMessage(chatId, sessionId, "assistant", [
    {
      input: {
        reason: "So I can read your files, calendar and email.",
        slugs: GOOGLE.map(([slug]) => slug),
      },
      metadata: {
        createdAt: at,
        endedAt: at,
        id: StoreId.newPartId(),
        messageId: StoreId.newMessageId(),
        sessionId,
      },
      output: {
        apps: GOOGLE.map(([slug, name]) => ({
          kind: "sign-in" as const,
          name,
          slug,
          state: "asked" as const,
        })),
      },
      state: "output-available",
      toolCallId: "call-1",
      type: "tool-connect_app",
    } satisfies SessionMessagePart.Type,
  ]);
  return { chatId, sessionId };
}

async function setStatus(
  slug: string,
  status: AppConnectionStatus,
  waitingChats?: ChatId[],
) {
  const was = await readConnection(slug);
  await getWorkspaceConfig().apps.connections.set(slug, {
    ...was,
    ...(status === "connected" ? { account: "you@example.com" } : {}),
    status,
    updatedAt: Date.now(),
    ...(waitingChats === undefined ? {} : { waitingChats }),
  });
}

/** The user answers one row, the way the host app records and then says it. */
async function answerRow(
  slug: string,
  event: "connected" | "declined" | "failed",
) {
  await setStatus(slug, event);
  publisher.publish("app.event", { event, name: slug, slug });
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** What each wake carried: the events by app, and the card as it stood. */
function wakes() {
  return woken.mock.calls.map(([events, , chatId, signIns]) => ({
    chatId,
    events: (events as { account?: string; event: string; slug: string }[]).map(
      ({ account, event, slug }) =>
        `${slug} ${event}${account === undefined ? "" : ` as ${account}`}`,
    ),
    signIns,
  }));
}

describe("a card asking for several apps", () => {
  beforeEach(() => {
    woken.mockClear();
  });

  it("holds the wake while an app on it is waiting, then wakes once with all of them", async () => {
    const { chatId } = await chatWithCard();

    await answerRow("drive", "connected");
    await answerRow("docs", "declined");
    expect(woken).not.toHaveBeenCalled();
    // The chat waits on the card now, not on the apps already answered.
    expect((await readConnection("drive"))?.waitingChats).toBeUndefined();

    await answerRow("gmail", "connected");
    expect(wakes()).toEqual([
      {
        chatId,
        events: [
          "gmail connected as you@example.com",
          "drive connected as you@example.com",
          "docs declined",
        ],
        signIns: [
          {
            account: "you@example.com",
            name: "Google Drive",
            slug: "drive",
            standing: "connected",
          },
          { name: "Google Docs", slug: "docs", standing: "declined" },
          {
            account: "you@example.com",
            name: "Gmail",
            slug: "gmail",
            standing: "connected",
          },
        ],
      },
    ]);
    expect((await readConnection("gmail"))?.waitingChats).toBeUndefined();
  });

  it("wakes once when Skip the rest declines several apps at once", async () => {
    await chatWithCard();
    await answerRow("drive", "connected");

    // Both records are written before either event is heard, as when the
    // card's button declines every row left in one go.
    await setStatus("docs", "declined");
    await setStatus("gmail", "declined");
    publisher.publish("app.event", {
      event: "declined",
      name: "docs",
      slug: "docs",
    });
    publisher.publish("app.event", {
      event: "declined",
      name: "gmail",
      slug: "gmail",
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(wakes().map(({ events }) => events)).toEqual([
      ["docs declined", "drive connected as you@example.com", "gmail declined"],
    ]);
  });

  it("wakes at once for a sign-in that did not connect, with the card as it stands", async () => {
    await chatWithCard();
    await answerRow("drive", "connected");

    await answerRow("docs", "failed");

    expect(wakes().map(({ events, signIns }) => ({ events, signIns }))).toEqual(
      [
        {
          events: ["docs failed"],
          signIns: [
            expect.objectContaining({ slug: "drive", standing: "connected" }),
            expect.objectContaining({ slug: "docs", standing: "failed" }),
            expect.objectContaining({ slug: "gmail", standing: "waiting" }),
          ],
        },
      ],
    );
    // The user can still try again from the card.
    expect((await readConnection("docs"))?.waitingChats).toHaveLength(1);
  });

  it("tells a question's answer where the card stands while it is open", async () => {
    const { chatId, sessionId } = await chatWithCard();
    await answerRow("drive", "connected");
    await answerRow("docs", "declined");

    const signIns = await openSignInsOf(chatId, sessionId);

    expect(
      questionAnswerModelNote({
        answer: { selectedChoice: "you@example.com" },
        partId: StoreId.newPartId(),
        question: "Which Google account should I use?",
        ...(signIns === undefined ? {} : { signIns }),
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The person answered your question "Which Google account should I use?": you@example.com
      Your sign-in card still waits on the user: connected: Google Drive (drive) as you@example.com; skipped by the user: Google Docs (docs); not answered yet: Gmail (gmail). The card shows them the count, so leave it out; you are woken when every app on it is answered.
      </instrument-system-note>"
    `);

    await answerRow("gmail", "connected");
    expect(await openSignInsOf(chatId, sessionId)).toBeUndefined();
  });

  it("wakes once more, with that one app, for a sign-in to a skipped app after the card settled", async () => {
    const { chatId, sessionId } = await chatWithCard();
    await answerRow("drive", "connected");
    await answerRow("docs", "declined");
    await answerRow("gmail", "connected");
    // The settling wake's note, as the real wake writes it.
    await writeMessage(chatId, sessionId, "user", [
      {
        data: {
          apps: {},
          events: [{ event: "connected", name: "Gmail", slug: "gmail" }],
          signIns: [
            { name: "Google Drive", slug: "drive", standing: "connected" },
            { name: "Google Docs", slug: "docs", standing: "declined" },
            { name: "Gmail", slug: "gmail", standing: "connected" },
          ],
        },
        type: "data-appEvent",
      },
    ]);
    woken.mockClear();

    // Sign in on the folded card's row for the skipped app.
    await waitInChat("docs", chatId);
    await answerRow("docs", "connected");

    expect(wakes()).toEqual([
      { chatId, events: ["docs connected"], signIns: undefined },
    ]);
    expect((await readConnection("docs"))?.waitingChats).toBeUndefined();
  });
});
