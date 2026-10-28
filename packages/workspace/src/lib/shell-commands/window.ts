import { defineCommand, type ExecResult } from "just-bash";

import {
  type WindowTabAction,
  type WindowTabTarget,
} from "../../schemas/window-tab";
import { parseBrowserTargetId } from "../../types";
import { noteBrowserAgentActivity } from "../browser-agent-activity";
import {
  askWindow,
  tabHolders,
  WINDOW_TAB_TIMEOUT_MS,
} from "../chat/window-tab";
import { agentPathOfFileUrl, isLocalAddress } from "../local-page-address";
import { getWorkspaceConfig } from "../workspace-config";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import {
  defineSubcommands,
  type SubcommandShell,
  subcommand,
} from "./subcommands";
import { WINDOW_COMMAND, WINDOW_IS_THE_CHATS } from "./window-command";
import { recordRaisedAsk } from "./raised-asks";
import { recordAsk } from "../chat/asks";
import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";

const NAME = WINDOW_COMMAND.name;

const NO_WINDOW = "the window did not answer, so no tab changed.";

const USAGE = `Usage: ${NAME} list | ${NAME} read <id> | ${NAME} show <url, path or id>... | ${NAME} show <url or path> --in <id> | ${NAME} close <id>... | ${NAME} request <id> --reason '<one sentence to the user>'`;

/**
 * What is in front of the person: the chat's tabs in their window. The
 * window keeps the tabs and does the work; the command checks what it can on
 * this side (that a path is one the window can show, which task is at work
 * in a tab) and reports, one line per tab, what the window did.
 *
 * Every ask names the chat the command ran in, so a tab opened goes beside
 * that chat and an id is looked up among that chat's tabs. A task reads the
 * window (`list`, `read`) and changes nothing in it: the chat arranges what
 * the person sees.
 */
