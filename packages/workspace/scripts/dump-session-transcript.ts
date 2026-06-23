import "./lib/define-globals-apply";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ulid } from "ulid";

import { TASKS_DIR_NAME } from "../src/constants";
import { extractTaskZip } from "../src/lib/extract-task-zip";
import { getSessionMarkdown } from "../src/lib/session-to-markdown";
import { Store } from "../src/lib/store";
import { getTaskSettings } from "../src/lib/task-settings";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { AbsolutePathSchema, TaskDirSchema } from "../src/schemas/paths";
import { TaskIdSchema } from "../src/schemas/task-id";
import { createStubWorkspaceConfig } from "./lib/stub-workspace-config";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "include-context": { default: false, type: "boolean" },
    output: { short: "o", type: "string" },
  },
});

const inputPath = positionals[0];
const includeContextMessages = values["include-context"];
const outputPath = values.output;

if (!inputPath) {
  throw new Error(
    [
      "Usage: pnpm run script:dump-session-transcript <task-dir-or.zip>",
      "  [--output <file>] [--include-context]",
    ].join("\n"),
  );
}

const absoluteInputPath = path.resolve(inputPath);
const inputStats = await fs.stat(absoluteInputPath);
const isZip = inputStats.isFile() && absoluteInputPath.endsWith(".zip");

let cleanupDir: string | undefined;
let dir = TaskDirSchema.parse(absoluteInputPath);
let tasksDir = path.dirname(dir);

if (isZip) {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "instrument-transcript-"),
  );
  cleanupDir = tempRoot;
  tasksDir = path.join(tempRoot, TASKS_DIR_NAME);
  const folderName = `transcript-${ulid().toLowerCase()}`;
  const extractDir = AbsolutePathSchema.parse(path.join(tasksDir, folderName));
  const zipBlob = new Blob([await fs.readFile(absoluteInputPath)]);
  ({ dir } = await extractTaskZip({ outputDir: extractDir, zipBlob }));
}

const settings = await getTaskSettings(dir);
const folderName = path.basename(dir);
const id = TaskIdSchema.parse(folderName);
setWorkspaceConfig(createStubWorkspaceConfig({ tasksDir }));
const taskId = id;

const sessionsResult = await Store.getSessions(taskId, {
  includeChildSessions: true,
});
if (sessionsResult.isErr()) {
  throw new Error(
    `Failed to load sessions from ${path.join(dir, ".instrument", "store.db")}: ${sessionsResult.error.message}`,
  );
}

const rootSessions = sessionsResult.value.filter(
  (session) => !session.parentId,
);
if (rootSessions.length > 1) {
  process.stderr.write(
    `Warning: found ${rootSessions.length} root sessions; using the first.\n`,
  );
}

const rootSession = rootSessions[0];
if (!rootSession) {
  throw new Error(`No root session found in ${dir}`);
}

const markdown = await getSessionMarkdown({
  frontMatter: {
    sessionId: rootSession.id,
    sessionTitle: rootSession.title,
    source: isZip ? absoluteInputPath : dir,
    taskName: settings?.name ?? folderName,
  },
  includeContextMessages,
  sessionId: rootSession.id,
  taskId,
});

if (outputPath) {
  await fs.writeFile(path.resolve(outputPath), markdown, "utf8");
  process.stdout.write(`Wrote transcript to ${path.resolve(outputPath)}\n`);
} else {
  process.stdout.write(markdown);
}

if (cleanupDir) {
  await fs.rm(cleanupDir, { force: true, recursive: true });
}
