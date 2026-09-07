import { defineCommand } from "just-bash";
import { ulid } from "ulid";

import { MOUNT } from "../../mount-points";
import { publisher } from "../../rpc/publisher";
import { type TaskId } from "../../schemas/task-id";
import { isUnder } from "../path-containment";

const OPEN_NAME = "open";

export const OPEN_COMMAND = {
  description: `Put a page or a file on the user's screen, as a tab of the window: \`${OPEN_NAME} https://...\` opens the page in a tab of its own and prints the tab's id, which a task takes with --tab; \`${OPEN_NAME} ${MOUNT.attachedFolders}/<folder>/report.md\` or \`${OPEN_NAME} ${MOUNT.tasks}/<id>/output/report.md\` opens the file. Several arguments open several tabs. It opens nothing in the user's own applications and downloads nothing.`,
  name: OPEN_NAME,
} as const;

/**
 * How long a page waits for the window to name the tab it made. The window
 * answers in milliseconds; the wait is for a conversation with no window on
 * it (an eval), where nothing ever answers and the page is still "opened".
 */
const TAB_ID_TIMEOUT_MS = 2000;

/**
 * The conversation's way of putting something in front of the user: the
 * window listens for what it asks to open and makes the tab. The command
 * itself only checks that a path names a file the window can show, under the
 * user's folders or a task's, and says so for each argument. For a page it
 * also waits for the window to say which tab it made, since the id is what a
 * task needs to be handed the tab, and the next message's note is otherwise
 * the first place the conversation could learn it.
 */
export function createOpenCommand({
  tabIdTimeoutMs = TAB_ID_TIMEOUT_MS,
  taskId,
}: {
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
        const tabId = await openPage({
          taskId,
          timeoutMs: tabIdTimeoutMs,
          url: arg,
        });
        opened.push(tabId === undefined ? arg : `${arg} (tab ${tabId})`);
        continue;
      }
      const virtualPath = ctx.fs.resolvePath(ctx.cwd, arg);
      if (
        !isUnder(MOUNT.attachedFolders, virtualPath) &&
        !isUnder(MOUNT.tasks, virtualPath)
      ) {
        failures.push(
          `${OPEN_NAME}: "${arg}" is not a page, and not a file under ${MOUNT.attachedFolders} or ${MOUNT.tasks}, which are the files the window can show.`,
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
      if (!stat.isFile) {
        failures.push(
          stat.isDirectory
            ? `${OPEN_NAME}: "${arg}" is a folder; name a file inside it.`
            : `${OPEN_NAME}: "${arg}" is not a file.`,
        );
        continue;
      }
      publisher.publish("orchestrator.open", {
        id: taskId,
        target: { kind: "file", mount: virtualPath },
      });
      opened.push(virtualPath);
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

/**
 * Ask the window for a tab at the page and wait for the tab's id, or for the
 * wait to run out. The answer is listened for before the ask goes out, so a
 * window that answers at once is not missed.
 */
async function openPage({
  taskId,
  timeoutMs,
  url,
}: {
  taskId: TaskId;
  timeoutMs: number;
  url: string;
}): Promise<string | undefined> {
  const requestId = ulid();
  const controller = new AbortController();
  const answers = publisher.subscribe("orchestrator.opened", {
    signal: controller.signal,
  });
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  publisher.publish("orchestrator.open", {
    id: taskId,
    target: { kind: "page", requestId, url },
  });
  try {
    for await (const answer of answers) {
      if (answer.requestId === requestId) {
        return answer.tabId;
      }
    }
  } catch {
    // The wait ran out: the page is open wherever a window is showing it,
    // and only its id is missing.
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return undefined;
}
