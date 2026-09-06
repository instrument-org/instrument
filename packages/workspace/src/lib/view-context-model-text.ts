import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

type ViewContext = SessionMessageDataPart.ViewContextDataPart;

/** How many tabs a note names before it says how many more there are. */
const TABS_NAMED_MAX = 8;

/**
 * What the user had on screen when they sent the message, whichever screen it
 * was: the page in the browser, the folder or file on This Mac, the task they
 * were looking over the shoulder of, or a screen with nothing on it. "This",
 * "here", "it" and "these" mean what is named here, so a request that points
 * at the screen needs no address, path, or id typed out. Only what is on
 * screen is named; a folder the user left a screen ago is not.
 */
export function viewContextModelNote(data: ViewContext) {
  return `${screenNote(data)}${tabsNote(data)}`;
}

/** An app's standing, in the Apps screen's words, as a clause. */
function describeStanding(standing: string) {
  switch (standing) {
    case "connected": {
      return "connected and ready to use";
    }
    case "declined": {
      return "not connected: the user declined the last ask";
    }
    case "failed": {
      return "not connected: the last attempt failed";
    }
    case "needs-key": {
      return "waiting for a key from the user";
    }
    case "needs-sign-in": {
      return "waiting for the user to sign in";
    }
    case "not-set-up": {
      return "listed in the directory but not set up: it has no folder yet";
    }
    case "stale": {
      return "connected, but its manifest changed since it was tested";
    }
    default: {
      return "set up but not tested yet";
    }
  }
}

function fileNote(data: ViewContext) {
  const { file } = data;
  if (!file) {
    return systemNote`
      When the user sent this, a file was open in the folder view. "This file" and "this" refer to it.
    `;
  }
  const reach = file.mount
    ? `You reach it at \`${file.mount}\`${data.folder?.access === "read-only" ? ", read-only" : ", read and write"}.`
    : "No folder you can reach covers it, so you cannot read it: ask for its folder with request_folder.";
  const folder = data.folder
    ? ` It sits in \`${data.folder.display}\`, which "this folder" means.`
    : "";
  return systemNote`
    When the user sent this, the folder view showed the file \`${file.path}\` open. "This file", "this" and "it" refer to it. ${reach}${folder}
  `;
}

/** Whether the agent can get at that folder, and how. */
function folderReach(data: ViewContext) {
  const { folder } = data;
  if (!folder?.mount) {
    return "No folder you can reach covers it, so you cannot read it or hand it to a task: ask for it with request_folder.";
  }
  const access =
    folder.access === "read-only"
      ? "read-only for you, so ask before promising to change anything in it"
      : "read and write for you";
  return `You reach it at \`${folder.mount}\`, ${access}; a task that should work there gets that path with --folder, :rw when it should write.`;
}

function folderShown(data: ViewContext) {
  const { folder } = data;
  if (!folder) {
    return "a folder";
  }
  const selected =
    folder.selected.length > 0
      ? `, with ${folder.selected.map((entry) => `\`${entry}\``).join(", ")} selected in it`
      : "";
  return `the folder \`${folder.display}\`${selected}`;
}

function pageNote(data: ViewContext) {
  const { page } = data;
  if (!page) {
    return systemNote`
      When the user sent this, the window showed the Browser with no tab open. "This page" refers to nothing yet; your own agent-browser has no tab to drive until one is opened.
    `;
  }
  const title = page.title ? ` "${page.title}"` : "";
  const words = page.selection
    ? `Selected on it: "${page.selection}".`
    : page.text
      ? `It begins: "${page.text}".`
      : "It has no text yet.";
  const focus = page.focus ? ` Their cursor is in ${page.focus}.` : "";
  const tab = page.tab ? ` (tab ${page.tab})` : "";
  const others = (page.tabs ?? []).filter((other) => other.id !== page.tab);
  const tabs =
    others.length > 0
      ? `Other tabs open but not on screen: ${others.map((other) => `"${other.title || other.url}" at ${other.url} (tab ${other.id})`).join("; ")}.`
      : "No other tabs are open.";
  return systemNote`
    When the user sent this, the browser showed${title} at ${page.url}${tab}. "This page", "this site", "this" and "here" refer to it. Your own agent-browser drives this tab, for one-step things on it; a task that should work in it gets it with --tab and its id, and then drives it in the user's sight. Answer from what is quoted here when that is enough. ${words}${focus}
    ${tabs}
  `;
}