export function createWindowCommand({
  callPartId,
  chatId,
  layout,
  role,
  sessionId,
  timeoutMs = WINDOW_TAB_TIMEOUT_MS,
}: {
  /** The bash call it runs in, which a card it raises names as the ask. */
  callPartId?: StoreId.Part;
  chatId: ChatId;
  /** The shell's layout: a local page outside it is not the session's to read. */
  layout: WorkspaceFsLayout;
  /** Whose shell it is: a task's only reads the window. */
  role: "chat" | "task";
  /** The session the command runs in, which a card it raises wakes. */
  sessionId: StoreId.Session;
  timeoutMs?: number;
}) {
  const ask = (action: WindowTabAction) =>
    askWindow({ action, askedBy: chatId, group: chatId, timeoutMs });

  /** Which task is at work in a tab, as a clause for the line that reports what happened to it. */
  const holderClause = async (tabId: string) => {
    const holders = await tabHolders(chatId);
    const holder = holders.get(tabId);
    return holder
      ? ` Task ${holder.id} ("${holder.title}") was working in it; its next browser command tells it so.`
      : "";
  };

  /** A subcommand that changes the window, which a task's shell refuses. */
  const changes = (run: () => Promise<ExecResult | string>) =>
    role === "chat" ? run() : fail(WINDOW_IS_THE_CHATS);

  const runWindow = defineSubcommands<undefined>({
    name: NAME,
    subcommands: {
      close: subcommand({
        run: ({ positional }) => changes(() => close(positional)),
      }),
      list: subcommand({ positional: 0, run: () => list() }),
      request: subcommand({
        flags: ["reason"],
        positional: 1,
        run: (input) =>
          changes(() => request(input.positional[0], input.value("reason"))),
      }),
      read: subcommand({ run: ({ positional }) => read(positional) }),
      show: subcommand({
        flags: ["in"],
        run: (input, _, ctx) =>
          changes(() => {
            const into = input.value("in");
            return into === undefined
              ? show(input.positional, ctx)
              : replace(into, input.positional, ctx);
          }),
      }),
    },
    usage: USAGE,
  });

  /**
   * The chat's tabs, one line each, as what is in the window: the id every
   * other subcommand and `--tab` take, whether it is in front, what it
   * shows, and which task is at work in it.
   */
  async function list() {
    const answer = await ask({ kind: "list" });
    if (!answer) {
      return fail(NO_WINDOW);
    }
    if (answer.error) {
      return fail(answer.error);
    }
    const tabs = answer.tabs ?? [];
    if (tabs.length === 0) {
      return `This chat has no tabs in the window.${role === "chat" ? ` \`${NAME} show <url>\` opens one.` : ""}\n`;
    }
    const holders = await tabHolders(chatId);
    return `${tabs
      .map((tab) => {
        const holder = holders.get(tab.id);
        const shows =
          tab.kind === "page"
            ? tab.title
              ? `${tab.title} · ${tab.url}`
              : tab.url
            : "a screen of the app, not a page";
        return `${tab.id}  ${tab.front ? "in front" : "behind  "}  ${shows}${holder ? `  task ${holder.id} is working in it` : ""}`;
      })
      .join("\n")}\n`;
  }

  /**
   * Asks the user to move a tab of theirs, outside this chat, into it: the
   * page a note on their message showed. The card waits on them above the
   * chat's box, and their answer wakes the chat.
   */
  async function request(tabId: string | undefined, reason?: string) {
    if (!tabId) {
      return fail(`request takes one tab id. ${USAGE}`);
    }
    if (!reason?.trim()) {
      return fail(
        `request needs --reason '<one sentence to the user>', which the card shows them.`,
      );
    }
    const own = await ask({ kind: "list" });
    if (own?.tabs?.some((tab) => tab.id === tabId)) {
      return fail(
        `tab ${tabId} is already this chat's: \`${NAME} read ${tabId}\` reads it, and \`instrument task new --tab ${tabId}\` hands it to a task.`,
      );
    }
    const answer = await ask({ kind: "theirs", tabId });
    if (!answer) {
      return fail(NO_WINDOW);
    }
    const page = answer.tabs?.[0];
    if (answer.error || page?.kind !== "page") {
      return fail(
        `no tab ${tabId} of the user's is open outside this chat. A request names the tab a note on the user's message showed as theirs.`,
      );
    }
    const askId = await recordAsk(
      {
        chatId,
        ...(callPartId && { partId: callPartId }),
        reason: reason.trim(),
        sessionId,
      },
      "tab",
      tabId,
      { page: { title: page.title, url: page.url } },
    );
    recordRaisedAsk(askId);
    return `Asked the user to move tab ${tabId} ("${page.title || page.url}") into this chat. The card shows your reason with Move tab here and Skip. Your turn ends here; their answer wakes you.\n`;
  }

  async function close(rest: string[]) {
    if (rest.length === 0) {
      return fail(`close needs the id of a tab. ${USAGE}`);
    }
    const lines: string[] = [];
    const failures: string[] = [];
    for (const tabId of rest) {
      const holder = await holderClause(tabId);
      const answer = await ask({ kind: "close", tabId });
      if (!answer) {
        failures.push(`${NAME}: ${NO_WINDOW}`);
      } else if (answer.error) {
        failures.push(`${NAME}: ${answer.error}`);
      } else {
        lines.push(`Closed tab ${tabId}.${holder}`);
      }
    }
    return report(lines, failures);
  }

  /**
   * Puts each argument in front, in turn: a tab the chat has by its id comes
   * forward, and a page, file or folder opens in a tab of its own.
   */
  async function show(rest: string[], ctx: SubcommandShell) {
    if (rest.length === 0) {
      return fail(`nothing to show. ${USAGE}`);
    }
    const lines: string[] = [];
    const failures: string[] = [];
    for (const arg of rest) {
      if (isTabId(arg)) {
        const answer = await ask({ kind: "show", tabId: arg });
        if (!answer) {
          failures.push(`${NAME}: ${NO_WINDOW}`);
        } else if (answer.error) {
          failures.push(`${NAME}: ${answer.error}`);
        } else {
          lines.push(`Tab ${arg} is in front.`);
        }
        continue;
      }
      const target = await targetOf(arg, ctx);
      if ("error" in target) {
        failures.push(target.error);
        continue;
      }
      const answer = await ask({ kind: "open", show: true, target });
      if (answer?.error) {
        failures.push(`${NAME}: ${answer.error}`);
        continue;
      }
      const tabId = answer?.tabId;
      noteOpenedPage(tabId);
      // With no window to answer the page still counts as opened: it is
      // the tab's id that is missing, not the page.
      lines.push(
        `Opened ${describeTarget(target)} in front${tabId ? ` (tab ${tabId})` : ""}`,
      );
    }
    return report(lines, failures);
  }

  /** Shows something else in a tab the chat has, in its place. */
  async function replace(tabId: string, rest: string[], ctx: SubcommandShell) {
    const [arg, ...extra] = rest;
    if (!arg || extra.length > 0 || isTabId(arg)) {
      return fail(`--in takes one url or path to show in the tab. ${USAGE}`);
    }
    const target = await targetOf(arg, ctx);
    if ("error" in target) {
      return { exitCode: 1, stderr: `${target.error}\n`, stdout: "" };
    }
    const holder = await holderClause(tabId);
    const answer = await ask({ kind: "replace", tabId, target });
    if (!answer) {
      return fail(NO_WINDOW);
    }
    if (answer.error) {
      return fail(answer.error);
    }
    return {
      exitCode: 0,
      stderr: "",
      // A tab that changes kind, a page becoming a file's tab or the
      // reverse, comes back under a new id, which is the one to use next.
      stdout: `Tab ${tabId} now shows ${describeTarget(target)}${answer.tabId && answer.tabId !== tabId ? `, as tab ${answer.tabId}` : ""}.${holder}\n`,
    };
  }

  async function read(rest: string[]) {
    const [tabId, ...extra] = rest;
    if (!tabId || extra.length > 0) {
      return fail(`read takes one tab id. ${USAGE}`);
    }
    // Checked on both sides of the read, since a page can take its own tab to
    // another file while the window reads it.
    if (showsFileOutside(tabId)) {
      return fail(outsideFile(tabId));
    }
    const answer = await ask({ kind: "read", tabId });
    if (!answer) {
      return fail(NO_WINDOW);
    }
    if (answer.error) {
      return fail(answer.error);
    }
    if (showsFileOutside(tabId)) {
      return fail(outsideFile(tabId));
    }
    const text = answer.text ?? "";
    return {
      exitCode: 0,
      stderr: "",
      stdout: text.endsWith("\n") ? text : `${text}\n`,
    };
  }

  /**
   * Whether a page tab is on a file of this computer the chat's own tools
   * could not read, which the window would otherwise read for it.
   */
  function showsFileOutside(tabId: string): boolean {
    const targetId = parseBrowserTargetId(tabId);
    if (targetId === null) {
      return false;
    }
    const url = getWorkspaceConfig().browser.getTargetUrl(targetId);
    return (
      url !== undefined &&
      isLocalAddress(url) &&
      agentPathOfFileUrl(layout, url) === null
    );
  }

  return defineCommand(NAME, (args, ctx) => runWindow(args, undefined, ctx));
}

