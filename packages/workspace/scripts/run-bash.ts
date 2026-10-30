/**
 * Runs commands in the same just-bash sandbox the agent uses. Useful for
 * validating bash environment fixes without booting Studio.
 *
 * Usage:
 *   pnpm script:run-bash                               # interactive REPL
 *   pnpm script:run-bash -- "echo hello"               # one-shot; exits with command's exit code
 *   pnpm script:run-bash -- "echo hello > a" "cat a"   # sequential commands in one chat's work folder
 *   pnpm script:run-bash -- --bail "setup" "verify"    # stop after first failure
 *   pnpm script:run-bash -- --task <id> "ls"           # one-shot against an existing chat
 *   pnpm script:run-bash -- --chats-dir /path/to/chats # REPL with custom chats root
 *   pnpm script:run-bash -- --attach /some/dir "ls /some/dir" # reach a folder read-only at its own path
 *   pnpm script:run-bash -- --attach-writable /some/dir "..." # reach it read-write instead
 *   pnpm script:run-bash -- --skill pdf 'echo $INSTRUMENT_SKILL_DIR' # load a skill first, as load_skill does
 *
 * Header/metadata always go to stderr so stdout stays clean for agent use.
 */

import "./lib/dev-node-env";

import "dotenv/config";

import "./lib/define-globals-apply";

import { noopModelCache } from "@instrument-org/ai-gateway";
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
import {
  loadChatIndex,
  placeChat,
  resolveChat,
} from "../src/lib/record-folders";
import { prepareBundledSkills } from "../src/lib/prepare-bundled-skills";
import { getSkillRuntime } from "../src/lib/skill-runtime";
import {
  findSkills,
  getSkillSources,
  resolveSkillName,
} from "../src/lib/skills";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../src/lib/workspace-config";
import { setUpSkill } from "../src/tools/load-skill";
import { claimWorkFolders } from "../src/lib/work-folders";
import { workspaceLayout } from "../src/lib/workspace-layout";
import { MountedFolder } from "../src/schemas/mounted-folder";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../src/schemas/paths";
import { StoreId } from "../src/schemas/store-id";
import { ChatIdSchema } from "../src/schemas/chat-id";
import { unavailableWebSearchClient } from "../src/schemas/web-search";
import { createStubBrowserConfig } from "../src/test/helpers/mock-chat-config";
import { createTsxBashWorker } from "../src/test/helpers/tsx-bash-worker";
import { newDeviceId } from "../src/lib/records/device-id";

function parseArgs(argv: string[]) {
  const attach: {
    access: MountedFolder.Access;
    path: string;
  }[] = [];
  let bail = false;
  const commands: string[] = [];
  let chatId: string | undefined;
  let chatsDir: string | undefined;
  let skill: string | undefined;

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
      case "--skill": {
        skill = remaining.shift();

        break;
      }
      default: {
        if (arg !== undefined && !arg.startsWith("-")) {
          commands.push(arg);
        }
      }
    }
  }

  return { attach, bail, chatsDir, commands, chatId, skill };
}

const args = parseArgs(process.argv.slice(2));

const rootDir = path.resolve(os.tmpdir(), "instrument-bash-repl");
const layout = workspaceLayout(rootDir);
const chatsDir = args.chatsDir ? path.resolve(args.chatsDir) : layout.chatsDir;
// Outside the workspace, as the app keeps this computer's folder for it.
const machineDir = path.resolve(os.tmpdir(), "instrument-bash-repl-machine");
// Settled as a launch settles them, in a home folder of the REPL's own.
const { workFoldersDir } = claimWorkFolders({
  home: path.resolve(os.tmpdir(), "instrument-bash-repl-home"),
  label: () => "bash-repl",
  machineDir,
  workspaceId: () => undefined,
});

const runtimeDir = path.join(rootDir, "runtime");
const repoRoot = path.resolve(import.meta.dirname, "../../..");

await fs.mkdir(chatsDir, { recursive: true });
makeToolBinIn(runtimeDir);

