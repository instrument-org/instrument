import { type ScreenName } from "@/shared/instrument-screens";

import { type Chat, limitedText } from "./chats";

/**
 * The ink of a row's second line: `quiet` for where a tab is, `work` for a
 * chat at work, `ask` for a chat's question, `news` for a reply not yet
 * read, `fail` for what went wrong, and `draft` for words typed in a new tab.
 */
export type LineTone = "ask" | "draft" | "fail" | "news" | "quiet" | "work";

/**
 * What one tab says on its two lines in a sidebar row: its title, and under
 * it `line` in a `tone`. `strong` sets the title in bold while the tab wants
 * a look: its chat asks something or has a reply not yet read.
 */
export interface RowLines {
  line: string;
  strong: boolean;
  title: string;
  tone: LineTone;
}

/** How a page's last load stands, where it is not simply shown. */
export type PageLoad = "failed" | "loading";

/**
 * A chat's two lines: its title over its latest line, the step it is on
 * while it works, its question while it asks, and that it stopped when its
 * last turn failed. The state is the chat's own, so every row showing the
 * chat says the same. A chat the list has not read yet goes by `title`.
 */
export function chatLines(
  chat: Chat | undefined,
  title: string,
  plain: (text: string) => string = (text) => text,
): RowLines {
  const named = chat?.title ?? title;
  const latest = chat?.latest?.text ?? "";
  switch (chat?.status) {
    case "failed": {
      return quiet(named, "Stopped before it finished", "fail");
    }
    case "limited": {
      return quiet(named, limitedText(chat));
    }
    case "waiting": {
      return {
        line: latest || "Waiting on you",
        strong: true,
        title: named,
        tone: "ask",
      };
    }
    case "working": {
      const step = chat.latest?.kind === "step" ? chat.latest.text : undefined;
      return quiet(named, step ?? "Instrument is working", "work");
    }
    default: {
      return chat?.unread === true
        ? { line: plain(latest), strong: true, title: named, tone: "news" }
        : quiet(named, plain(latest));
    }
  }
}

/**
 * A web page's two lines: its title over its site, while it loads "Loading"
 * and the site, and when it could not be reached, that.
 */
export function pageLines(
  title: string,
  url: string | undefined,
  load: PageLoad | undefined,
): RowLines {
  const site = siteOf(url);
  if (load === "failed") {
    return quiet(title, "Can't reach this page", "fail");
  }
  if (load === "loading") {
    return quiet(title, site === "" ? "Loading" : `Loading ${site}`);
  }
  return quiet(title, site);
}

/** A new tab's two lines: New Tab, over the words typed in it so far. */
export function newTabLines(words: string | undefined): RowLines {
  const typed = words?.trim() ?? "";
  return typed === ""
    ? quiet("New Tab", "Nothing open yet")
    : { line: typed, strong: false, title: "New Tab", tone: "draft" };
}

/**
 * What a built-in page's second line says with no part of it open: where
 * the page starts.
 */
export const PAGE_START_LINES = {
  activity: "Everything you did",
  apps: "Your apps",
  browser: "Start page",
  extensions: "Your extensions",
  files: "Home",
  history: "Chats you closed",
  memory: "All memories",
  "release-notes": "What's new",
  settings: "General",
  shortcuts: "Every shortcut",
  skills: "All skills",
} as const satisfies Record<ScreenName, string>;

/** Two quiet lines, or in the tone given. */
export function quiet(
  title: string,
  line: string,
  tone: LineTone = "quiet",
): RowLines {
  return { line, strong: false, title, tone };
}

/** A page's site as a person says it: its host without `www.`. */
export function siteOf(url: string | undefined): string {
  if (!url) {
    return "";
  }
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** What the Active list says a chat is doing, in one word. */
export type ActiveWord = "Asks" | "Replied" | "Working";

/**
 * Where a chat stands in the Active list: waiting on you, then a reply not
 * yet read, then at work. A chat doing none of these, a stopped one among
 * them, is not active.
 */
export function activeWordOf(
  chat: Pick<Chat, "status" | "unread">,
): ActiveWord | undefined {
  if (chat.status === "waiting") {
    return "Asks";
  }
  if (chat.status === "failed" || chat.status === "stopped") {
    return undefined;
  }
  if (chat.unread) {
    return "Replied";
  }
  return chat.status === "working" ? "Working" : undefined;
}

const ACTIVE_ORDER: readonly ActiveWord[] = ["Asks", "Replied", "Working"];

/**
 * The chats the Active list shows, open in a tab or not, those waiting on
 * you first, then those with a reply not yet read, then those at work, the
 * latest first within each. Archived chats are left out.
 */
export function activeChats<
  T extends Pick<
    Chat,
    "archived" | "lastUserMessageAt" | "latest" | "status" | "unread"
  >,
>(chats: readonly T[]): { chat: T; word: ActiveWord }[] {
  const lastAt = (chat: T) =>
    Math.max(chat.lastUserMessageAt, chat.latest?.at ?? 0);
  return chats
    .flatMap((chat) => {
      const word = chat.archived ? undefined : activeWordOf(chat);
      return word === undefined ? [] : [{ chat, word }];
    })
    .toSorted(
      (a, b) =>
        ACTIVE_ORDER.indexOf(a.word) - ACTIVE_ORDER.indexOf(b.word) ||
        lastAt(b.chat) - lastAt(a.chat),
    );
}
