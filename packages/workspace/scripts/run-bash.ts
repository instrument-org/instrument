/**
 * Runs commands in the same just-bash sandbox the agent uses. Useful for
 * validating bash environment fixes without booting Studio.
 *
 * Usage:
 *   pnpm script:run-bash                               # interactive REPL
 *   pnpm script:run-bash -- "echo hello"               # one-shot; exits with command's exit code
 *   pnpm script:run-bash -- "echo hello" "ls work/"    # sequential commands in one task dir
 *   pnpm script:run-bash -- --bail "setup" "verify"    # stop after first failure
 *   pnpm script:run-bash -- --task <id> "ls work/"     # one-shot against existing task dir
 *   pnpm script:run-bash -- --tasks-dir /path/to/tasks # REPL with custom tasks root
 *   pnpm script:run-bash -- --attach /some/dir "ls /mnt" # mount a folder read-only under /mnt
 *
 * Header/metadata always go to stderr so stdout stays clean for agent use.
 */

import "dotenv/config";

import "./lib/define-globals-apply";

import { noopModelCache } from "@instrument-org/ai-gateway";
import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { ulid } from "ulid";

import { assignFolderNames } from "../src/lib/assign-folder-names";
import { createBashEnv } from "../src/lib/create-bash-env";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { FolderAttachment } from "../src/schemas/folder-attachment";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../src/schemas/paths";
import { StoreId } from "../src/schemas/store-id";
import { TaskIdSchema } from "../src/schemas/task-id";
import { createStubBrowserConfig } from "../src/test/helpers/mock-task-config";

function parseArgs(argv: string[]) {
  const attach: string[] = [];
  let bail = false;
  const commands: string[] = [];
  let taskId: string | undefined;
  let tasksDir: string | undefined;

  const remaining = [...argv];
  while (remaining.length > 0) {
    const arg = remaining.shift();
    switch (arg) {
      case "--attach": {
        const dir = remaining.shift();
        if (dir) {
          attach.push(path.resolve(dir));
        }

        break;
      }
      case "--bail": {
        bail = true;

        break;
      }
      case "--task": {
        taskId = remaining.shift();

        break;
      }
      case "--tasks-dir": {
        tasksDir = remaining.shift();

        break;
      }
      default: {
        if (arg !== undefined && !arg.startsWith("-")) {
          commands.push(arg);
        }
      }
    }
  }

  return { attach, bail, commands, taskId, tasksDir };
}

const args = parseArgs(process.argv.slice(2));

const rootDir = path.resolve(os.tmpdir(), "instrument-bash-repl");
const tasksDir = args.tasksDir
  ? path.resolve(args.tasksDir)
  : path.join(rootDir, "tasks");

await fs.mkdir(tasksDir, { recursive: true });

// The workspace machine creates this at boot; without it the /connectors
// mount is skipped (buildBashFs only mounts dirs that exist on disk).
const connectorsDir = path.join(rootDir, "connectors");
await fs.mkdir(connectorsDir, { recursive: true });

const uvBinPath = AbsolutePathSchema.parse(
  await execa({ reject: false })`which uv`.then(
    ({ stdout }) => stdout.trim() || "/usr/bin/uv",
  ),
);

setWorkspaceConfig({
  appVersion: "0.0.0-repl",
  browser: createStubBrowserConfig(),
  captureEvent: () => {
    return;
  },
  captureException: () => {
    return;
  },
  connectors: { getCredential: () => Promise.resolve(null) },
  connectorsDir: AbsolutePathSchema.parse(connectorsDir),
  defaultTaskTemplateDir: AbsolutePathSchema.parse(
    path.join(rootDir, "default-task-template"),
  ),
  getAIProviderConfigs: () => [],
  modelCache: noopModelCache,
  nodeExecEnv: {},
  pnpmBinPath: AbsolutePathSchema.parse(
    await execa({ reject: false })`which pnpm`.then(
      ({ stdout }) => stdout.trim() || "/usr/bin/pnpm",
    ),
  ),
  projectsDir: AbsolutePathSchema.parse(path.join(rootDir, "projects")),
  registryDir: WorkspaceDirSchema.parse(path.join(rootDir, "registry")),
  rootDir: WorkspaceDirSchema.parse(rootDir),
  tasksDir: AbsolutePathSchema.parse(tasksDir),
  trashItem: () => Promise.resolve(),
  uvBinPath,
  uvDataDir: AbsolutePathSchema.parse(path.join(rootDir, "uv-data")),
});

const taskId = TaskIdSchema.parse(args.taskId ?? ulid().toLowerCase());

const taskDir = path.join(tasksDir, taskId);
await fs.mkdir(taskDir, { recursive: true });

const sessionId = StoreId.newSessionId();

const draftFolders = args.attach.map((folderPath) => ({
  createdAt: Date.now(),
  id: FolderAttachment.IdSchema.parse(ulid()),
  path: AbsolutePathSchema.parse(folderPath),
}));
const folderNames = assignFolderNames(draftFolders);
const attachedFolders: Record<string, FolderAttachment.Type> = {};
for (const folder of draftFolders) {
  const name = folderNames.get(folder.id) ?? folder.path;
  attachedFolders[name] = { ...folder, name, source: "user" };
}

const bash = await createBashEnv({
  attachedFolders,
  sessionId,
  taskId,
});

process.stderr.write(
  `task dir: ${taskDir}\ntask: ${taskId}  session: ${sessionId}\n\n`,
);

async function runCommand(cmd: string) {
  const started = performance.now();
  let result;
  try {
    result = await bash.exec(cmd);
  } catch (error) {
    // Mirror the bash tool: just-bash raises some filesystem failures (e.g. a
    // redirect into a read-only mount) as thrown errors instead of exit codes.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.stderr.write(
      `[exit 1 · ${Math.round(performance.now() - started)}ms]\n`,
    );
    return 1;
  }
  const durationMs = Math.round(performance.now() - started);

  if (result.stdout) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }

  process.stderr.write(`[exit ${result.exitCode} · ${durationMs}ms]\n`);
  return result.exitCode;
}

async function runCommands(commands: string[], { bail }: { bail: boolean }) {
  let exitCode = 0;
  for (const command of commands) {
    const commandExitCode = await runCommand(command);
    if (commandExitCode !== 0 && exitCode === 0) {
      exitCode = commandExitCode;
    }
    if (commandExitCode !== 0 && bail) {
      break;
    }
  }
  return exitCode;
}

if (args.commands.length > 0) {
  process.exitCode = await runCommands(args.commands, { bail: args.bail });
} else {
  const isInteractive = process.stdin.isTTY;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "$ ",
    terminal: isInteractive,
  });

  if (isInteractive) {
    process.stderr.write("(cwd is /task; type 'exit' to quit)\n");
    rl.prompt();
  }

  let exitCode = 0;
  for await (const line of rl) {
    const cmd = line.trim();
    if (!cmd) {
      if (isInteractive) {
        rl.prompt();
      }
      continue;
    }
    if (cmd === "exit" || cmd === "quit") {
      break;
    }
    const commandExitCode = await runCommand(cmd);
    if (commandExitCode !== 0 && exitCode === 0) {
      exitCode = commandExitCode;
    }
    if (commandExitCode !== 0 && args.bail) {
      break;
    }
    if (isInteractive) {
      rl.prompt();
    }
  }

  rl.close();
  process.exitCode = exitCode;
}