function describeTarget(target: WindowTabTarget) {
  return target.kind === "page" ? (target.url ?? "a new page") : target.path;
}

function outsideFile(tabId: string) {
  return `tab ${tabId} shows a file outside your folders, so it can't be read.`;
}

function fail(message: string) {
  return { exitCode: 1, stderr: `${NAME}: ${message}\n`, stdout: "" };
}

/** Whether an argument names a tab rather than a page, file or folder to show. */
function isTabId(arg: string): boolean {
  return /^tab_[0-9A-Za-z]+$/.test(arg);
}

function isUrl(arg: string): boolean {
  return arg.startsWith("http://") || arg.startsWith("https://");
}

/** The agent opening a page is its first work in it, which the tab's working mark shows from the start. */
function noteOpenedPage(tabId: string | undefined) {
  const targetId = parseBrowserTargetId(tabId ?? "");
  if (targetId !== null) {
    noteBrowserAgentActivity(targetId);
  }
}

function report(lines: string[], failures: string[]) {
  return {
    exitCode: failures.length > 0 || lines.length === 0 ? 1 : 0,
    stderr: failures.length > 0 ? `${failures.join("\n")}\n` : "",
    stdout: lines.length > 0 ? `${lines.join("\n")}\n` : "",
  };
}

/**
 * What an argument asks a tab to show: a page by its address, or a file or
 * folder the window can show, by its path. A folder is handed on with the
 * trailing slash that names one everywhere else a path reaches the user, so
 * the window has a single opener to answer with rather than one per kind of
 * thing a path can be.
 */
async function targetOf(
  arg: string,
  ctx: SubcommandShell,
): Promise<WindowTabTarget | { error: string }> {
  if (isUrl(arg)) {
    return { kind: "page", url: arg };
  }
  const path = ctx.fs.resolvePath(ctx.cwd, arg);
  let stat;
  try {
    stat = await ctx.fs.stat(path);
  } catch {
    return { error: `${NAME}: "${arg}" does not exist.` };
  }
  if (!stat.isFile && !stat.isDirectory) {
    return { error: `${NAME}: "${arg}" is not a file or a folder.` };
  }
  return {
    kind: "path",
    path: stat.isDirectory ? `${path}/` : path,
  };
}
