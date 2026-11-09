import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { writeMessage } from "../../test/helpers/told-history";
import { ChatWrites } from "../chat-writes";
import { questionAnswerModelNote } from "../../model-text/notes/question-answer-model-text";
import { sessionOfChat } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { openAsks } from "../chat/open-asks";
import { recordSignIn, waitInChat } from "../chat/asks";
import { driveAsks, driveOwedAsks, openSignInsOf } from "../chat/drive-asks";
import { chatDir } from "../record-folders";
import { ChatRecords, writingChatRecords } from "../records/chat-records";
import { newDeviceId } from "../records/device-id";
import { type AppConnectionStatus, readConnection } from "./connection";
import { startAppEvents } from "./events";
import { AppSlugSchema } from "./manifest";
import { createMemoryAppsConfig } from "./memory-config";
import { writeAppFolder } from "./store";

const woken = vi.hoisted(() =>
  vi.fn(
    (
      _events: unknown,
      _ref: unknown,
      _chatId: string,
      _extra?: { notOnCard?: unknown; signIns?: unknown },
    ) => Promise.resolve(),
  ),
);

vi.mock(import("../chat/wake"), () => ({ wakeChatForApp: woken }));

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
  let lisbon: ChatId;
  let porto: ChatId;
  beforeEach(async () => {
    woken.mockClear();
    lisbon = (await chatWithCard({ apps: [["linear", "Linear"]] })).chatId;
    porto = (
      await chatWithCard({ apps: [["linear", "Linear"]], keepApps: true })
    ).chatId;
  });

  /** The chats of this test woken, in order. */
  const wokenChats = () =>
    woken.mock.calls
      .map(([, , chatId]) => chatId)
      .filter((chatId) => chatId === lisbon || chatId === porto)
      .toSorted((a, b) => (a === lisbon ? -1 : b === lisbon ? 1 : 0));

  it.each(["connected", "declined"] as const)(
    "wakes every chat that asked when %s, and closes their cards",
    async (event) => {
      await setStatus("linear", event);
      await answer(event);

      await vi.waitFor(() => expect(wokenChats()).toEqual([lisbon, porto]));
      expect(woken).toHaveBeenCalledWith(
        [expect.objectContaining({ event })],
        expect.anything(),
        lisbon,
        expect.objectContaining({ ask: expect.any(String) }),
      );
      expect(await openAsks(lisbon)).toEqual([]);
    },
  );

  it("keeps the cards after a failure, for the user to try again from one", async () => {
    await setStatus("linear", "failed");
    await answer("failed");

    await vi.waitFor(() => expect(wokenChats()).toEqual([lisbon, porto]));
    expect((await openAsks(lisbon)).map((ask) => ask.kind)).toEqual([
      "sign-in",
    ]);
  });

  it("wakes nobody for an app no chat is waiting on", async () => {
    await setStatus("linear", "declined");
    await answer("declined");
    await vi.waitFor(() => expect(wokenChats()).toEqual([lisbon, porto]));
    woken.mockClear();

    await setStatus("linear", "connected");
    await answer("connected");

    expect(wokenChats()).toEqual([]);
  });
});

const GOOGLE = [
  ["drive", "Google Drive"],
  ["docs", "Google Docs"],
  ["gmail", "Gmail"],
] as const;

let chats = 0;
/** The chats this test made, whose wakes it reads; an earlier test's cards may still be up. */
let ours = new Set<ChatId>();

/** Writes the chat's own session with one card asking for every Google app, or for `apps`. */
async function chatWithCard({
  apps = GOOGLE,
  keepApps = false,
  notAsked = [],
}: {
  apps?: readonly (readonly [string, string])[];
  /** Keeps the apps' folders and connections an earlier card in the test made. */
  keepApps?: boolean;
  /** Apps the call named that never reached the card, with why. */
  notAsked?: { message: string; slug: string }[];
} = {}): Promise<{
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
  if (!keepApps) {
    ours = new Set();
  }
  ours.add(chatId);
  await ChatWrites.saveSession(
    { createdAt: new Date(), id: sessionId, title: "Connect my Google apps" },
    chatId,
  );
  if (!keepApps) {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: createMemoryAppsConfig(),
    });
  }
  for (const [slug, name] of apps) {
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
    await setStatus(slug, "needs-sign-in");
  }
  const at = new Date();
  const messageId = StoreId.newMessageId();
  const partId = StoreId.newPartId();
  await writeMessage(chatId, sessionId, "assistant", [
    {
      input: {
        reason: "So I can read your files, calendar and email.",
        slugs: [
          ...apps.map(([slug]) => slug),
          ...notAsked.map(({ slug }) => slug),
        ],
      },
      metadata: {
        createdAt: at,
        endedAt: at,
        id: partId,
        messageId,
        sessionId,
      },
      output: {
        apps: [
          ...apps.map(([slug, name]) => ({
            kind: "sign-in" as const,
            name,
            slug,
            state: "asked" as const,
          })),
          ...notAsked.map(({ message, slug }) => ({
            message,
            slug,
            state: "failure" as const,
          })),
        ],
      },
      state: "output-available",
      toolCallId: "call-1",
      type: "tool-connect_app",
    } satisfies SessionMessagePart.Type,
  ]);
  // What the call's own run records.
  await recordSignIn(
    { chatId, messageId, partId, sessionId },
    apps.map(([slug, name]) => ({ name, slug })),
    notAsked.length === 0
      ? undefined
      : notAsked.map(({ message, slug }) => ({ reason: message, slug })),
  );
  return { chatId, sessionId };
}

