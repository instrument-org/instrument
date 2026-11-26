import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import { type ChildTask } from "@instrument-org/workspace/client";

import { type ScreenName } from "@/shared/instrument-screens";

import { type WindowTab } from "@/client/atoms/window";

import { type Chat, draftTitle } from "./chats";
import { matchScreen } from "./window-href";

/**
 * The ink of a row's second line: `quiet` for where a tab is, `work` for a
 * chat or a task at work, `ask` for a chat's question, `news` for a reply not yet
 * read, `fail` for what went wrong, and `draft` for words typed in a new tab.
 */
export type LineTone = "ask" | "draft" | "fail" | "news" | "quiet" | "work";

/**
 * What one tab says on its two lines in a sidebar row: its title, and under
 * it `line` in a `tone`. `strong` sets the title in bold while its chat is
 * unread, whatever else the chat says.
 */
export interface RowLines {
  line: string;
  strong: boolean;
  title: string;
  tone: LineTone;
  /** The folders `line` names, outermost first, where it says the way to a file or folder. */
  trail?: readonly string[];
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
  const named = stripMarkdown(chat?.title ?? title);
  const latest = chat?.latest?.text ?? "";
  const strong = chat?.unread === true;
  switch (chat?.status) {
    case "failed": {
      return { ...quiet(named, "Stopped", "fail"), strong };
    }
    case "limited": {
      const line = LIMITED_LINES[chat.stoppedFor ?? "usage"];
      return { ...quiet(named, line), strong };
    }
    case "waiting": {
      return {
        line: latest || "Needs you",
        strong,
        title: named,
        tone: "ask",
      };
    }
    case "working": {
      const step = chat.latest?.kind === "step" ? chat.latest.text : undefined;
      return { ...quiet(named, step ?? "Working", "work"), strong };
    }
    default: {
      return {
        ...quiet(named, plain(latest), strong ? "news" : "quiet"),
        strong,
      };
    }
  }
}

/**
 * A task's two lines: its title over the step it is on while it works, as a
 * chat at work says it, and that it stopped when its last turn failed; else
 * over `line`, where it was started. Never a question: what a task waits on
 * the person for, its chat asks.
 */
export function taskLines(
  task: Pick<ChildTask, "status" | "working"> | undefined,
  title: string,
  line: string,
): RowLines {
  if (task?.working === true) {
    const step = task.status.kind === "running" ? task.status.line : "";
    return quiet(title, step || "Working", "work");
  }
  return task !== undefined && isTaskStopped(task)
    ? quiet(title, "Stopped", "fail")
    : quiet(title, line);
}

/** Whether a task's row says Stopped: no agent of its at work, and its last turn failed. */
export function isTaskStopped(
  task: Pick<ChildTask, "status" | "working">,
): boolean {
  return !task.working && task.status.kind === "failed";
}

/**
 * A web page's two lines: its title over its site, or "Can't connect" when
 * it could not be reached. A load is too brief to name.
 */
export function pageLines(
  title: string,
  url: string | undefined,
  load: PageLoad | undefined,
): RowLines {
  const site = siteOf(url);
  return load === "failed"
    ? quiet(title, "Can't connect", "fail")
    : quiet(title, site);
}

/** A new tab's two lines: New Tab, over the words typed in it so far. */
export function newTabLines(words: string | undefined): RowLines {
  if (words === undefined || words.trim() === "") {
    return quiet("New Tab", "");
  }
  return {
    line: draftTitle(words),
    strong: false,
    title: "New Tab",
    tone: "draft",
  };
}

/**
 * What a built-in page's second line says with no part of it open: the
 * place or view it starts at. Apps, Bookmarks, Extensions and What's new,
 * which start at no part, count what they have or name the version instead
 * (`useRowLines`), and a page that is never a tab says nothing.
 */
export const PAGE_START_LINES = {
  activity: "All",
  apps: "",
  browser: "",
  chats: "",
  bookmarks: "",
  extensions: "",
  files: "Home",
  "release-notes": "",
  settings: "General",
  shortcuts: "",
} as const satisfies Record<ScreenName, string>;

/** A chat stopped short of usage, by why: a label, with the details on the chat itself. */
const LIMITED_LINES = {
  payment: "Payment failed",
  plan: "Needs a plan",
  usage: "Out of usage",
} as const;

/** Two quiet lines, or in the tone given. */
export function quiet(
  title: string,
  line: string,
  tone: LineTone = "quiet",
): RowLines {
  return { line, strong: false, title, tone };
}

/** A file's or folder's two lines: its title over the folders it is in, outermost first. */
export function placeLines(title: string, trail: readonly string[]): RowLines {
  return { ...quiet(title, trail.join(" › ")), trail };
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

/**
 * What a tab stands on, where a second tab on the same thing adds nothing to
 * its group's row: a page's address, a file's path. Any other tab is itself.
 */
function standsOn(tab: WindowTab): string {
  if (tab.kind === "page") {
    return `page:${tab.url ?? tab.openedUrl ?? tab.id}`;
  }
  const screen = matchScreen(tab.href);
  return screen.kind === "computer" && screen.file !== undefined
    ? `file:${screen.file}`
    : `tab:${tab.id}`;
}

/**
 * The tabs of `tabs` a row marks after its lead tab's title: every one but
 * the lead and any other tab on the very thing the lead is on, so one file
 * open twice reads as that file alone.
 */
export function tabsBesideLead(
  tabs: readonly WindowTab[],
  lead: WindowTab,
): WindowTab[] {
  const leadOn = standsOn(lead);
  return tabs.filter((tab) => tab.id !== lead.id && standsOn(tab) !== leadOn);
}
