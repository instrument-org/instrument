import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { type WindowTab } from "@/client/atoms/window";
import {
  browserTargetOf,
  ChatIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import {
  chatsStoppedByClose,
  chatsStoppedByPages,
  stopQuestionCopy,
} from "./close-stops";
import { chatHref } from "./window-href";

const LISBON = ChatIdSchema.parse("2026-11-10-lisbon");
const PARIS = ChatIdSchema.parse("2026-11-10-paris");
const ROME = ChatIdSchema.parse("2026-11-10-rome");

const chat = (id: Chat["id"], marks: Partial<Chat> = {}): Chat => ({
  archived: false,
  firstAsk: "",
  holds: { apps: [], files: [], sites: [] },
  id,
  lastUserMessageAt: 1,
  sessionId: StoreId.newSessionId(),
  starred: false,
  status: "idle",
  title: id,
  titleByApp: true,
  unread: false,
  unreadByUser: false,
  working: false,
  ...marks,
});

const tabOf = (id: string, href: string): WindowTab => ({
  group: "g",
  href,
  id,
  kind: "screen",
});

describe("the chats a close stops", () => {
  it.each([
    ["working", { status: "working", working: true }, true],
    [
      "a task at work under a question",
      { status: "waiting", working: true },
      true,
    ],
    ["waiting on a question", { status: "waiting" }, true],
    ["only unread", { unread: true }, false],
    ["stopped", { status: "stopped" }, false],
    ["idle", {}, false],
  ] satisfies [string, Partial<Chat>, boolean][])(
    "a chat %s counts: %s",
    (_name, marks, counts) => {
      const tabs = [tabOf("t1", chatHref(LISBON))];
      expect(chatsStoppedByClose(tabs, [chat(LISBON, marks)]).length > 0).toBe(
        counts,
      );
    },
  );

  it("names each chat once, in tab order, and none before the list is read", () => {
    const tabs = [
      tabOf("t1", chatHref(PARIS)),
      tabOf("t2", "/new"),
      tabOf("t3", chatHref(LISBON)),
      tabOf("t4", chatHref(PARIS)),
      tabOf("t5", chatHref(ROME)),
    ];
    const chats = [
      chat(LISBON, { status: "waiting" }),
      chat(PARIS, { status: "working", working: true }),
      chat(ROME),
    ];
    expect(chatsStoppedByClose(tabs, chats).map((each) => each.id)).toEqual([
      PARIS,
      LISBON,
    ]);
    expect(chatsStoppedByClose(tabs, undefined)).toEqual([]);
  });
});

it("stops a chat whose agent is on a closing page, once, and no other", () => {
  const page = (id: string): WindowTab => ({
    group: "g",
    id,
    kind: "page",
    openedAt: 0,
    url: `https://${id}.example/`,
  });
  const ids = [StoreId.newTabId(), StoreId.newTabId(), StoreId.newTabId()];
  const tabs = ids.map(page);
  const inUse = ids
    .slice(0, 2)
    .map((id) => ({ chatId: LISBON, targetId: browserTargetOf(id) }));
  const chats = [chat(LISBON)];
  expect(
    chatsStoppedByPages(tabs, chats, inUse).map(({ chat: { id }, tab }) => ({
      id,
      tab,
    })),
  ).toEqual([{ id: LISBON, tab: ids[0] }]);
  expect(chatsStoppedByPages(tabs.slice(2), chats, inUse)).toEqual([]);
  expect(chatsStoppedByPages(tabs, chats, undefined)).toEqual([]);
});

describe("the question's words", () => {
  it("names one chat, else counts them, and says what closes", () => {
    const cases = [
      [[{ title: "Trip plan" }], 1, "tab"],
      [[{ title: "" }], 1, "group"],
      [[{ title: "Trip plan" }, { title: "Budget" }], 1, "group"],
      [[{ title: "Trip plan" }, { title: "Budget" }], 2, "tab"],
      [[{ title: "Trip plan" }], 1, "split"],
      [
        [{ title: "Trip plan" }, { title: "Budget" }, { title: "Rome" }],
        1,
        "window",
      ],
    ] satisfies [
      { title: string }[],
      number,
      "group" | "split" | "tab" | "window",
    ][];
    expect(
      cases.map(([chats, closes, what]) =>
        stopQuestionCopy({ chats, closes, what }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "description": "Closing this tab stops what “Trip plan” is working on.",
          "title": "Stop this chat?",
        },
        {
          "description": "Closing this tab group stops what this chat is working on.",
          "title": "Stop this chat?",
        },
        {
          "description": "Closing this tab group stops what these chats are working on.",
          "title": "Stop 2 chats?",
        },
        {
          "description": "Closing these tabs stops what these chats are working on.",
          "title": "Stop 2 chats?",
        },
        {
          "description": "Closing this split stops what “Trip plan” is working on.",
          "title": "Stop this chat?",
        },
        {
          "description": "Closing this window stops what these chats are working on.",
          "title": "Stop 3 chats?",
        },
      ]
    `);
  });

  it("says the chat is using the page that closes", () => {
    const asked = (title: string, what: "group" | "tab") =>
      stopQuestionCopy({
        chats: [{ title }],
        closes: 1,
        isUsingPage: true,
        what,
      }).description;
    expect([asked("Trip plan", "tab"), asked("", "group")]).toEqual([
      "“Trip plan” is using this page. Closing this tab stops what it's working on.",
      "This chat is using a page in this tab group. Closing it stops the chat's work.",
    ]);
  });
});
