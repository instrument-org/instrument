import "./lib/define-globals-apply";

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { CHATS_DIR_NAME, TASKS_DIR_NAME } from "../src/constants";
import { getSessionMarkdown } from "../src/lib/session-to-markdown";
import { Store } from "../src/lib/store";
import { getChatSettings } from "../src/lib/chat-settings";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { ChatDirSchema } from "../src/schemas/paths";
import { ChatIdSchema } from "../src/schemas/chat-id";
import { createStubWorkspaceConfig } from "./lib/stub-workspace-config";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    output: { short: "o", type: "string" },
    session: { short: "s", type: "string" },
  },
});

const inputPath = positionals[0];
const outputPath = values.output;
// A chat's store holds its own session and each task's, so this names one;
// the chat's own is the default.
const wantedSessionId = values.session;

if (!inputPath) {
  throw new Error(
    [
      "Usage: pnpm run script:dump-session-transcript <task-dir>",
      "  [--output <file>] [--session <id>]",
    ].join("\n"),
  );
}

const dir = ChatDirSchema.parse(path.resolve(inputPath));

// The workspace root is above `chats/<chat>` or a 1.x `tasks/<id>`, and
// chats are found by scanning its `chats/`.
const parts = dir.split(path.sep);
const chatsAt = parts.lastIndexOf(CHATS_DIR_NAME);
const rootDir =
  chatsAt > 0
    ? parts.slice(0, chatsAt).join(path.sep)
    : path.dirname(path.dirname(dir));

const settings = await getChatSettings(dir);
const folderName = path.basename(dir);
const id = ChatIdSchema.parse(folderName);
setWorkspaceConfig(
  createStubWorkspaceConfig({
    rootDir,
    tasksDir: path.join(rootDir, TASKS_DIR_NAME),
  }),
);
const chatId = id;

const sessionsResult = await Store.getSessions(chatId, {
  includeChildSessions: true,
});
if (sessionsResult.isErr()) {
  throw new Error(
    `Failed to load sessions from ${path.join(dir, ".instrument", "task.db")}: ${sessionsResult.error.message}`,
  );
}

const rootSessions = sessionsResult.value.filter(
  (session) => !session.parentId,
);
if (rootSessions.length > 1 && !wantedSessionId) {
  process.stderr.write(
    `Warning: found ${rootSessions.length} root sessions; using the first. Pass --session <id> to pick one:\n${rootSessions.map((session) => `  ${session.id}  ${session.title}`).join("\n")}\n`,
  );
}

const rootSession = wantedSessionId
  ? sessionsResult.value.find((session) => session.id === wantedSessionId)
  : rootSessions[0];
if (!rootSession) {
  throw new Error(
    wantedSessionId
      ? `No session ${wantedSessionId} in ${dir}`
      : `No root session found in ${dir}`,
  );
}

const markdown = await getSessionMarkdown({
  frontMatter: {
    source: dir,
    sourceType: "task-directory",
    taskCreatedWithAppVersion: settings?.createdWithAppVersion ?? "unknown",
    taskName: settings?.name ?? folderName,
    transcriptGeneratedAt: new Date().toISOString(),
  },
  sessionId: rootSession.id,
  chatId,
});

if (outputPath) {
  await fs.writeFile(path.resolve(outputPath), markdown, "utf8");
  process.stdout.write(`Wrote transcript to ${path.resolve(outputPath)}\n`);
} else {
  process.stdout.write(markdown);
}
