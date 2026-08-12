import { defineCommand } from "just-bash";

import { AGENT_FILES_LANGUAGE } from "../../constants";
import { MOUNT } from "../../mount-points";
import { publisher } from "../../rpc/publisher";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { TaskPane } from "../../schemas/task-pane";
import { recordBrowserUse } from "../browser-state";
import { isTaskId } from "../is-task-id";
import { getBrowserSessionDir, taskDir } from "../task-dir-utils";
import { updateTaskPane } from "../task-record";
import { getWorkspaceConfig } from "../workspace-config";
import { privateMountPoint } from "../workspace-fs-layout";

export const SHOW_COMMAND = {
  description: [
    `Show a file or a URL to the user, in the panel beside the conversation. Takes several arguments and opens one tab each, focusing the last.`,
    `Use it for something the user should look at now: a chart just rendered, a report just written, a page worth seeing. It composes with the command that produced the thing, so \`python build.py && show output/chart.png\` is one call.`,
    `It does NOT replace the \`\`\`${AGENT_FILES_LANGUAGE} fence, which is how a reply hands files over and leaves a record in the conversation. A closed panel must not erase what the reply said it produced, so name deliverables in the fence whether or not you show them.`,
    `Paths are yours as you write them elsewhere: task-relative (\`output/report.pdf\`) or under \`${MOUNT.attachedFolders}/\`. An argument starting with http:// or https:// is a URL, and steers the browsing session you already drive rather than opening a separate window. There is one such session, so at most one URL per call; any others are refused.`,
    `It does not open the file in the user's own applications, does not download anything, and does not raise or focus the app's window.`,
  ].join("\n"),
  name: "show",
} as const;