async function setStatus(slug: string, status: AppConnectionStatus) {
  const was = await readConnection(slug);
  await getWorkspaceConfig().apps.connections.set(slug, {
    ...was,
    ...(status === "connected" ? { account: "you@example.com" } : {}),
    status,
    updatedAt: Date.now(),
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
  return woken.mock.calls
    .filter(([, , chatId]) => ours.has(ChatIdSchema.parse(chatId)))
    .map(([events, , chatId, extra]) => ({
      chatId,
      events: (
        events as { account?: string; event: string; slug: string }[]
      ).map(
        ({ account, event, slug }) =>
          `${slug} ${event}${account === undefined ? "" : ` as ${account}`}`,
      ),
      ...(extra?.notOnCard === undefined ? {} : { notOnCard: extra.notOnCard }),
      signIns: extra?.signIns,
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
    expect(wakes()).toEqual([]);

    await answerRow("gmail", "connected");
    await vi.waitFor(() => expect(wakes()).not.toEqual([]));
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
    expect(await openAsks(chatId)).toEqual([]);
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
    await vi.waitFor(() => expect(wakes()).not.toEqual([]));
    // Room for a second wake, which would be the bug.
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(wakes().map(({ events }) => events)).toEqual([
      ["docs declined", "drive connected as you@example.com", "gmail declined"],
    ]);
  });

  it("wakes at once for a sign-in that did not connect, with the card as it stands", async () => {
    const { chatId } = await chatWithCard();
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
    expect((await openAsks(chatId)).map((ask) => ask.kind)).toEqual([
      "sign-in",
    ]);
  });

  it("tells a question's answer where the card stands while it is open", async () => {
    const { chatId } = await chatWithCard();
    await answerRow("drive", "connected");
    await answerRow("docs", "declined");

    const signIns = await openSignInsOf(chatId);

    expect(
      questionAnswerModelNote({
        answer: { replies: [{ picked: ["you@example.com"] }] },
        partId: StoreId.newPartId(),
        questions: ["Which Google account should I use?"],
        ...(signIns === undefined ? {} : { signIns }),
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user answered your question "Which Google account should I use?": you@example.com
      Your sign-in card still waits on the user: connected: Google Drive (drive) as you@example.com; skipped by the user: Google Docs (docs); not answered yet: Gmail (gmail). The card shows them the count, so leave it out; you are woken when every app on it is answered.
      </instrument-system-note>"
    `);

    await answerRow("gmail", "connected");
    expect(await openSignInsOf(chatId)).toBeUndefined();
  });

  it("wakes once more, with that one app, for a sign-in to a skipped app after the card settled", async () => {
    const { chatId } = await chatWithCard();
    await answerRow("drive", "connected");
    await answerRow("docs", "declined");
    await answerRow("gmail", "connected");
    await vi.waitFor(() => expect(wakes()).not.toEqual([]));
    woken.mockClear();

    // Sign in on the folded card's row for the skipped app.
    await waitInChat("docs", chatId);
    await answerRow("docs", "connected");

    expect(wakes()).toEqual([
      {
        chatId,
        events: ["docs connected as you@example.com"],
        signIns: undefined,
      },
    ]);
    expect(await openAsks(chatId)).toEqual([]);
  });

  it("wakes the chat for a sign-in on a card the person already wrote past", async () => {
    const { chatId, sessionId } = await chatWithCard();
    await answerRow("drive", "connected");
    await answerRow("docs", "declined");
    // The person moves on before the last row, which leaves the card.
    await writeMessage(chatId, sessionId, "user", [
      { state: "done", text: "Never mind Gmail for now.", type: "text" },
    ]);
    expect(await openAsks(chatId)).toEqual([]);
    woken.mockClear();

    // Then signs in on that card's row after all.
    await waitInChat("gmail", chatId);
    await answerRow("gmail", "connected");

    await vi.waitFor(() =>
      expect(wakes()).toEqual([
        {
          chatId,
          events: ["gmail connected as you@example.com"],
          signIns: undefined,
        },
      ]),
    );
  });

  it("names the apps its call could not ask for in the settling note", async () => {
    const reason =
      'No app is "sheets": no APP.md in Apps/ gives that as its id.';
    await chatWithCard({ notAsked: [{ message: reason, slug: "sheets" }] });

    await answerRow("drive", "connected");
    await answerRow("docs", "declined");
    expect(wakes()).toEqual([]);
    await answerRow("gmail", "connected");

    expect(wakes()).toEqual([
      expect.objectContaining({ notOnCard: [{ reason, slug: "sheets" }] }),
    ]);
  });
});

// Every device writes its own logs into one synced folder; here the other
// device is a `ChatRecords` of its own over the same chats folder.
describe("Not now from another computer", () => {
  const made: ChatRecords[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((records) => records.dispose()));
  });

  it("turns the card down on the computer that asked, and wakes the chat once", async () => {
    woken.mockClear();
    const { chatId, sessionId } = await chatWithCard();
    await answerRow("drive", "connected");
    woken.mockClear();
    const phone = new ChatRecords({
      app: "0.0.0-test",
      device: newDeviceId(),
      dirOf: chatDir,
      fsync: false,
    });
    made.push(phone);
    const owner = writingChatRecords();
    if (!owner) {
      throw new Error("expected the test's records in place");
    }
    await phone.catchUp(chatId);
    const [card] = await openAsks(chatId);
    await phone.answer(chatId, sessionId, {
      ask: card?.id ?? "",
      given: { decision: "declined", kind: "sign-in" },
    });

    await owner.catchUp(chatId);
    await driveAsks(chatId, {} as WorkspaceActorRef);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect((await readConnection("docs"))?.status).toBe("declined");
    expect((await readConnection("gmail"))?.status).toBe("declined");
    expect(
      wakes()
        .filter((wake) => wake.chatId === chatId)
        .map(({ events }) => events.toSorted()),
    ).toEqual([
      ["docs declined", "drive connected as you@example.com", "gmail declined"],
    ]);
    expect(await openAsks(chatId)).toEqual([]);
  });

  it("settles a card with a sign-in that failed, and leaves an app that just connected", async () => {
    const { chatId, sessionId } = await chatWithCard();
    await answerRow("drive", "failed");
    // Connected on this computer since the card's rows were last written.
    await setStatus("gmail", "connected");
    woken.mockClear();
    const phone = new ChatRecords({
      app: "0.0.0-test",
      device: newDeviceId(),
      dirOf: chatDir,
      fsync: false,
    });
    made.push(phone);
    const owner = writingChatRecords();
    if (!owner) {
      throw new Error("expected the test's records in place");
    }
    await phone.catchUp(chatId);
    const [card] = await openAsks(chatId);
    await phone.answer(chatId, sessionId, {
      ask: card?.id ?? "",
      given: { decision: "declined", kind: "sign-in" },
    });
    await owner.catchUp(chatId);
    let writes = 0;
    const stop = publisher.subscribe("record.changed", ({ id, kind }) => {
      if (id === chatId && kind === "session") {
        writes++;
      }
    });

    try {
      await driveAsks(chatId, {} as WorkspaceActorRef);
      await new Promise((resolve) => setTimeout(resolve, 40));
    } finally {
      stop();
    }

    expect((await readConnection("drive"))?.status).toBe("declined");
    expect((await readConnection("gmail"))?.status).toBe("connected");
    expect(await openAsks(chatId)).toEqual([]);
    expect(wakes().filter((wake) => wake.chatId === chatId)).toHaveLength(1);
    expect(writes).toBeLessThan(8);
  });
});

describe("a launch after a sign-in finished as the app quit", () => {
  it("settles the card the connection already answers, quietly", async () => {
    woken.mockClear();
    const { chatId } = await chatWithCard({ apps: [["linear", "Linear"]] });
    // Saved as connected, with the app gone before its event went out.
    await setStatus("linear", "connected");

    await driveOwedAsks({} as WorkspaceActorRef);

    expect(await openAsks(chatId)).toEqual([]);
    expect(
      woken.mock.calls
        .filter(([, , woke]) => woke === chatId)
        .map(([events, , , extra]) => [events, extra]),
    ).toEqual([
      [
        [expect.objectContaining({ event: "connected", slug: "linear" })],
        expect.objectContaining({ quiet: true }),
      ],
    ]);
  });
});
