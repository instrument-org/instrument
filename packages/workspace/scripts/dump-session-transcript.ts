import "./lib/define-globals-apply";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseArgs,
} from "node:util";
import {
  ulid,
} from "ulid";

import {
  createAppConfig,
} from "../src/lib/app-config/create";
import {
  extractProjectZip,
} from "../src/lib/extract-project-zip";
import {
  getProjectManifest,
} from "../src/lib/project-manifest";
import {
  getSessionMarkdown,
} from "../src/lib/session-to-markdown";
import {
  Store,
} from "../src/lib/store";
import {
  setWorkspaceConfig,
} from "../src/lib/workspace-config";
import {
  AbsolutePathSchema,
  TaskDirSchema,
} from "../src/schemas/paths";
import {
  TaskIdSchema,
} from "../src/schemas/task-id";
import {
  createStubWorkspaceConfig,
} from "./lib/stub-workspace-config";

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
      "Usage: pnpm run script:dump-session-transcript <project-dir-or.zip>",
      "  [--output <file>] [--include-context]",
    ].join("\n"),
  );
}

const absoluteInputPath = path.resolve(inputPath);
const inputStats = await fs.stat(absoluteInputPath);
const isZip = inputStats.isFile() && absoluteInputPath.endsWith(".zip");

let cleanupDir: string | undefined;
let dir = TaskDirSchema.parse(absoluteInputPath);
let projectsDir = path.dirname(dir);

if (isZip) {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "instrument-transcript-"),
  );
  cleanupDir = tempRoot;
  projectsDir = path.join(tempRoot, "projects");
  const folderName = `transcript-${ulid().toLowerCase()}`;
  const extractDir = AbsolutePathSchema.parse(
    path.join(projectsDir, folderName),
  );
  const zipBlob = new Blob([await fs.readFile(absoluteInputPath)]);
  ({ dir } = await extractProjectZip({ outputDir: extractDir, zipBlob }));
}

const manifest = await getProjectManifest(dir);
const folderName = path.basename(dir);
const subdomain = TaskIdSchema.parse(folderName);
setWorkspaceConfig(createStubWorkspaceConfig({ projectsDir }));
const appConfig = createAppConfig({ subdomain });

const sessionsResult = await Store.getSessions(appConfig, {
  includeChildSessions: true,
});
if (sessionsResult.isErr()) {
  throw new Error(
    `Failed to load sessions from ${path.join(dir, ".instrument", "sessions.db")}: ${sessionsResult.error.message}`,
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
  appConfig,
  frontMatter: {
    projectName: manifest?.name ?? folderName,
    sessionId: rootSession.id,
    sessionTitle: rootSession.title,
    source: isZip ? absoluteInputPath : dir,
  },
  includeContextMessages,
  sessionId: rootSession.id,
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
