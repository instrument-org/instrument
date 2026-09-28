import { defineCommand } from "just-bash";

import { MOUNT } from "../../mount-points";
import { publisher } from "../../rpc/publisher";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { encodeBrowserTargetId } from "../../types";
import { noteBrowserAgentActivity } from "../browser-agent-activity";
import { windowTaskId } from "../orchestrator/ensure";
import {
  requestWindowTab,
  WINDOW_TAB_TIMEOUT_MS,
} from "../orchestrator/window-tab";
import { isUnder } from "../path-containment";

const OPEN_NAME = "open";

export const OPEN_COMMAND = {
  description: `Put a page, a file, or a folder on the user's screen, as a tab of the window: \`${OPEN_NAME} https://...\` opens the page in a tab of its own and prints the tab's id, which a task takes with --tab; \`${OPEN_NAME} ${MOUNT.attachedFolders}/<folder>/report.md\` or \`${OPEN_NAME} ${MOUNT.tasks}/<id>/work/report.md\` opens the file; \`${OPEN_NAME} ${MOUNT.attachedFolders}/<folder>\` opens the folder itself, the way it does in a terminal. Several arguments open several tabs. It opens nothing in the user's own applications and downloads nothing.`,
  name: OPEN_NAME,
} as const;

/**
 * The conversation's way of putting something in front of the user: the
 * window listens for what it asks to open and makes the tab. The command
 * itself only checks that a path is one the window can show, under the user's
 * folders or a task's, and says so for each argument. For a page it also waits
 * for the window to say which tab it made, since the id is what a task needs
 * to be handed the tab, and the next message's note is otherwise the first
 * place the conversation could learn it.
 *
 * A folder is handed on with the trailing slash that names one everywhere
 * else a path reaches the user, so the window has a single opener to answer
 * with rather than one per kind of thing a path can be.
 *
 * Every ask names the thread the command ran in, when it ran in one, so the
 * window can put the tab beside the thread that asked for it.
 */
export function createOpenCommand({
  sessionId,
  tabIdTimeoutMs = WINDOW_TAB_TIMEOUT_MS,
  taskId,
}: {
  sessionId?: StoreId.Session;
  tabIdTimeoutMs?: number;
  taskId: TaskId;
}) {
  return defineCommand(OPEN_COMMAND.name, async (args, ctx) => {
    if (args.length === 0) {
      return {
        exitCode: 1,
        stderr: `${OPEN_NAME}: nothing to open. Usage: ${OPEN_NAME} <url-or-path>...\n`,
        stdout: "",
      };
    }
    const opened: string[] = [];
    const failures: string[] = [];
    for (const arg of args) {
      if (isUrl(arg)) {
        const tabId = await requestWindowTab({
          askedBy: taskId,
          group: sessionId,
          show: true,
          timeoutMs: tabIdTimeoutMs,
          url: arg,
        });
        // The agent opening a page is its first work in it, which the tab's
        // working mark shows from the start.
        const session = StoreId.SessionSchema.safeParse(tabId);
        if (session.success) {
          const windowId = await windowTaskId();
          noteBrowserAgentActivity(
            windowId,
            encodeBrowserTargetId(windowId, session.data),
          );
        }
        opened.push(tabId === undefined ? arg : `${arg} (tab ${tabId})`);
        continue;
      }
      const virtualPath = ctx.fs.resolvePath(ctx.cwd, arg);
      if (
        !isUnder(MOUNT.attachedFolders, virtualPath) &&
        !isUnder(MOUNT.tasks, virtualPath)
      ) {
        failures.push(
          `${OPEN_NAME}: "${arg}" is not a page, and not under ${MOUNT.attachedFolders} or ${MOUNT.tasks}, which are the files and folders the window can show.`,
        );
        continue;
      }
      let stat;
      try {
        stat = await ctx.fs.stat(virtualPath);
      } catch {
        failures.push(`${OPEN_NAME}: "${arg}" does not exist.`);
        continue;
      }
      if (!stat.isFile && !stat.isDirectory) {
        failures.push(`${OPEN_NAME}: "${arg}" is not a file or a folder.`);
        continue;
      }
      const mount = stat.isDirectory ? `${virtualPath}/` : virtualPath;
      publisher.publish("orchestrator.open", {
        id: taskId,
        ...(sessionId ? { sessionId } : {}),
        target: { kind: "path", mount },
      });
      opened.push(mount);
    }
    return {
      exitCode: failures.length > 0 || opened.length === 0 ? 1 : 0,
      stderr: failures.length > 0 ? `${failures.join("\n")}\n` : "",
      // One line per tab made, so the agent has something to check rather
      // than something to assume.
      stdout: opened.map((line) => `Opened ${line}`).join("\n") + "\n",
    };
  });
}

function isUrl(arg: string): boolean {
  return arg.startsWith("http://") || arg.startsWith("https://");
}
