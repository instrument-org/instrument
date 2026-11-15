import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";

import { activeChats } from "./active-chats";
import { type Chat } from "./chats";
import { type WindowTabs } from "./tab-model";
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

const screen = (group: string, id: string, href: string): WindowTab => ({
  group,
  href,
  id,
  kind: "screen",
});

/**
 * The window has two groups: `up`, shown, whose tab up is `shown`, and
 * `behind`, not shown. `held` puts Lisbon's tab where the row says: up in
 * the group on screen, behind another tab of a group not shown, or nowhere.
 */
const windowWith = (held: "background" | "none" | "visible"): WindowTabs => ({
  activeByGroup: { behind: "site", up: "shown" },
  tabs: [
    held === "visible"
      ? screen("up", "shown", chatHref(LISBON))
      : screen("up", "shown", "/new-tab"),
    screen("behind", "site", "/new-tab"),
    ...(held === "background"
      ? [screen("behind", "lisbon", chatHref(LISBON))]
      : []),
  ],
});

const MARKS = {
  ask: { status: "waiting" },
  idle: {},
  stopped: { status: "stopped" },
  unread: { unread: true },
  working: { status: "working", working: true },
  "working, ask outranks": { status: "waiting", working: true },
} satisfies Record<string, Partial<Chat>>;

describe("the sidebar's Chats list", () => {
  it.each([
    ["ask", "none", true],
    ["ask", "background", false],
    ["ask", "visible", false],
    ["unread", "none", true],
    ["unread", "background", false],
    ["unread", "visible", false],
    ["working", "none", true],
    ["working", "background", false],
    ["working", "visible", false],
    ["working, ask outranks", "none", true],
    ["idle", "none", false],
    ["stopped", "none", false],
  ] as const)(
    "a chat marked %s held by %s tab shows: %s",
    (marks, held, shows) => {
      expect(
        activeChats([chat(LISBON, MARKS[marks])], windowWith(held), []).map(
          (each) => each.id,
        ),
      ).toEqual(shows ? [LISBON] : []);
    },
  );

  const OSLO = ChatIdSchema.parse("2026-11-10-oslo");
  const ALL = [LISBON, PARIS, ROME, OSLO];
  const waiting = (ids: readonly Chat["id"][]) =>
    ALL.map((id) => chat(id, ids.includes(id) ? { unread: true } : {}));

  it.each([
    [
      "joins at the top while fewer than three show",
      [PARIS, LISBON],
      [ROME],
      [ROME, PARIS, LISBON],
    ],
    ["joins at the top of an empty list", [], [ROME], [ROME]],
    [
      "joins behind More once three show",
      [PARIS, LISBON, OSLO],
      [ROME],
      [PARIS, LISBON, OSLO, ROME],
    ],
    [
      "two at once fill the top, then More",
      [PARIS, LISBON],
      [ROME, OSLO],
      [ROME, PARIS, LISBON, OSLO],
    ],
  ] as const)("a newcomer %s", (_label, before, joining, expected) => {
    expect(
      activeChats(
        waiting([...before, ...joining]),
        windowWith("none"),
        before,
      ).map((each) => each.id),
    ).toEqual(expected);
  });

  it("fills a visible row's place from behind More when it leaves", () => {
    expect(
      activeChats(waiting([PARIS, OSLO, ROME]), windowWith("none"), [
        PARIS,
        LISBON,
        OSLO,
        ROME,
      ])
        .slice(0, 3)
        .map((each) => each.id),
    ).toEqual([PARIS, OSLO, ROME]);
  });

  it("drops a chat once it's seen with nothing waiting, and the rest stay put", () => {
    expect(
      activeChats(
        [
          chat(LISBON, { unread: true }),
          chat(PARIS),
          chat(ROME, { working: true }),
        ],
        windowWith("none"),
        [PARIS, LISBON, ROME],
      ).map((each) => each.id),
    ).toEqual([LISBON, ROME]);
  });
});
