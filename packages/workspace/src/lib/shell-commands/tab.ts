import { defineCommand } from "just-bash";

import { MOUNT } from "../../mount-points";
import { StoreId } from "../../schemas/store-id";
import {
  type WindowTabAction,
  type WindowTabTarget,
} from "../../schemas/window-tab";
import { encodeBrowserTargetId } from "../../types";
import { noteBrowserAgentActivity } from "../browser-agent-activity";
import { WINDOW_ID } from "../../schemas/window-id";
import {
  askWindow,
  tabHolders,
  WINDOW_TAB_TIMEOUT_MS,
} from "../chat/window-tab";
import { isUnder } from "../path-containment";
import {
  defineSubcommands,
  type SubcommandShell,
  subcommand,
} from "./subcommands";
import { TAB_COMMAND } from "./tab-command";
import { type ChatId } from "../../schemas/chat-id";

const TAB_NAME = TAB_COMMAND.name;

const NO_WINDOW = "the window did not answer, so no tab changed.";

const USAGE = `Usage: ${TAB_NAME} open <url or path>... | ${TAB_NAME} replace <id> <url or path> | ${TAB_NAME} close <id>... | ${TAB_NAME} show <id>`;

/**
 * The conversation's hands on the window's tabs. The window keeps the tabs
 * and does the work; the command checks what it can on this side (that a
 * path is one the window can show, which task is at work in a tab) and
 * reports, one line per tab, what the window did.
 *
 * Every ask names the chat the command ran in, when it ran in one, so a tab
 * opened goes beside that chat and an id is looked up among that chat's tabs.
 */
export function createTabCommand({
  chatId,
  timeoutMs = WINDOW_TAB_TIMEOUT_MS,
}: {
  chatId: ChatId;
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

  const runTab = defineSubcommands<undefined>({
    name: TAB_NAME,
    subcommands: {
      close: subcommand({ run: ({ positional }) => close(positional) }),
      open: subcommand({
        run: ({ positional }, _, ctx) => open(positional, ctx),
      }),
      replace: subcommand({
        run: ({ positional }, _, ctx) => replace(positional, ctx),
      }),
      show: subcommand({ run: ({ positional }) => show(positional) }),
    },
    usage: USAGE,
  });

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
        failures.push(`${TAB_NAME}: ${NO_WINDOW}`);
      } else if (answer.error) {
        failures.push(`${TAB_NAME}: ${answer.error}`);
      } else {
        lines.push(`Closed tab ${tabId}.${holder}`);
      }
    }
    return report(lines, failures);
  }

  async function open(rest: string[], ctx: SubcommandShell) {
    if (rest.length === 0) {
      return fail(`nothing to open. ${USAGE}`);
    }
    const lines: string[] = [];
    const failures: string[] = [];
    for (const arg of rest) {
      const target = await targetOf(arg, ctx);
      if ("error" in target) {
        failures.push(target.error);
        continue;
      }
      const answer = await ask({ kind: "open", show: true, target });
      if (answer?.error) {
        failures.push(`${TAB_NAME}: ${answer.error}`);
        continue;
      }
      const tabId = answer?.tabId;
      noteOpenedPage(tabId);
      // With no window to answer the page still counts as opened: it is
      // the tab's id that is missing, not the page.
      lines.push(
        `Opened ${describeTarget(target)}${tabId ? ` (tab ${tabId})` : ""}`,
      );
    }
    return report(lines, failures);
  }

  async function replace(rest: string[], ctx: SubcommandShell) {
    const [tabId, arg, ...extra] = rest;
    if (!tabId || !arg || extra.length > 0) {
      return fail(`replace takes one tab id and one url or path. ${USAGE}`);
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

  async function show(rest: string[]) {
    const [tabId, ...extra] = rest;
    if (!tabId || extra.length > 0) {
      return fail(`show takes one tab id. ${USAGE}`);
    }
    const answer = await ask({ kind: "show", tabId });
    if (!answer) {
      return fail(NO_WINDOW);
    }
    if (answer.error) {
      return fail(answer.error);
    }
    return {
      exitCode: 0,
      stderr: "",
      stdout: `Tab ${tabId} is on the user's screen.\n`,
    };
  }

  return defineCommand(TAB_COMMAND.name, (args, ctx) =>
    runTab(args, undefined, ctx),
  );
}

function describeTarget(target: WindowTabTarget) {
  return target.kind === "page" ? (target.url ?? "a new page") : target.mount;
}

function fail(message: string) {
  return { exitCode: 1, stderr: `${TAB_NAME}: ${message}\n`, stdout: "" };
}

function isUrl(arg: string): boolean {
  return arg.startsWith("http://") || arg.startsWith("https://");
}

/** The agent opening a page is its first work in it, which the tab's working mark shows from the start. */
function noteOpenedPage(tabId: string | undefined) {
  const session = StoreId.SessionSchema.safeParse(tabId);
  if (!session.success) {
    return;
  }
  noteBrowserAgentActivity(
    WINDOW_ID,
    encodeBrowserTargetId(WINDOW_ID, session.data),
  );
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
  const virtualPath = ctx.fs.resolvePath(ctx.cwd, arg);
  if (
    !isUnder(MOUNT.attachedFolders, virtualPath) &&
    !isUnder(MOUNT.tasks, virtualPath)
  ) {
    return {
      error: `${TAB_NAME}: "${arg}" is not a page, and not under ${MOUNT.attachedFolders} or ${MOUNT.tasks}, which are the files and folders the window can show.`,
    };
  }
  let stat;
  try {
    stat = await ctx.fs.stat(virtualPath);
  } catch {
    return { error: `${TAB_NAME}: "${arg}" does not exist.` };
  }
  if (!stat.isFile && !stat.isDirectory) {
    return { error: `${TAB_NAME}: "${arg}" is not a file or a folder.` };
  }
  return {
    kind: "path",
    mount: stat.isDirectory ? `${virtualPath}/` : virtualPath,
  };
}