const SEATBELT_LAUNCHER = path.resolve(
  import.meta.dirname,
  "../../../apps/studio/native/mac-helper/.build/bridge/instrument-seatbelt",
);

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
  deviceId: newDeviceId(),
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
  // The skills this checkout ships, as the app reads them.
  registryDir: WorkspaceDirSchema.parse(path.join(repoRoot, "registry")),
  rootDir: WorkspaceDirSchema.parse(rootDir),
  runtimeDir: AbsolutePathSchema.parse(runtimeDir),
  systemSkillsDir: AbsolutePathSchema.parse(
    path.resolve(import.meta.dirname, "../system-skills"),
  ),
  chatsDir: AbsolutePathSchema.parse(chatsDir),
  legacyTasksDir: AbsolutePathSchema.parse(path.join(rootDir, "tasks")),
  trashItem: () => Promise.resolve(),
  uvBinPath,
  // The Seatbelt launcher `pnpm --filter @instrument-org/studio
  // build:mac-helper` builds, so native commands start the way the app's
  // do; without it they start through sandbox-exec.
  ...(await fs
    .access(SEATBELT_LAUNCHER)
    .then(() => ({
      seatbeltHelperPath: AbsolutePathSchema.parse(SEATBELT_LAUNCHER),
    }))
    .catch(() => ({}))),
  // The uutils binaries Studio vendors (`pnpm --filter
  // @instrument-org/studio uutils:download`); without them the shell's GNU
  // text commands stay its own.
  uutilsDir: AbsolutePathSchema.parse(
    path.resolve(import.meta.dirname, "../../../apps/studio/resources/uutils"),
  ),
  uutilsOutsideSandbox: true,
  webSearch: unavailableWebSearchClient,
  workFoldersDir: AbsolutePathSchema.parse(workFoldersDir),
  userDataDir: AbsolutePathSchema.parse(machineDir),
  workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
});
await loadChatIndex();

// On this thread unless INSTRUMENT_BASH_WORKER=1 asks for the bash worker.
if (process.env.INSTRUMENT_BASH_WORKER === "1") {
  setBashWorkerFactory(createTsxBashWorker);
}

const chatId = ChatIdSchema.parse(args.chatId ?? ulid().toLowerCase());

const chatDir = path.join(chatsDir, chatId);
const workDir = path.join(workFoldersDir, chatId);
// The record folder with somewhere for attachments. The work folder is made
// by the first command, as a chat's is.
await fs.mkdir(path.join(chatDir, CHAT_FOLDER_NAMES.attachments), {
  recursive: true,
});
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
  loadedSkillDir: args.skill ? await loadSkill(args.skill) : undefined,
  sessionId,
  chatId,
});

process.stderr.write(
  `work folder: ${workDir}\nrecord folder: ${chatDir}\nchat: ${chatId}  session: ${sessionId}\n\n`,
);

/**
 * What `load_skill` does before the shell names the skill's folder: the
 * shipped skills prepared in the runtime folder, and the skill's
 * environments built. Says where it is and what was set up, on stderr.
 */
async function loadSkill(name: string): Promise<string> {
  const config = getWorkspaceConfig();
  await prepareBundledSkills(config);
  const resolved = resolveSkillName(
    await findSkills(getSkillSources(config)),
    name,
  );
  if (!("skill" in resolved)) {
    throw new Error(`No skill answers to ${name}.`);
  }
  const runtime = getSkillRuntime(resolved.skill.skillDir, name);
  if ("error" in runtime) {
    throw new Error(runtime.error);
  }
  const started = performance.now();
  const { installResults, skillDir } = await setUpSkill({
    chatId,
    runtime,
    skill: resolved.skill,
  });
  process.stderr.write(
    `skill: ${skillDir} (${installResults.map((result) => `${result.runtime} ${result.state}`).join(", ") || "no dependencies"}, ${Math.round(performance.now() - started)}ms)\n`,
  );
  return skillDir;
}

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
