import { app, MessageChannelMain, utilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline";

import { createScopedLogger } from "../lib/electron-logger";
import type { OpenWorkspace } from "../lib/workspaces";
import type { ConnectMessage } from "./protocol";
import { createWorkspaceProcessSupervisor } from "./supervisor";

const log = createScopedLogger("workspaceProcess");

/** Built beside main by electron.vite.config.ts (`buildWorkspaceProcessChild`). */
const CHILD_PATH = path.join(
  import.meta.dirname,
  "../workspace-process/child.js",
);

let supervisor: ReturnType<typeof createWorkspaceProcessSupervisor> | undefined;

/** Whether this launch starts the workspace child (`INSTRUMENT_WORKSPACE_PROCESS=1`). */
export function isWorkspaceProcessEnabled() {
  return process.env.INSTRUMENT_WORKSPACE_PROCESS === "1";
}

/**
 * Forks the workspace's utility process and keeps it running until quit. It
 * hosts nothing yet: the workspace actor still runs in main, and the child
 * only proves the transport (the handshake, `hello`, crash detection, the
 * bounded restart and the quit teardown).
 */
export function startWorkspaceProcess(workspace: OpenWorkspace) {
  if (supervisor) {
    return;
  }
  const name = path.basename(workspace.path);
  // Its name in `app.getAppMetrics()` and `child-process-gone`, which is how
  // a death is told apart from another utility process's. Activity Monitor
  // shows the helper binary's name, not this.
  const serviceName = `Instrument Workspace (${name})`;

  supervisor = createWorkspaceProcessSupervisor({
    log,
    randomNonce: () => randomBytes(16).toString("hex"),
    spawn: ({ nonce }) => {
      const child = utilityProcess.fork(CHILD_PATH, [], {
        serviceName,
        // stdin cannot be configured on a utility process; only these two.
        stdio: ["ignore", "pipe", "pipe"],
      });
      forwardLines(child.stdout, "info");
      forwardLines(child.stderr, "warn");

      const { port1, port2 } = new MessageChannelMain();
      child.postMessage(
        {
          build: app.getVersion(),
          nonce,
          parentPid: process.pid,
          type: "connect",
          workspace: { id: workspace.id, name },
        } satisfies ConnectMessage,
        [port2],
      );
      return {
        kill: () => {
          child.kill();
        },
        onExit: (listener) => {
          child.once("exit", listener);
        },
        get pid() {
          return child.pid;
        },
        port: {
          close: () => port1.close(),
          onClose: (listener) => port1.on("close", listener),
          onMessage: (listener) =>
            port1.on("message", (event) => listener(event.data)),
          postMessage: (message) => port1.postMessage(message),
          start: () => port1.start(),
        },
      };
    },
  });

  const owned = supervisor;
  app.on("child-process-gone", (_event, details) => {
    // The fork's `serviceName` comes back as `name`; `serviceName` here is
    // Chromium's, the same for every Node utility process.
    if (details.type === "Utility" && details.name === serviceName) {
      log.info(
        `Electron says the workspace process ended: ${details.reason} (${details.exitCode})`,
      );
      owned.noteGone(details.reason);
    }
  });
  owned.start();
}

/** Ends the workspace child for quit, within three seconds (`supervisor.ts`). */
export function stopWorkspaceProcess(): Promise<void> {
  return supervisor?.stop() ?? Promise.resolve();
}

function forwardLines(
  stream: NodeJS.ReadableStream | null,
  level: "info" | "warn",
) {
  if (!stream) {
    return;
  }
  createInterface({ input: stream }).on("line", (line) => {
    log[level](`[child] ${line}`);
  });
}
