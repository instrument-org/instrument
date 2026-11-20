import {
  type LayoutChange,
  type LayoutSideName,
  type LayoutSnapshot,
  type LayoutTab,
} from "../../schemas/group-layout";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import { systemNote } from "./system-note";

const SIDE_NAMES = ["left", "right"] as const;

/**
 * The tab group the chat works in, every tab by its id: said whole the
 * first time, and again only when the chat is in another group. Later
 * layouts go with their changes, which say only what is different.
 */
export function groupLayoutModelNote(
  data: SessionMessageDataPart.GroupLayoutDataPart,
) {
  return systemNote`
    Your tab group (${data.group.id}):
    ${layoutLines(data)}
  `;
}

/**
 * A group's sides, one line each, tabs in strip order, the one each side
 * shows marked; and a line when the window shows another group.
 */
function layoutLines(layout: LayoutSnapshot): string {
  const isTwo = layout.sides.length === 2;
  const sides = layout.sides.map(({ tabs }, side) => {
    const line = tabs.map(tabWords).join(" · ");
    return isTwo ? `${SIDE_NAMES[side] ?? "left"}: ${line}` : line;
  });
  return [...sides, ...(layout.isShown === false ? [NOT_SHOWN] : [])].join(
    "\n",
  );
}

const NOT_SHOWN =
  "The window shows another tab group, so none of this is on screen.";

/** A tab in a note: you, or its name and id; marked when its side shows it. */
function tabWords(
  tab: Pick<
    LayoutTab,
    "address" | "id" | "isThisChat" | "isUp" | "kind" | "title"
  >,
): string {
  const name = tab.isThisChat ? "you" : `${layoutTabName(tab)} [${tab.id}]`;
  return tab.isUp ? `${name} (showing)` : name;
}

/**
 * What the user sees of a group, in words that cannot be misread: each side's
 * tab showing, where it stands against this chat, and whether this chat is
 * hidden or the window shows another group.
 */
export function showingLine(layout: LayoutSnapshot): string {
  const isTwo = layout.sides.length === 2;
  const chatSide = layout.sides.findIndex(({ tabs }) =>
    tabs.some((tab) => tab.isThisChat),
  );
  const isChatShown =
    chatSide !== -1 &&
    layout.sides[chatSide]?.tabs.some((tab) => tab.isThisChat && tab.isUp) ===
      true;
  const shown = layout.sides.map(({ tabs }, side) => {
    const up = tabs.find((tab) => tab.isUp);
    const where = isTwo ? ` on the ${SIDE_NAMES[side] ?? "left"}` : "";
    if (up === undefined) {
      return `nothing${where}`;
    }
    if (up.isThisChat) {
      return isTwo ? `you${where}` : "only you";
    }
    const name = layoutTabName(up);
    if (side === chatSide) {
      return `${name}${where}, covering you`;
    }
    return isChatShown ? `${name}${where}, beside you` : `${name}${where}`;
  });
  if (layout.isShown === false) {
    return `The window shows another tab group now, so none of this is on screen. This group shows: ${shown.join("; ")}.`;
  }
  const hidden =
    chatSide !== -1 && !isChatShown
      ? " The user cannot see this chat now."
      : "";
  return `Showing: ${shown.join("; ")}.${hidden}`;
}

/**
 * Where one tab of a group stands, as a clause for a command's result:
 * which side, whether it shows or is hidden behind another tab, and how it
 * stands against this chat. Undefined for a tab the group does not have.
 */
export function tabPlace(
  layout: LayoutSnapshot,
  tabId: string,
): string | undefined {
  const side = layout.sides.findIndex(({ tabs }) =>
    tabs.some((tab) => tab.id === tabId),
  );
  const tabs = layout.sides[side]?.tabs;
  const tab = tabs?.find((each) => each.id === tabId);
  if (tabs === undefined || tab === undefined) {
    return;
  }
  const isTwo = layout.sides.length === 2;
  const name = SIDE_NAMES[side] ?? "left";
  const chatSide = layout.sides.findIndex((each) =>
    each.tabs.some((other) => other.isThisChat),
  );
  const where = !isTwo
    ? "in the group's one side"
    : side === chatSide
      ? `on your side, the ${name}`
      : chatSide === -1
        ? `on the ${name} side`
        : `on the ${name} side, beside you`;
  const up = tabs.find((each) => each.isUp);
  const place = tab.isUp
    ? side === chatSide
      ? `showing ${where}, covering this chat, which is hidden until the user switches back to it`
      : `showing ${where}`
    : `hidden ${where}, behind ${up === undefined ? "another tab" : up.isThisChat ? "you" : layoutTabName(up)}${layout.focused === side && side !== chatSide ? ", since the user is working on that side" : ""}`;
  return layout.isShown === false
    ? `${place}; the window shows another tab group now, so it is not on screen`
    : place;
}

