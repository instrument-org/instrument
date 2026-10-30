import "./lib/define-globals-apply";

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chatAddressOf } from "@instrument-org/shared";

import { TASKS_DIR_NAME } from "../src/constants";
import { getSessionMarkdown } from "../src/lib/session-to-markdown";
import { ChatReads } from "../src/lib/chat-reads";
import { chatStartedWithApp } from "../src/lib/chat-info";
import { chatDir, loadChatIndex } from "../src/lib/record-folders";
import {
  ChatRecords,
  installChatRecords,
} from "../src/lib/records/chat-records";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { ChatDirSchema } from "../src/schemas/paths";
import { ChatIdSchema } from "../src/schemas/chat-id";
import { chatFolderInWorkspace } from "./lib/loose-chat-folder";
import { createStubWorkspaceConfig } from "./lib/stub-workspace-config";
import { workspaceOfRecord } from "./lib/workspace-of-record";

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

const dir = ChatDirSchema.parse(chatFolderInWorkspace(path.resolve(inputPath)));

// Chats are found by scanning the workspace's `.instrument/chats/`.
const rootDir = workspaceOfRecord(dir);

const folderName = path.basename(dir);
const id = ChatIdSchema.parse(folderName);
const workspaceConfig = createStubWorkspaceConfig({
  rootDir,
  tasksDir: path.join(rootDir, TASKS_DIR_NAME),
});
setWorkspaceConfig(workspaceConfig);
await loadChatIndex();
// Every read of a chat goes through the records a workspace puts in place as
// it opens; this script opens none, so it puts its own there. It only reads.
installChatRecords(
  new ChatRecords({
    app: workspaceConfig.appVersion,
    device: workspaceConfig.deviceId,
    dirOf: chatDir,
  }),
);
const chatId = id;

const sessionsResult = await ChatReads.sessions({
  chatId,
  includeChildSessions: true,
});
if (sessionsResult.isErr()) {
  throw new Error(
    `Failed to read the sessions of ${dir}: ${sessionsResult.error.message}`,
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
    chat: chatAddressOf(chatId),
    source: dir,
    sourceType: "task-directory",
    startedWithApp: (await chatStartedWithApp(chatId)) ?? "unknown",
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
