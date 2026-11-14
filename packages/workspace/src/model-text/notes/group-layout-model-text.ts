import {
  type ChangedTab,
  type LayoutChange,
  type LayoutSideName,
  type LayoutSnapshot,
  type LayoutTab,
  type LayoutTabKind,
} from "../../schemas/group-layout";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import { systemNote } from "./system-note";

/** How the note names a tab's kind ahead of its title. */
const KIND_WORDS: Record<LayoutTabKind, string> = {
  builtIn: "app page",
  chat: "chat",
  file: "file",
  folder: "folder",
  newChat: "new chat",
  website: "website",
};

const SIDE_NAMES = ["left", "right"] as const;

/**
 * The tab group the chat works in, as it stands now: each side's tabs in
 * order with the one showing marked, the side with the keyboard, which tab
 * is this chat, and a line saying what the user sees, side by side. Written
 * only when it reads differently from the one before, so each one is news.
 */
export function groupLayoutModelNote(
  data: SessionMessageDataPart.GroupLayoutDataPart,
) {
  if (isChatAlone(data) && data.isShown !== false) {
    return systemNote`
      Your tab group is just you now.
    `;
  }
  return systemNote`
    Your tab group, ${layoutLines(data)}
  `;
}

/**
 * A group's sides, one line each: its shape and what the star means, the
 * tabs of each side, and the line saying what is on screen (`showingLine`).
 */
function layoutLines(layout: LayoutSnapshot): string {
  const isTwo = layout.sides.length === 2;
  const head = isTwo
    ? "two sides side by side (* = the tab each side shows; its other tabs are hidden behind it):"
    : "one side (* = the tab it shows; the other tabs are hidden behind it):";
  const sides = layout.sides.map(({ tabs }, side) => {
    const line = tabs
      .map(
        (tab) =>
          `${layoutTabName(tab)}${tab.isThisChat ? " (you)" : ""}${tab.isUp ? "*" : ""}`,
      )
      .join(" · ");
    return isTwo
      ? `${SIDE_NAMES[side] ?? "left"}${layout.focused === side ? " (keyboard)" : ""}: ${line}`
      : line;
  });
  return [head, ...sides, showingLine(layout)].join("\n");
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

/** A tab by its kind and title, or as this chat. */
function named(tab: Pick<ChangedTab, "isThisChat" | "kind" | "title">) {
  if (tab.isThisChat) {
    return "this chat";
  }
  return tab.kind === "newChat"
    ? KIND_WORDS.newChat
    : `${KIND_WORDS[tab.kind]} "${tab.title}"`;
}

/**
 * What changed in the group since the layout before, whoever changed it:
 * tabs opened, closed, moved and navigated, the chat's own moves, and tabs
 * moved to or from other groups.
 */
export function layoutChangesModelNote(
  data: SessionMessageDataPart.LayoutChangesDataPart,
) {
  return systemNote`
    Changes to the tab group since you were last told, theirs or yours: ${data.changes.map(changeWords).join("; ")}.
  `;
}

function changeWords(change: LayoutChange): string {
  switch (change.change) {
    case "chatMoved": {
      return `this chat moved from the tab group ${change.from} to ${change.to}`;
    }
    case "closed": {
      return `closed ${withId(change.tab)}`;
    }
    case "moved": {
      const where =
        change.from === change.to
          ? change.after === undefined
            ? `to the front of its side`
            : `after "${change.after}"`
          : change.to === undefined
            ? "into the group's one side"
            : `to the ${change.to}`;
      return `moved ${withId(change.tab)} ${where}${change.beside && change.from !== change.to ? ", beside this chat" : ""}`;
    }
    case "movedIn": {
      return `moved ${withId(change.tab)} in from the tab group ${change.from}${placed(change.side, change.beside)}`;
    }
    case "movedOut": {
      return `moved ${withId(change.tab)} out to the tab group ${change.to}`;
    }
    case "navigated": {
      return `${change.tab.id} went from ${change.from.address} to ${named(change.tab)} at ${change.tab.address}`;
    }
    case "opened": {
      return `opened ${withId(change.tab)}${placed(change.side, change.beside)}`;
    }
  }
}

function withId(tab: ChangedTab): string {
  return tab.isThisChat ? "this chat" : `${named(tab)} (${tab.id})`;
}

/** Where a tab now stands, after its name. */
function placed(side: LayoutSideName, beside: boolean | undefined): string {
  if (side === undefined) {
    return "";
  }
  return beside ? ` on the ${side}, beside this chat` : ` on the ${side}`;
}
