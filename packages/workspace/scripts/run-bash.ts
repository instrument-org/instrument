/**
 * Runs commands in the same just-bash sandbox the agent uses. Useful for
 * validating bash environment fixes without booting Studio.
 *
 * Usage:
 *   pnpm script:run-bash                               # interactive REPL
 *   pnpm script:run-bash -- "echo hello"               # one-shot; exits with command's exit code
 *   pnpm script:run-bash -- "echo hello" "ls work/"    # sequential commands in one chat's work folder
 *   pnpm script:run-bash -- --bail "setup" "verify"    # stop after first failure
 *   pnpm script:run-bash -- --task <id> "ls work/"     # one-shot against an existing chat
 *   pnpm script:run-bash -- --chats-dir /path/to/chats # REPL with custom chats root
 *   pnpm script:run-bash -- --attach /some/dir "ls /some/dir" # reach a folder read-only at its own path
 *   pnpm script:run-bash -- --attach-writable /some/dir "..." # reach it read-write instead
 *
 * Header/metadata always go to stderr so stdout stays clean for agent use.
 */

import "./lib/dev-node-env";

import "dotenv/config";

import "./lib/define-globals-apply";

import { noopModelCache } from "@instrument-org/ai-gateway";
import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { execa } from "execa";
import { createRequire } from "node:module";
import { makeToolBinIn } from "./lib/tool-bin-dir";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { ulid } from "ulid";

import { CHAT_FOLDER_NAMES } from "../src/constants";
import { createMemoryAppsConfig } from "../src/lib/apps/memory-config";
import { setBashWorkerFactory } from "../src/lib/bash-worker/client";
import { createBashEnv } from "../src/lib/create-bash-env";
import { placeChat, resolveChat } from "../src/lib/record-folders";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { workspaceLayout } from "../src/lib/workspace-layout";
import { MountedFolder } from "../src/schemas/mounted-folder";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../src/schemas/paths";
import { StoreId } from "../src/schemas/store-id";
import { ChatIdSchema } from "../src/schemas/chat-id";
import { unavailableWebSearchClient } from "../src/schemas/web-search";
import { createStubBrowserConfig } from "../src/test/helpers/mock-chat-config";
import { createTsxBashWorker } from "../src/test/helpers/tsx-bash-worker";

function parseArgs(argv: string[]) {
  const attach: {
    access: MountedFolder.Access;
    path: string;
  }[] = [];
  let bail = false;
  const commands: string[] = [];
  let chatId: string | undefined;
  let chatsDir: string | undefined;

  const remaining = [...argv];
  while (remaining.length > 0) {
    const arg = remaining.shift();
    switch (arg) {
      case "--attach": {
        const dir = remaining.shift();
        if (dir) {
          attach.push({
            access: "read-only",
            path: path.resolve(dir),
          });
        }

        break;
      }
      case "--attach-writable": {
        const dir = remaining.shift();
        if (dir) {
          attach.push({
            access: "read-write",
            path: path.resolve(dir),
          });
        }

        break;
      }
      case "--bail": {
        bail = true;

        break;
      }
      case "--task": {
        chatId = remaining.shift();

        break;
      }
      case "--chats-dir": {
        chatsDir = remaining.shift();

        break;
      }
      default: {
        if (arg !== undefined && !arg.startsWith("-")) {
          commands.push(arg);
        }
      }
    }
  }

  return { attach, bail, chatsDir, commands, chatId };
}

const args = parseArgs(process.argv.slice(2));

const rootDir = path.resolve(os.tmpdir(), "instrument-bash-repl");
const layout = workspaceLayout(rootDir);
const chatsDir = args.chatsDir ? path.resolve(args.chatsDir) : layout.chatsDir;
// Outside the workspace, as the app keeps this computer's folder for it.
const machineDir = path.resolve(os.tmpdir(), "instrument-bash-repl-machine");
const workFoldersDir = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.work);

const runtimeDir = path.join(rootDir, "runtime");

await fs.mkdir(chatsDir, { recursive: true });
makeToolBinIn(runtimeDir);

