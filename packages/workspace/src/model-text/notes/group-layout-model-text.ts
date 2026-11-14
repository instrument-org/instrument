import {
  type ChangedTab,
  type LayoutChange,
  type LayoutSideName,
  type LayoutTab,
  type LayoutTabKind,
} from "../../schemas/group-layout";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
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

/** Ids are what the `window` command takes; a reply names a tab as the user sees it. */
const BY_TITLE =
  "Tab ids are for commands; in replies, name a tab by its title.";

/**
 * The tab group the chat works in, as it stands now: its sides left to
 * right, each one's tabs in order with the one showing there marked, the
 * side with the keyboard, and this chat among them. Written only when it
 * reads differently from the one before, so each one is news.
 */
export function groupLayoutModelNote(
  data: SessionMessageDataPart.GroupLayoutDataPart,
) {
  const group = `The tab group you work in, ${data.group.id},`;
  if (isChatAlone(data)) {
    return systemNote`
      ${group} is just this chat now.
    `;
  }
  if (data.sides.length === 1) {
    return systemNote`
      ${group} now: one side, its tabs in order, "up" marking the one showing: ${tabsLine(data.sides[0]?.tabs ?? [])}.
      ${BY_TITLE}
    `;
  }
  const sides = data.sides
    .map(
      ({ tabs }, side) =>
        `${side === 0 ? "Left" : "Right"}${side === data.focused ? ", with the keyboard" : ""}: ${tabsLine(tabs)}`,
    )
    .join("\n");
  return systemNote`
    ${group} now: two sides, each its tabs in order, "up" marking the one showing there.
    ${sides}
    ${BY_TITLE}
  `;
}

/** A group that is this chat and nothing else: nothing to say until it had something. */
export function isChatAlone(data: SessionMessageDataPart.GroupLayoutDataPart) {
  return data.sides.every(({ tabs }) => tabs.every((tab) => tab.isThisChat));
}

function tabsLine(tabs: readonly LayoutTab[]): string {
  return tabs.map(tabWords).join("; ");
}

function tabWords(tab: LayoutTab): string {
  const marks = [
    ...(tab.isThisChat ? [] : [tab.id]),
    ...(tab.isUp ? ["up"] : []),
  ];
  const tail = marks.length > 0 ? ` (${marks.join(", ")})` : "";
  return `${named(tab)}${tab.isThisChat || tab.kind === "newChat" ? "" : ` at ${tab.address}`}${tail}`;
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
