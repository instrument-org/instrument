import { defineCommand } from "just-bash";

import { MOUNT } from "../../mount-points";
import { publisher } from "../../rpc/publisher";
import { type TaskId } from "../../schemas/task-id";
import { isUnder } from "../path-containment";

const OPEN_NAME = "open";

export const OPEN_COMMAND = {
  description: `Put a page or a file on the user's screen, as a tab of the window: \`${OPEN_NAME} https://...\` opens the page, \`${OPEN_NAME} ${MOUNT.attachedFolders}/<folder>/report.md\` or \`${OPEN_NAME} ${MOUNT.tasks}/<id>/output/report.md\` opens the file. Several arguments open several tabs. A page already open is focused rather than opened again. It opens nothing in the user's own applications and downloads nothing.`,
  name: OPEN_NAME,
} as const;

/**
 * The conversation's way of putting something in front of the user: the
 * window listens for what it asks to open and makes the tab. The command
 * itself only checks that a path names a file the window can show, under the
 * user's folders or a task's, and says so for each argument.
 */
export function createOpenCommand({ taskId }: { taskId: TaskId }) {
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
        publisher.publish("orchestrator.open", {
          id: taskId,
          target: { kind: "page", url: arg },
        });
        opened.push(arg);
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
