import { execa } from "execa";
import path from "node:path";
import readline from "node:readline/promises";

import { TASKS_DIR_NAME } from "../src/constants";
import { getTasks } from "../src/lib/get-tasks";
import { Store } from "../src/lib/store";
import { createStubWorkspaceConfig } from "./lib/stub-workspace-config";

const workspaceDir = process.argv[2];

if (!workspaceDir) {
  throw new Error("Usage: pnpm run script:dump-sessions <workspace-directory>");
}

const absoluteWorkspaceDir = path.resolve(workspaceDir);

const workspaceConfig = createStubWorkspaceConfig({
  tasksDir: path.join(absoluteWorkspaceDir, TASKS_DIR_NAME),
});

const { tasks } = await getTasks(workspaceConfig, {
  direction: "desc",
  sortBy: "updatedAt",
});

if (tasks.length === 0) {
  throw new Error("No tasks found in workspace");
}

process.stdout.write("\nSelect a task:\n\n");

for (const [index, task] of tasks.entries()) {
  const updatedDate = task.updatedAt.toLocaleDateString();
  process.stdout.write(
    `  ${index + 1}. ${task.title} (${task.id}) - Updated: ${updatedDate}\n`,
  );
}

process.stdout.write("\nEnter task number: ");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const answer = await rl.question("");
rl.close();

const selectedIndex = Number.parseInt(answer.trim(), 10) - 1;

if (
  Number.isNaN(selectedIndex) ||
  selectedIndex < 0 ||
  selectedIndex >= tasks.length
) {
  throw new Error("Invalid selection");
}

const selectedTask = tasks[selectedIndex];

if (!selectedTask) {
  throw new Error("Invalid selection");
}

process.stdout.write(`\nLoading sessions for ${selectedTask.title}...\n`);

const taskId = selectedTask.id;

const sessionIdsResult = await Store.getStoreId(taskId);

if (sessionIdsResult.isErr()) {
  throw new Error(
    `Error getting session IDs: ${sessionIdsResult.error.message}`,
  );
}

const sessionIds = sessionIdsResult.value;

process.stdout.write(`Found ${sessionIds.length} sessions. Loading...\n`);

const sessions = [];

for (const sessionId of sessionIds) {
  const sessionResult = await Store.getSessionWithMessagesAndParts(
    sessionId,
    taskId,
  );

  if (sessionResult.isErr()) {
    throw new Error(
      `Error getting session ${sessionId}: ${sessionResult.error.message}`,
    );
  }

  sessions.push(sessionResult.value);
}

const jsonOutput = JSON.stringify(sessions, null, 2);

execa`pbcopy`.stdin.end(jsonOutput);

process.stdout.write(`\n✓ Copied ${sessions.length} sessions to clipboard!\n`);
