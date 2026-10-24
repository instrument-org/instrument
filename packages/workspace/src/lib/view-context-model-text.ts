import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { APP_COMMAND } from "./shell-commands/app-command";
import { TAB_COMMAND } from "./shell-commands/tab-command";
import { systemNote } from "./system-note";

type ViewContext = SessionMessageDataPart.ViewContextDataPart;
type ShellPath = (hostPath: string) => string;

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
export function viewContextModelNote(
  data: ViewContext,
  shellPath: ShellPath = (hostPath) => hostPath,
) {
  return `${screenNote(data, shellPath)}${otherChatNote(data)}${chosenNote(data, shellPath)}${tabsNote(data)}`;
}

/** Another chat named beside what was on screen; on its own, the screen note says it. */
function otherChatNote(data: ViewContext) {
  if (!data.chat || data.screen === "chat") {
    return "";
  }
  return systemNote`
    They also had another chat open, ${chatNamed(data.chat)}.
  `;
}

/** Another chat, named and linked, and why nothing in it is the agent's to use. */
function chatNamed(chat: NonNullable<ViewContext["chat"]>) {
  return `"${chat.title}" ([${chat.title}](instrument://chat/${chat.id})): its pages and tabs are that chat's, not yours to read or hand to a task`;
}

/** What the person picked to send with the message, which "this" and "these" take in alongside the screen. */
function chosenNote(data: ViewContext, shellPath: ShellPath) {
  const chosen = data.chosen ?? [];
  if (chosen.length === 0) {
    return "";
  }
  const named = chosen
    .map(
      (entry) =>
        `the ${entry.kind} \`${entry.agentPath ?? shellPath(entry.path)}\``,
    )
    .join("; ");
  return systemNote`
    They chose to send ${chosen.length === 1 ? "this" : "these"} with the message: ${named}. "This", "these" and "it" refer to ${chosen.length === 1 ? "it" : "them"} first, then to what was on screen.
  `;
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

function fileNote(data: ViewContext, shellPath: ShellPath) {
  const { file } = data;
  if (!file) {
    return systemNote`
      When the user sent this, a file was open in the folder view. "This file" and "this" refer to it.
    `;
  }
  const folder = data.folder
    ? ` It sits in \`${data.folder.display}\`, which "this folder" means.`
    : "";
  return systemNote`
    When the user sent this, the folder view showed the file \`${file.agentPath ?? shellPath(file.path)}\` open. "This file", "this" and "it" refer to it.${folder}
  `;
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

/** How a tab a task is working in says so, after its id. */
function heldClause(holder: undefined | { id: string; title: string }) {
  return holder ? `, task ${holder.id} is working in it` : "";
}

function pageNote(data: ViewContext) {
  const { page } = data;
  if (!page) {
    return systemNote`
      When the user sent this, the window showed the Browser with no tab open. "This page" refers to nothing yet, and there is no tab to hand a task until one is opened: \`instrument tab open <url>\` opens one.
    `;
  }
  const title = page.title ? ` "${page.title}"` : "";
  const words = page.selection ? ` Selected on it: "${page.selection}".` : "";
  const focus = page.focus ? ` Their cursor is in ${page.focus}.` : "";
  const shown = page.tabs?.find((other) => other.id === page.tab);
  const theirs = page.tab !== undefined && page.theirs === true;
  const tab =
    page.tab === undefined
      ? ""
      : theirs
        ? `, in their own tab ${page.tab}, outside this chat`
        : ` (this chat's tab ${page.tab}${heldClause(shown?.heldBy)})`;
  const ways =
    theirs && page.tab !== undefined
      ? ` To work in it, open its address in a tab of your own, which has their sign-ins but not what they typed or scrolled to, or \`${TAB_COMMAND.name} request ${page.tab}\` asks them to move this tab into the chat as it stands.`
      : "";
  const others = (page.tabs ?? []).filter((other) => other.id !== page.tab);
  const tabs =
    others.length > 0
      ? `This chat's ${theirs ? "" : "other "}tabs, not on screen: ${others.map((other) => `"${other.title || other.url}" at ${other.url} (tab ${other.id}${heldClause(other.heldBy)})`).join("; ")}.`
      : `This chat has no ${theirs ? "" : "other "}tabs.`;
  return systemNote`
    When the user sent this, the browser showed${title} at ${page.url}${tab}. "This page", "this site", "this" and "here" refer to it.${words}${focus}${ways}
    ${tabs}
  `;
}

function screenNote(data: ViewContext, shellPath: ShellPath) {
  switch (data.screen) {
    case "apps": {
      if (data.app) {
        return systemNote`
          When the user sent this, the window showed the page of the app "${data.app.name}" (slug ${data.app.slug}), which is ${describeStanding(data.app.standing)}. "This app", "this", and "it" refer to it.${data.app.reading ? ` They had "${data.app.reading.title}" open in it; \`${APP_COMMAND.name} call ${data.app.slug} ${data.app.reading.tool} '${data.app.reading.args}'\` reads it, and "this" means that record.` : ""}
        `;
      }
      return systemNote`
        When the user sent this, the window showed the Apps screen: the directory of apps, connected ones first. Nothing in particular is in view unless they name an app.
      `;
    }
    case "browser": {
      return pageNote(data);
    }
    case "conversation": {
      return systemNote`
        When the user sent this, the window showed this conversation, with nothing else in view beside it.
      `;
    }
    case "chat": {
      return data.chat
        ? systemNote`
            When the user sent this, the window showed another chat, ${chatNamed(data.chat)}. "That chat" refers to it.
          `
        : systemNote`
            When the user sent this, the window showed another chat.
          `;
    }
    case "computer": {
      return systemNote`
        When the user sent this, the folder view showed ${folderShown(data)}. "This folder", "here", "in here" and "these" refer to that.
      `;
    }
    case "file": {
      return fileNote(data, shellPath);
    }
    case "home": {
      return systemNote`
        When the user sent this, the window showed a new tab: the box that opens any screen or asks you. Nothing in particular is in view.
      `;
    }
    case "skills": {
      return systemNote`
        When the user sent this, the window showed the Skills screen: every skill a task can load, grouped by where it comes from. Nothing in particular is in view unless they name one.
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

/** The window's tabs, in a line, so \`tab\` has something to act on and "--tab" something to name. */
function tabsNote(data: ViewContext) {
  const tabs = (data.tabs ?? []).slice(0, TABS_NAMED_MAX);
  if (tabs.length === 0 || data.screen === "browser") {
    return "";
  }
  const named = tabs
    .map(
      (tab) =>
        `"${tab.title}" at ${tab.at}${tab.id ? ` (tab ${tab.id}${heldClause(tab.heldBy)})` : ""}`,
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
    When the user sent this, the Tasks screen showed your task "${task.title}" (id ${task.id}), ${standing}. "This task", "this", "it" and "the task" refer to it: steer it with \`instrument task send ${task.id}\`, stop it with \`instrument task stop ${task.id}\`, read it with \`instrument task log ${task.id}\`.
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
