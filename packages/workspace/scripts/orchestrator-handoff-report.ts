import "../evals/lib/sandbox-home";
import "./lib/test-node-env";
import "./lib/define-globals-apply";

import path from "node:path";
import { parseArgs } from "node:util";

import { sessionsFor } from "../evals/harness";
import { buildReportWorkspaceConfig } from "../evals/utils";
import { getTasks } from "../src/lib/get-tasks";
import { WAKE_SUMMARY_MAX_LENGTH } from "../src/lib/orchestrator/wake-summary";
import { getTaskUsageSummary } from "../src/lib/usage-summary";
import { setWorkspaceConfig } from "../src/lib/workspace-config";

/**
 * What each task in a workspace handed back, and what that hand-off cost.
 *
 * The thing worth watching is the last assistant message of every task the
 * conversation started: what reaches the conversation stops at the wake's
 * ceiling, and everything past that was composed, paid for and thrown away. Read from
 * the stored parts rather than from a rendered transcript, because the render
 * interleaves reasoning and placeholders that are easy to mistake for a reply.
 */
const { positionals } = parseArgs({ allowPositionals: true });
const workspaceRootDir = positionals[0];
if (!workspaceRootDir) {
  throw new Error("Usage: orchestrator-handoff-report.ts <workspace-dir>");
}

const absolute = path.resolve(workspaceRootDir);
setWorkspaceConfig(buildReportWorkspaceConfig(absolute));

const { tasks } = await getTasks(buildReportWorkspaceConfig(absolute), {
  direction: "asc",
  sortBy: "createdAt",
});

const rows: {
  files: number;
  kind: string;
  lastReply: number;
  name: string;
  outputTokens: number;
  truncated: boolean;
}[] = [];

for (const task of tasks) {
  const sessions = await sessionsFor(task.id);
  const texts = sessions.flatMap((session) =>
    session.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" && part.text.trim() !== "" ? [part.text] : [],
        ),
      ),
  );
  const fileWrites = sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.filter(
        (part) =>
          part.type === "tool-write_file" || part.type === "tool-edit_file",
      ),
    ),
  ).length;
  const usage = await getTaskUsageSummary(task.id);
  const last = texts.at(-1) ?? "";
  rows.push({
    files: fileWrites,
    kind: task.parentTaskId ? "task" : "conversation",
    lastReply: last.length,
    name: task.title,
    outputTokens: usage.outputTokens,
    truncated: last.length > WAKE_SUMMARY_MAX_LENGTH,
  });
}

const pad = (value: string, width: number) => value.padEnd(width);
const width = Math.max(...rows.map((row) => row.name.length), 24) + 2;
process.stdout.write(
  `${pad("task", width)}${"kind".padStart(14)}${"last reply".padStart(12)}${"cut?".padStart(6)}${"files".padStart(7)}${"out tok".padStart(9)}\n`,
);
for (const row of rows) {
  process.stdout.write(
    `${pad(row.name, width)}${row.kind.padStart(14)}${String(row.lastReply).padStart(12)}${(row.truncated ? "YES" : "").padStart(6)}${String(row.files).padStart(7)}${String(row.outputTokens).padStart(9)}\n`,
  );
}

const children = rows.filter((row) => row.kind === "task");
if (children.length > 0) {
  const lengths = children.map((row) => row.lastReply).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const cut = children.filter((row) => row.truncated).length;
  process.stdout.write(
    `\n${children.length} tasks; median last reply ${median} chars; ${cut} cut by the ${WAKE_SUMMARY_MAX_LENGTH}-char wake summary\n`,
  );
}