const uvBinPath = AbsolutePathSchema.parse(
  await execa({ reject: false })`which uv`.then(
    ({ stdout }) => stdout.trim() || "/usr/bin/uv",
  ),
);

setWorkspaceConfig({
  apps: createMemoryAppsConfig(),
  appsDir: AbsolutePathSchema.parse(layout.appsDir),
  appVersion: "0.0.0-repl",
  browser: createStubBrowserConfig(),
  captureException: () => {
    return;
  },
  chatTemplateDir: AbsolutePathSchema.parse(
    path.join(rootDir, "chat-template"),
  ),
  getAIProviderConfigs: () => [],
  modelCache: noopModelCache,
  nodeExecEnv: {},
  nativeSandbox: true,
  // The pnpm the app ships, as its JS entry, which the workspace runs with
  // node: a shell shim from PATH is neither JS nor readable in the sandbox.
  pnpmBinPath: AbsolutePathSchema.parse(
    path.join(
      path.dirname(
        createRequire(
          path.resolve(
            import.meta.dirname,
            "../../../apps/studio/package.json",
          ),
        ).resolve("pnpm"),
      ),
      "bin",
      "pnpm.mjs",
    ),
  ),
  registryDir: WorkspaceDirSchema.parse(path.join(rootDir, "registry")),
  rootDir: WorkspaceDirSchema.parse(rootDir),
  runtimeDir: AbsolutePathSchema.parse(runtimeDir),
  systemSkillsDir: AbsolutePathSchema.parse(
    path.join(rootDir, "system-skills"),
  ),
  chatsDir: AbsolutePathSchema.parse(chatsDir),
  legacyTasksDir: AbsolutePathSchema.parse(path.join(rootDir, "tasks")),
  trashItem: () => Promise.resolve(),
  uvBinPath,
  webSearch: unavailableWebSearchClient,
  workFoldersDir: AbsolutePathSchema.parse(workFoldersDir),
  workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
});

// On this thread unless INSTRUMENT_BASH_WORKER=1 asks for the bash worker.
if (process.env.INSTRUMENT_BASH_WORKER === "1") {
  setBashWorkerFactory(createTsxBashWorker);
}

const chatId = ChatIdSchema.parse(args.chatId ?? ulid().toLowerCase());

const chatDir = path.join(chatsDir, chatId);
const workDir = path.join(workFoldersDir, chatId);
// The record folder with somewhere for attachments, and the work folder with
// the `work/` the template normally scaffolds, which the repl skips.
await fs.mkdir(path.join(chatDir, CHAT_FOLDER_NAMES.attachments), {
  recursive: true,
});
await fs.mkdir(path.join(workDir, CHAT_FOLDER_NAMES.work), { recursive: true });
const sessionId = StoreId.newSessionId();
// The shell finds its folder through the chat index, which the repl's folder,
// made by hand, is put in.
if (resolveChat(chatId) === undefined) {
  placeChat(chatId, sessionId);
}

const attached = args.attach.map((folder, index) => ({
  ...folder,
  id: MountedFolder.IdSchema.parse(`attach-${index}`),
}));
const folders = Object.fromEntries(
  attached.map((folder): [string, MountedFolder.Type] => {
    const hostPath = AbsolutePathSchema.parse(folder.path);
    return [hostPath, { access: folder.access, id: folder.id, path: hostPath }];
  }),
);

const bash = await createBashEnv({
  folders,
  sessionId,
  chatId,
});

process.stderr.write(
  `work folder: ${workDir}\nrecord folder: ${chatDir}\nchat: ${chatId}  session: ${sessionId}\n\n`,
);

// The exit is explicit, so nothing a command left running (a background job,
// a pooled worker) holds the process open, and waits for both pipes
// (asynchronous on macOS) to drain.
function exit(exitCode: number) {
  process.stdout.write("", () => {
    process.stderr.write("", () => process.exit(exitCode));
  });
}

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
  exit(await runCommands(args.commands, { bail: args.bail }));
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
  exit(exitCode);
}
