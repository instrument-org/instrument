import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";

import { activeChats, chatsInView } from "./active-chats";
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

const screen = (
  group: string,
  id: string,
  href: string,
  side?: 1,
): WindowTab => ({
  group,
  href,
  id,
  kind: "screen",
  ...(side === undefined ? {} : { side }),
});

/**
 * Where Lisbon's tab stands in a window listing two groups, `up` (the group
 * on screen, its tab up `shown`) and `other` (its tab up `site`): the tab up
 * in the group up, the tab up on the right side of the group up, the tab up
 * in the other group, behind another tab of either, in a group the window
 * does not list, or nowhere.
 */
type Place =
  | "behind in other group"
  | "behind in group up"
  | "in a group not listed"
  | "nowhere"
  | "up in group up"
  | "up in other group"
  | "up on right side";

const LISTED = ["up", "other"];

const windowWith = (place: Place): WindowTabs => {
  const lisbon = chatHref(LISBON);
  return {
    activeByGroup: {
      other: "site",
      up: "shown",
      ...(place === "in a group not listed" ? { gone: "lisbon" } : {}),
    },
    ...(place === "up on right side"
      ? { besideByGroup: { up: "lisbon" } }
      : {}),
    tabs: [
      screen("up", "shown", place === "up in group up" ? lisbon : "/new-tab"),
      screen("other", "site", place === "up in other group" ? lisbon : "/new-tab"),
      ...(place === "behind in group up"
        ? [screen("up", "lisbon", lisbon)]
        : []),
      ...(place === "behind in other group"
        ? [screen("other", "lisbon", lisbon)]
        : []),
      ...(place === "up on right side"
        ? [screen("up", "lisbon", lisbon, 1)]
        : []),
      ...(place === "in a group not listed"
        ? [screen("gone", "lisbon", lisbon)]
        : []),
    ],
  };
};

const inView = (place: Place) => chatsInView(windowWith(place), LISTED);

const MARKS = {
  ask: { status: "waiting" },
  idle: {},
  stopped: { status: "stopped" },
  unread: { unread: true },
  working: { status: "working", working: true },
  "working, ask outranks": { status: "waiting", working: true },
} satisfies Record<string, Partial<Chat>>;

const idsOf = (chats: readonly Chat[]) => chats.map((each) => each.id);

describe("the chats a sidebar row shows", () => {
  it.each([
    ["up in group up", true],
    ["up on right side", true],
    ["up in other group", true],
    ["behind in group up", false],
    ["behind in other group", false],
    ["in a group not listed", false],
    ["nowhere", false],
  ] as const)("a chat %s is in view: %s", (place, shown) => {
    expect(inView(place).has(LISBON)).toBe(shown);
  });
});

describe("the sidebar's Chats list", () => {
  it.each([
    ["ask", "nowhere", true],
    ["ask", "behind in group up", true],
    ["ask", "behind in other group", true],
    ["ask", "up in other group", false],
    ["ask", "up on right side", false],
    ["unread", "nowhere", true],
    ["unread", "behind in group up", true],
    ["unread", "in a group not listed", true],
    ["unread", "up in group up", false],
    ["unread", "up in other group", false],
    ["working, ask outranks", "behind in group up", true],
    ["working", "nowhere", false],
    ["working", "behind in group up", false],
    ["idle", "nowhere", false],
    ["stopped", "nowhere", false],
  ] as const)(
    "on the first look, a chat marked %s with its tab %s shows: %s",
    (marks, place, shows) => {
      expect(
        idsOf(
          activeChats([chat(LISBON, MARKS[marks])], inView(place), { list: [] })
            .chats,
        ),
      ).toEqual(shows ? [LISBON] : []);
    },
  );

  // One look with the chat as it was, then one with it as it is: what
  // changed between them is what the list goes by.
  const twoLooks = (
    was: { marks: keyof typeof MARKS; place: Place },
    now: { marks: keyof typeof MARKS; place: Place },
  ) => {
    const first = activeChats([chat(LISBON, MARKS[was.marks])], inView(was.place), {
      list: [],
    });
    return idsOf(
      activeChats([chat(LISBON, MARKS[now.marks])], inView(now.place), first.kept)
        .chats,
    );
  };

  it.each([
    ["finishes behind another tab", "working", "behind in group up", "unread", "behind in group up", true],
    ["asks behind another tab", "working", "behind in other group", "ask", "behind in other group", true],
    ["asks in view", "working", "up in group up", "ask", "up in group up", false],
    ["finishes in view, then goes behind another tab", "unread", "up in group up", "unread", "behind in group up", false],
    ["asks in view, then goes behind another tab", "ask", "up in group up", "ask", "behind in group up", false],
    ["listed, comes into view still unread", "unread", "nowhere", "unread", "up in group up", true],
    ["listed, is seen in view", "unread", "nowhere", "idle", "up in group up", false],
    ["listed, still asks once seen", "ask", "nowhere", "ask", "up in group up", true],
    ["listed, its ask answered", "ask", "behind in group up", "working", "behind in group up", false],
  ] as const)(
    "a chat that %s shows: %s",
    (_label, wasMarks, wasPlace, nowMarks, nowPlace, shows) => {
      expect(
        twoLooks(
          { marks: wasMarks, place: wasPlace },
          { marks: nowMarks, place: nowPlace },
        ),
      ).toEqual(shows ? [LISBON] : []);
    },
  );

  it("takes a chat again that wants a look anew after it left", () => {
    const listed = activeChats([chat(LISBON, { unread: true })], new Set(), {
      list: [],
    });
    const seen = activeChats([chat(LISBON)], new Set([LISBON]), listed.kept);
    const away = activeChats([chat(LISBON)], new Set(), seen.kept);
    expect(
      idsOf(
        activeChats([chat(LISBON, { unread: true })], new Set(), away.kept)
          .chats,
      ),
    ).toEqual([LISBON]);
  });

  const OSLO = ChatIdSchema.parse("2026-11-10-oslo");
  const ALL = [LISBON, PARIS, ROME, OSLO];
  const waiting = (ids: readonly Chat["id"][]) =>
    ALL.map((id) => chat(id, ids.includes(id) ? { unread: true } : {}));
  // The list as it stood: `list` in it, nothing else wanting a look.
  const stood = (list: readonly Chat["id"][]) => ({ list, wanting: list });

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
      idsOf(
        activeChats(waiting([...before, ...joining]), new Set(), stood(before))
          .chats,
      ),
    ).toEqual(expected);
  });

  it("fills a visible row's place from behind More when it leaves", () => {
    expect(
      idsOf(
        activeChats(
          waiting([PARIS, OSLO, ROME]),
          new Set(),
          stood([PARIS, LISBON, OSLO, ROME]),
        ).chats.slice(0, 3),
      ),
    ).toEqual([PARIS, OSLO, ROME]);
  });

  it("drops a chat once it's seen with nothing waiting, and the rest stay put", () => {
    expect(
      idsOf(
        activeChats(
          [
            chat(LISBON, { unread: true }),
            chat(PARIS),
            chat(ROME, { status: "waiting" }),
          ],
          new Set(),
          stood([PARIS, LISBON, ROME]),
        ).chats,
      ),
    ).toEqual([LISBON, ROME]);
  });
});
