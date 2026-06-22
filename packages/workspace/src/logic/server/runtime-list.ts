import { html } from "hono/html";
import path from "node:path";

import { getTasks } from "../../lib/get-tasks";
import { taskDir } from "../../lib/task-dir-utils";
import { localhostUrl } from "../../lib/url-for-subdomain";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type RuntimeActorRef } from "../../machines/runtime";
import { type Task } from "../../schemas/task";
import { type TaskId } from "../../schemas/task-id";
import { type WorkspaceConfig } from "../../types";
import { getWorkspaceServerPort } from "./url";

interface TaskAndStatus {
  port?: number;
  status: string;
  task: Task;
  taskId: TaskId;
}

export async function RuntimeList({
  runtimeRefs,
  workspaceConfig,
}: {
  runtimeRefs: Map<TaskId, RuntimeActorRef>;
  workspaceConfig: WorkspaceConfig;
}) {
  const { tasks } = await getTasks(workspaceConfig);
  const tasksWithExtra = tasks.map((task) =>
    getTaskWithExtra({
      runtimeRefs,
      task,
    }),
  );

  return html`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <script src="https://cdn.tailwindcss.com"></script>
        <title>Workspace Server</title>
        <script>
          let updateInterval;
          let isLive = true;

          function updateContent() {
            fetch(window.location.href)
              .then((response) => {
                if (!response.ok) {
                  throw new Error("HTTP error! Status: " + response.status);
                }
                return response.text();
              })
              .then((html) => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");
                const newContent = doc.querySelector("#runtime-content");
                const currentContent =
                  document.querySelector("#runtime-content");
                if (currentContent && newContent) {
                  currentContent.innerHTML = newContent.innerHTML;
                }
                // Reset live status if update succeeds
                if (!isLive) {
                  isLive = true;
                  document.getElementById("live-status").style.display = "none";
                }
              })
              .catch((error) => {
                console.error("Failed to update content:", error);
                clearInterval(updateInterval);
                isLive = false;
                document.getElementById("live-status").style.display = "flex";
              });
          }

          updateInterval = setInterval(updateContent, 1000);
        </script>
      </head>
      <body class="bg-neutral-900 text-neutral-100 p-8 font-mono">
        <div
          id="live-status"
          class="fixed top-4 right-4 bg-red-500 text-white px-3 py-1 rounded hidden"
        >
          <span>Updates failed</span>
          <button onclick="window.location.reload()" class="ml-2 underline">
            Refresh
          </button>
        </div>
        <div id="runtime-content" class="max-w-4xl mx-auto">
          <div
            class="flex items-center justify-between mb-6 border-b border-neutral-700 pb-4"
          >
            <h1 class="text-3xl font-bold">Workspace Server</h1>
            ${tasksWithExtra.length > 0
              ? html`<div class="flex items-center gap-3">
                  ${["ready", "loading", "error", "stopped"].map((status) => {
                    const count = tasksWithExtra.filter(
                      (entry) => entry.status === status,
                    ).length;
                    return count > 0
                      ? html`<div class="flex items-center gap-1">
                          <div
                            class="w-2 h-2 rounded-full ${getStatusColor(
                              status,
                            )}"
                          ></div>
                          <span class="text-sm text-neutral-300">${count}</span>
                        </div>`
                      : "";
                  })}
                </div>`
              : ""}
          </div>

          ${tasksWithExtra.length === 0
            ? html`<div
                class="bg-neutral-800 rounded-lg p-6 text-center text-neutral-400 border border-neutral-700"
              >
                <svg
                  class="w-12 h-12 mx-auto mb-3 text-neutral-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  ></path>
                </svg>
                <p>No tasks configured</p>
              </div>`
            : html`<div class="grid gap-4 mb-6">
                ${tasksWithExtra.map(
                  (entry) => html`
                    <div
                      class="bg-neutral-800 rounded-lg p-4 border border-neutral-700 flex items-center justify-between"
                    >
                      <div class="flex items-center">
                        <div
                          class="w-3 h-3 rounded-full ${getStatusColor(
                            entry.status,
                          )} mr-3"
                          title="${entry.status}"
                        ></div>
                        <div class="flex flex-col">
                          <div class="flex items-center gap-2">
                            <a
                              href="${localhostUrl(entry.task.id)}"
                              class="text-blue-400 font-medium"
                            >
                              ${entry.task.id}
                            </a>
                            <span
                              class="px-1.5 py-0.5 text-xs rounded bg-green-500"
                            >
                              task
                            </span>
                          </div>
                          <span class="text-xs text-neutral-400">
                            ${path.relative(
                              getWorkspaceConfig().rootDir,
                              taskDir(entry.taskId),
                            )}
                          </span>
                        </div>
                      </div>
                      <div class="flex items-center space-x-2">
                        <span
                          class="px-2 py-1 text-xs rounded bg-neutral-700 text-neutral-300"
                        >
                          ${entry.status}
                        </span>
                        ${entry.port
                          ? html`
                              <span
                                class="px-2 py-1 text-xs rounded bg-blue-900 text-blue-300"
                              >
                                port:${entry.port}
                              </span>
                            `
                          : ""}
                      </div>
                    </div>
                  `,
                )}
              </div>`}

          <div
            class="mt-8 pt-4 border-t border-neutral-700 text-xs text-neutral-500 flex flex-wrap justify-between"
          >
            <span>Last updated: ${new Date().toLocaleString()}</span>
            <span>Running on port ${getWorkspaceServerPort()}</span>
            <span class="w-full text-center mt-2"
              >Auto-refreshing every 1s</span
            >
          </div>
        </div>
      </body>
    </html>
  `;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "error": {
      return "bg-red-500";
    }
    case "loading": {
      return "bg-yellow-500";
    }
    case "ready": {
      return "bg-green-500";
    }
    case "stopped": {
      return "bg-neutral-500";
    }
    default: {
      return "bg-neutral-500";
    }
  }
}

function getTaskWithExtra({
  runtimeRefs,
  task,
}: {
  runtimeRefs: Map<TaskId, RuntimeActorRef>;
  task: Task;
}): TaskAndStatus {
  const runtimeRef = runtimeRefs.get(task.id);
  const runtimeSnapshot = runtimeRef?.getSnapshot();
  const port = runtimeSnapshot?.context.port;
  const status = runtimeSnapshot
    ? ([...runtimeSnapshot.tags.values()][0] ?? "stopped")
    : "stopped";

  return {
    port,
    status,
    task,
    taskId: task.id,
  };
}