/**
 * A group that is this chat and nothing else but unwritten new chats:
 * nothing to say until it had something.
 */
export function isChatAlone(data: SessionMessageDataPart.GroupLayoutDataPart) {
  return data.sides.every(({ tabs }) =>
    tabs.every((tab) => tab.isThisChat || tab.kind === "newChat"),
  );
}

/** A tab as the agent reads it in a layout: its address, or its kind and title where the address does not say. */
export function layoutTabName(tab: LayoutTab): string {
  switch (tab.kind) {
    case "builtIn": {
      return `[app] ${tab.title}`;
    }
    case "chat": {
      return `[chat] ${stripMarkdown(tab.title)}`;
    }
    case "file": {
      return tab.address;
    }
    case "folder": {
      return `[folder] ${tab.address}`;
    }
    case "newChat": {
      return "New Tab";
    }
    case "website": {
      return shortAddress(tab.address);
    }
  }
}

/** The longest a website's address runs before it is cut. */
const ADDRESS_LIMIT = 80;

/** A website's address without its scheme, `www.` and a bare trailing slash, cut when long. */
function shortAddress(address: string): string {
  const short = address
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
  return short.length > ADDRESS_LIMIT
    ? `${short.slice(0, ADDRESS_LIMIT - 1)}…`
    : short;
}

/**
 * The tab group as a message finds it: what changed since the agent last
 * heard, or the whole group where there is nothing it heard before to
 * change from (the first layout, or one in another group). Nothing when
 * neither part is on the message.
 */
export function tabGroupModelNote({
  changes,
  layout,
}: {
  changes?: SessionMessageDataPart.LayoutChangesDataPart;
  layout?: SessionMessageDataPart.GroupLayoutDataPart;
}): string | undefined {
  const isMoved = changes?.changes.some((one) => one.change === "chatMoved");
  if (layout !== undefined && (changes === undefined || isMoved === true)) {
    return groupLayoutModelNote(layout);
  }
  return changes === undefined ? undefined : layoutChangesModelNote(changes);
}

/** What changed in the group since the agent last heard, theirs or its own, in one line. */
export function layoutChangesModelNote(
  data: SessionMessageDataPart.LayoutChangesDataPart,
) {
  return systemNote`
    Tab group changes: ${data.changes.map(changeWords).join("; ")}.
  `;
}

function changeWords(change: LayoutChange): string {
  switch (change.change) {
    case "chatMoved": {
      return `you moved to the tab group ${change.to}`;
    }
    case "closed": {
      return `closed ${tabWords({ ...change.tab, isUp: false })}`;
    }
    case "groupShown": {
      return change.isShown
        ? "the window shows this group again"
        : "the window shows another tab group, so none of this one is on screen";
    }
    case "moved": {
      const where =
        change.from === change.to
          ? change.after === undefined
            ? "to the front of its side"
            : `after ${change.after}`
          : change.to === undefined
            ? "into the one side"
            : `to the ${change.to}`;
      return `moved ${tabWords(change.tab)} ${where}`;
    }
    case "movedIn": {
      return `${tabWords(change.tab)} moved in from the tab group ${change.from}${onSide(change.side)}`;
    }
    case "movedOut": {
      return `${tabWords(change.tab)} moved out to the tab group ${change.to}`;
    }
    case "navigated": {
      return `${change.tab.id} went to ${layoutTabName(change.tab)}`;
    }
    case "opened": {
      return `opened ${tabWords(change.tab)}${onSide(change.side)}`;
    }
    case "shown": {
      const shown = tabWords({ ...change.tab, isUp: false });
      return change.side === undefined
        ? `now showing ${shown}`
        : `the ${change.side} shows ${shown}`;
    }
  }
}

/** Where a tab now stands, after its name, in a group of two sides. */
function onSide(side: LayoutSideName): string {
  return side === undefined ? "" : ` on the ${side}`;
}