export function createShowCommand({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  return defineCommand(SHOW_COMMAND.name, async (args, ctx) => {
    if (!isTaskId(taskId)) {
      return {
        exitCode: 1,
        stderr: `${SHOW_COMMAND.name}: only available in task contexts.\n`,
        stdout: "",
      };
    }

    if (args.length === 0) {
      return {
        exitCode: 1,
        stderr: `${SHOW_COMMAND.name}: nothing to show. Usage: ${SHOW_COMMAND.name} <path-or-url>...\n`,
        stdout: "",
      };
    }

    const tabs: TaskPane.Tab[] = [];
    const shown: string[] = [];
    const failures: string[] = [];
    let browserUrl: string | undefined;

    for (const arg of args) {
      if (isUrl(arg)) {
        // One browsing session means one page. Silently navigating to the last
        // of several would report every one as shown while showing one, so the
        // extras are refused rather than absorbed.
        if (browserUrl !== undefined) {
          failures.push(
            `${SHOW_COMMAND.name}: "${arg}" not shown. There is one browser, so only one URL can be shown at a time.`,
          );
          continue;
        }
        tabs.push({ type: "browser" });
        browserUrl = arg;
        continue;
      }

      const resolved = await resolveShowPath(arg, ctx);
      if ("error" in resolved) {
        failures.push(`${SHOW_COMMAND.name}: ${resolved.error}`);
        continue;
      }

      tabs.push(TaskPane.fileTab(resolved.filePath));
      shown.push(resolved.filePath);
    }

    // Deliberately unlike the fence, which degrades silently: a fence is a
    // description and a bad line should cost nothing, but this is imperative
    // and the agent should learn it failed. What did resolve is still shown.
    if (tabs.length === 0) {
      return {
        exitCode: 1,
        stderr: `${failures.join("\n")}\n`,
        stdout: "",
      };
    }

    if (browserUrl) {
      const navigated = await navigateTaskBrowser({
        sessionId,
        taskId,
        url: browserUrl,
      });
      if (navigated) {
        failures.push(`${SHOW_COMMAND.name}: ${navigated}`);
        // Focusing the browser on a page that did not load shows the user the
        // previous page and calls it the requested one.
        const index = tabs.findIndex((tab) => tab.type === "browser");
        if (index !== -1) {
          tabs.splice(index, 1);
        }
      } else {
        shown.push(browserUrl);
      }
    }

    // Everything asked for failed, including a navigation that failed after
    // its path-resolving siblings succeeded.
    if (tabs.length === 0) {
      return {
        exitCode: 1,
        stderr: `${failures.join("\n")}\n`,
        stdout: "",
      };
    }

    await updateTaskPane(taskDir(taskId), (pane) =>
      TaskPane.openTabs(pane, tabs),
    );
    publisher.publish("task.stateUpdated", { id: taskId });

    return {
      exitCode: failures.length > 0 ? 1 : 0,
      stderr: failures.length > 0 ? `${failures.join("\n")}\n` : "",
      // One line per opened argument, so the agent has something to check
      // rather than something to assume.
      stdout: shown.map((line) => `Showing ${line}`).join("\n") + "\n",
    };
  });
}

function isUrl(arg: string): boolean {
  return arg.startsWith("http://") || arg.startsWith("https://");
}

/**
 * Point the session's browser at a URL, returning a message when it could not.
 *
 * There is one browser per session, so this steers the one the agent already
 * drives rather than opening a second. `createTarget` is idempotent and returns
 * the live view when there is one.
 */
async function navigateTaskBrowser({
  sessionId,
  taskId,
  url,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
  url: string;
}): Promise<string | undefined> {
  try {
    const { browser } = getWorkspaceConfig();
    const { targetId } = await browser.createTarget(
      taskId,
      sessionId,
      getBrowserSessionDir(),
    );
    // A navigation that never starts resolves rather than throwing, reporting
    // why in `errorText` -- an unresolvable host, a refused connection. Without
    // this the command reports success for a page nobody can see.
    const navigation = await browser.sendCommand(targetId, "Page.navigate", {
      url,
    });
    const errorText = navigationErrorText(navigation);
    if (errorText !== undefined) {
      return `could not open ${url}: ${errorText}`;
    }
    const result = await recordBrowserUse({ sessionId, taskId, url });
    if (result.isErr()) {
      getWorkspaceConfig().captureException(result.error);
    }
    return undefined;
  } catch (error) {
    return `could not open ${url}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** `Page.navigate`'s failure channel, which is a field rather than a throw. */
function navigationErrorText(navigation: unknown): string | undefined {
  if (typeof navigation !== "object" || navigation === null) {
    return undefined;
  }
  const { errorText } = navigation as { errorText?: unknown };
  return typeof errorText === "string" && errorText !== ""
    ? errorText
    : undefined;
}

/**
 * The path the pane stores for an argument, in the same grammar the fence and
 * the file chip use: task-relative, or under the attached-folders mount.
 *
 * Containment is whatever bash already allows, since the argument is resolved
 * through the same virtual filesystem every other command sees; there is
 * nothing new to reason about here beyond refusing the two mounts a reference
 * cannot address.
 */
async function resolveShowPath(
  arg: string,
  ctx: {
    cwd: string;
    fs: {
      exists(path: string): Promise<boolean>;
      resolvePath(cwd: string, path: string): string;
    };
  },
): Promise<{ error: string } | { filePath: string }> {
  const virtualPath = ctx.fs.resolvePath(ctx.cwd, arg);

  const privateDir = privateMountPoint(MOUNT.task);
  if (virtualPath === privateDir || virtualPath.startsWith(`${privateDir}/`)) {
    return { error: `"${arg}" is inside the task's private directory.` };
  }

  const isTaskFile = virtualPath.startsWith(`${MOUNT.task}/`);
  const isMountFile = virtualPath.startsWith(`${MOUNT.attachedFolders}/`);
  if (!isTaskFile && !isMountFile) {
    return {
      error: `"${arg}" is outside the task and the folders the user shared, so there is nothing to show it in.`,
    };
  }

  if (!(await ctx.fs.exists(virtualPath))) {
    return { error: `"${arg}" does not exist.` };
  }

  return {
    filePath: isTaskFile
      ? virtualPath.slice(MOUNT.task.length + 1)
      : virtualPath,
  };
}