function screenNote(data: ViewContext) {
  switch (data.screen) {
    case "apps": {
      if (data.app) {
        return systemNote`
          When the user sent this, the window showed the page of the app "${data.app.name}" (slug ${data.app.slug}), which is ${describeStanding(data.app.standing)}. "This app", "this", and "it" refer to it. A request about the service itself is answered with the app's tools or requests when it is connected; a request to connect it means writing its folder if it has none, then asking with connect_app.
        `;
      }
      return systemNote`
        When the user sent this, the window showed the Apps screen: the directory of apps, connected ones first. Nothing in particular is in view unless they name an app.
      `;
    }
    case "browser": {
      return pageNote(data);
    }
    case "computer": {
      return systemNote`
        When the user sent this, the folder view showed ${folderShown(data)}. "This folder", "here", "in here" and "these" refer to that. ${folderReach(data)}
      `;
    }
    case "discover": {
      return systemNote`
        When the user sent this, the window showed the Discover screen, which has nothing on it yet. Nothing in particular is in view.
      `;
    }
    case "file": {
      return fileNote(data);
    }
    case "home": {
      return systemNote`
        When the user sent this, the window showed Home: the box that opens any screen or asks you. Nothing in particular is in view.
      `;
    }
    case "task": {
      return taskNote(data);
    }
    case "tasks": {
      return tasksNote(data);
    }
  }
}

/** The window's tabs, in a line, so "open" has something to build on and "--tab" something to name. */
function tabsNote(data: ViewContext) {
  const tabs = (data.tabs ?? []).slice(0, TABS_NAMED_MAX);
  if (tabs.length === 0 || data.screen === "browser") {
    return "";
  }
  const named = tabs
    .map(
      (tab) => `"${tab.title}" at ${tab.at}${tab.id ? ` (tab ${tab.id})` : ""}`,
    )
    .join("; ");
  const more =
    (data.tabs?.length ?? 0) > tabs.length
      ? `; and ${(data.tabs?.length ?? 0) - tabs.length} more`
      : "";
  return `\nTabs open in the window: ${named}${more}.`;
}

function taskNote(data: ViewContext) {
  const { task } = data;
  if (!task) {
    return systemNote`
      When the user sent this, the window showed one of your tasks. "This task" and "it" refer to it.
    `;
  }
  const standing =
    task.status === "working"
      ? task.step
        ? `which is working now, on "${task.step}"`
        : "which is working now"
      : "which has finished";
  return systemNote`
    When the user sent this, the Tasks screen showed your task "${task.title}" (id ${task.id}), ${standing}. "This task", "this", "it" and "the task" refer to it: steer it with \`task send ${task.id}\`, stop it with \`task stop ${task.id}\`, read it with \`task log ${task.id}\`.
  `;
}

function tasksNote(data: ViewContext) {
  const tasks = data.tasks ?? [];
  if (tasks.length === 0) {
    return systemNote`
      When the user sent this, the window showed the Tasks screen, with no tasks yet. "These" refers to nothing yet.
    `;
  }
  const rows = tasks
    .map(
      (task) =>
        `"${task.title}" (id ${task.id}, ${task.status === "working" ? (task.step ? `working on "${task.step}"` : "working") : "finished"})`,
    )
    .join("; ");
  return systemNote`
    When the user sent this, the window showed the Tasks screen: your tasks, listed as ${rows}. "These", "them" and "the tasks" refer to that list; "the first one" and the like count down it.
  `;
}
