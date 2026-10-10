import "../evals/lib/sandbox-home";
import "./lib/test-node-env";
import "./lib/define-globals-apply";

import path from "node:path";
import { parseArgs } from "node:util";

import { sessionsFor } from "../evals/harness";
import { buildReportWorkspaceConfig } from "../evals/utils";
import { getChatInfos } from "../src/lib/chat-info";
import { sessionOfChat } from "../src/lib/record-folders";
import { WAKE_SUMMARY_MAX_LENGTH } from "../src/lib/chat/wake-summary";
import { getTaskUsageSummary } from "../src/lib/usage-summary";
import { setWorkspaceConfig } from "../src/lib/workspace-config";

/**
 * What each chat's conversation and each task it started handed back, and
 * what that hand-off cost.
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
  throw new Error("Usage: chat-handoff-report.ts <workspace-dir>");
}

const absolute = path.resolve(workspaceRootDir);
setWorkspaceConfig(buildReportWorkspaceConfig(absolute));

const { chats } = await getChatInfos({
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

// Each chat's own conversation, then every task it started, which are the
// other sessions in its store; each read on its own, without what it forked.
for (const chat of chats) {
  const conversation = sessionOfChat(chat.id);
  for (const session of await sessionsFor(chat.id)) {
    const texts = session.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" && part.text.trim() !== "" ? [part.text] : [],
        ),
      );
    const fileWrites = session.messages.flatMap((message) =>
      message.parts.filter(
        (part) =>
          part.type === "tool-write_file" || part.type === "tool-edit_file",
      ),
    ).length;
    const usage = await getTaskUsageSummary(chat.id, {
      sessionId: session.id,
    });
    const last = texts.at(-1) ?? "";
    const isConversation = session.id === conversation;
    rows.push({
      files: fileWrites,
      kind: isConversation ? "conversation" : "task",
      lastReply: last.length,
      name: isConversation ? chat.title : (session.title ?? session.id),
      outputTokens: usage.outputTokens,
      truncated: last.length > WAKE_SUMMARY_MAX_LENGTH,
    });
  }
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
