import {
  type ChangedTab,
  type LayoutChange,
  type LayoutSideName,
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
 * order with the one in front marked, the side with the keyboard, and which
 * tab is this chat. Written only when it reads differently from the one
 * before, so each one is news.
 */
export function groupLayoutModelNote(
  data: SessionMessageDataPart.GroupLayoutDataPart,
) {
  if (isChatAlone(data)) {
    return systemNote`
      Your tab group is just you now.
    `;
  }
  const isTwo = data.sides.length === 2;
  const yours = data.sides.findIndex(({ tabs }) =>
    tabs.some((tab) => tab.isThisChat),
  );
  const you = data.sides[yours]?.tabs.find((tab) => tab.isThisChat);
  const where = [
    ...(isTwo && yours !== -1 ? [SIDE_NAMES[yours]] : []),
    ...(you ? [you.isUp ? "in front" : "behind"] : []),
  ].join(", ");
  const head = where === "" ? "Your group:" : `Your group (you: ${where}):`;
  const lines = data.sides.map(({ tabs }, side) => {
    const line = tabs.map(tabWords).join(" · ");
    return isTwo
      ? `${`${SIDE_NAMES[side] ?? "left"}:`.padEnd(7)}${line}`
      : line;
  });
  const legend = isTwo
    ? `* in front · keyboard: ${SIDE_NAMES[data.focused] ?? "left"}`
    : "* in front";
  return systemNote`
    ${head}
    ${lines.join("\n")}
    ${legend}
    The tabs in front are most likely what the user is looking at.
  `;
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

/** A tab as the layout names it: by its kind where its address does not say, and `*` in front. */
function tabWords(tab: LayoutTab): string {
  return `${layoutTabName(tab)}${tab.isThisChat ? " (you)" : ""}${tab.isUp ? "*" : ""}`;
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
