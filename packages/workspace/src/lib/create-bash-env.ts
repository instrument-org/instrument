import os from "node:os";
import path from "node:path";
import {
  Bash,
  type Command,
  type CommandName,
  type CommandNode,
  defineCommand,
  getCommandNames,
  getNetworkCommandNames,
  type ScriptNode,
  type SimpleCommandNode,
  type StatementNode,
  type TransformPlugin,
} from "just-bash";
import ms from "ms";
import { dedent } from "radashi";

import { FOLDER_VARIABLES } from "../constants";
import { type MountedFolder } from "../schemas/mounted-folder";
import { type StoreId } from "../schemas/store-id";
import { TOOL_NAMES } from "../tools/name";
import { bashWorkerEnabled, createRemoteBash } from "./bash-worker/client";
import { shellPathReady } from "./login-shell-path";
import { recordSetupTouch } from "./setup-changes";
import {
  type SetupSnapshot,
  setupTouchesBetween,
  snapshotSetup,
} from "./setup-snapshot";
import {
  AGENT_BROWSER_COMMAND,
  agentBrowserCommandDescription,
  createAgentBrowserCommand,
} from "./shell-commands/agent-browser";
import { APP_COMMAND, createAppCommand } from "./shell-commands/app";
import { createXCommand, X_COMMAND } from "./shell-commands/x";
import { answerChannel, type ChannelAnswer } from "./capabilities/channel";
import { scriptSurfaceOpen } from "./capabilities/script-surface";
import { MAX_RUNNING_AGE_MS } from "./shell-commands/background-job-commands";
import {
  createFgCommand,
  createJobsCommand,
  createKillCommand,
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
  type SessionCommandContext,
  WAIT_MARKER,
} from "./shell-commands/background-jobs";
import {
  createInstrumentCommand,
  type InstrumentSubcommand,
} from "./shell-commands/instrument";
import { INSTRUMENT_COMMAND } from "./shell-commands/instrument-command";
import { createDuCommand } from "./shell-commands/du";
import { createFfmpegCommand, FFMPEG_COMMAND } from "./shell-commands/ffmpeg";
import {
  createFfprobeCommand,
  FFPROBE_COMMAND,
} from "./shell-commands/ffprobe";
import { createGitCommand, GIT_COMMAND } from "./shell-commands/git";
import { createMailCommand, MAIL_COMMAND } from "./shell-commands/mail";
import { createMemoryCommand, MEMORY_COMMAND } from "./shell-commands/memory";
import {
  createMessagesCommand,
  MESSAGES_COMMAND,
} from "./shell-commands/messages";
import { createNodeCommand, NODE_COMMAND } from "./shell-commands/node";
import { createNotesCommand, NOTES_COMMAND } from "./shell-commands/notes";
import {
  bundledTextRouteNames,
  createNativeTextCommand,
  nativeTextRoutes,
  routeProgram,
} from "./shell-commands/native-text";
import { withNativeReach } from "./native-sandbox";
import { SHELL_PATH, shellPath } from "./workspace-fs-layout";
import { chatRules, nativeReachFor } from "./permissions/chat-rules";
import { closedAppServices } from "./permissions/apps";
import {
  awaitOurBlocks,
  protectionBlocks,
  reportBlocks,
} from "./permissions/windows-protection";
import { getWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";
import {
  CALENDAR_COMMAND,
  CONTACTS_COMMAND,
  createMacHelperCommand,
} from "./shell-commands/mac-helper";
import {
  createPip3Command,
  createPipCommand,
  PIP3_COMMAND,
  PIP_COMMAND,
} from "./shell-commands/pip";
import {
  createNpxCommand,
  createPnpmCommand,
  createPnpxCommand,
  createPnxCommand,
  NPX_COMMAND,
  PNPM_COMMAND,
  PNPX_COMMAND,
  PNX_COMMAND,
} from "./shell-commands/pnpm";
import {
  createPython3Command,
  createPythonCommand,
  PYTHON3_COMMAND,
  PYTHON_COMMAND,
} from "./shell-commands/python";
import { createRgCommand, RG_COMMAND } from "./shell-commands/rg";
import { createWindowCommand } from "./shell-commands/window";
import { WINDOW_COMMAND } from "./shell-commands/window-command";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { createTaskCommand } from "./shell-commands/task/command";
import {
  createUvCommand,
  createUvxCommand,
  UV_COMMAND,
  UVX_COMMAND,
} from "./shell-commands/uv";
import {
  createValidateSkillCommand,
  VALIDATE_SKILL_COMMAND,
} from "./shell-commands/validate-skill";
import {
  type CommandRun,
  currentCommandRuns,
  recordCommandRun,
  runDispatched,
} from "./shell-commands/command-runs";
import { createPathProgramResolver } from "./shell-commands/path-program";
import { createWhichCommand } from "./shell-commands/which";
import { AGENT_BROWSER_PATH } from "./agent-browser";
import { FFMPEG_PATH, FFPROBE_PATH } from "./ffmpeg";
import { gitBinaryPath } from "./git";
import { RG_DISK_PATH } from "./ripgrep";
import { finishedWorkFolder } from "./chat/output-folder";
import { foundManagedPython } from "./run-uv";
import { getUvBinPath, nearestVenv, venvPython } from "./uv";
import { workDir } from "./work-dir";
import { type WorkspaceFsLayout } from "./workspace-fs-layout";
import { type ChatId } from "../schemas/chat-id";
import { type WalkBudget } from "./walk-budget";
import { roleLayout } from "./session-layout";
import { SANDBOX_MAX_BYTES, shellFs } from "./shell-fs";

/**
 * Lines, records, and JSON values one command may hold, against just-bash's
 * 1,000,000 (`grep`, `awk`'s record array, `jq`) and 100,000 (`awk`'s records
 * and loops, `sed`'s branch loops). A 1M-row CSV export or a 50 MB JSON file
 * is ordinary desktop data and passed neither. Spread over the 256 MiB read
 * bound this is 26 bytes a line, so it covers nearly any text file the agent
 * may read while still bounding a runaway: an endless `awk` loop reaches it in
 * about 5 seconds, `sed` in under one.
 */
const SANDBOX_MAX_RECORDS = 10_000_000;

/**
 * Commands and shell loop iterations one call may run, against just-bash's
 * 100,000, which `cut` and `seq` also count lines against: `seq 1 200000`
 * and `cut -f1` over a 100,001-line file failed. A `while read` loop over a
 * 1M-line file runs a few million commands. A runaway `while true` reaches this
 * in about 20 seconds, still while the user is watching.
 */
const SANDBOX_MAX_COMMANDS = 10_000_000;

/**
 * Operations and entries one traversal may spend, both 1,000,000 by default.
 * A home folder reaches that after about twenty seconds and returns nothing to
 * show for it, since a builtin pipeline stage buffers rather than streams. This is the
 * backstop rather than the fix, so it is set to give up while the user is still
 * watching without failing work a task legitimately does: a whole monorepo
 * checkout with its `node_modules`, the heaviest tree a task holds, is about
 * 107,000 files, and traversal charges upwards of one unit each.
 */
const SANDBOX_MAX_TRAVERSAL = 300_000;

function stubCommand(
  name: string,
  message = "this command is non-functional in the sandboxed environment",
) {
  return defineCommand(name, () =>
    Promise.resolve({
      exitCode: 1,
      stderr: `${name}: ${message}\n`,
      stdout: "",
    }),
  );
}

// Commands excluded due to upstream bugs and replaced with stubs that explain
// the situation to the agent. Each entry explains why.
//
// These, and the command descriptions below that steer the agent around an
// upstream gap, are registered in docs/architecture/just-bash-upstream.md with
// what has to be true before each can go. A workaround that outlives its bug
// keeps the model avoiding something that works, so retire both together.
// Declared as a set of strings so membership can be tested against the names
// just-bash reports, which it types as plain `string`; the constructor's own
// type parameter still holds these entries to real command names.
const BROKEN_COMMANDS: ReadonlySet<string> = new Set<CommandName>([
  "which", // searches only the shell's own PATH; replaced below
]);

/**
 * What the agent hears for `osascript`: the commands that reach the apps it
 * would have scripted, the helper's where this build carries it.
 */
function osascriptRefusal(): string {
  const helper =
    getWorkspaceConfig().macHelperBinPath === undefined
      ? ""
      : ` Calendar and Reminders have the \`${CALENDAR_COMMAND.name}\` command, and Contacts the \`${CONTACTS_COMMAND.name}\` command.`;
  return `AppleScript you write doesn't run here. Mail, Notes and Messages have the \`${MAIL_COMMAND.name}\`, \`${NOTES_COMMAND.name}\` and \`${MESSAGES_COMMAND.name}\` commands.${helper} Any other app has no way in from here, so tell the person what you couldn't do in it.`;
}

/**
 * The scheduling and job-registration programs refused by their bare name.
 * `launchctl` is macOS's; the `cron`/`at` family is on both platforms. Each
 * would hand code to a system daemon to run later outside the sandbox, which
 * the Seatbelt profile also denies as an operation (`job-creation`).
 */
const SCHEDULING_COMMANDS = [
  "launchctl",
  "crontab",
  "at",
  "atq",
  "atrm",
  "batch",
  "schtasks",
] as const;

/** A scheduling command's platforms, where it is not on every one. */
const SCHEDULING_PLATFORMS: Partial<Record<string, NodeJS.Platform[]>> = {
  launchctl: ["darwin"],
  schtasks: ["win32"],
};

/** What the agent hears for a scheduling command it tries to run. */
function schedulingRefusal(name: string): string {
  return `${name} doesn't run here: a job it schedules would run later, outside this conversation's sandbox. Do the work in this turn instead, and if something genuinely needs to run on a schedule, tell the person to set it up themselves.`;
}

const STATIC_STUB_COMMANDS = [
  stubCommand(
    "npm",
    "npm is not available in this environment. Use 'pnpm' instead (e.g. 'pnpm add <package>').",
  ),
];

/**
 * Visits the name of every simple command in a script, including the ones inside
 * loops, conditionals, function bodies and command substitutions.
 *
 * Shared because two plugins want the same traversal for opposite reasons: one
 * reads the names, the other rewrites one of them. Walking twice is cheap; two
 * copies of this recursion drifting apart is not.
 */
function forEachCommandName(
  ast: ScriptNode,
  visit: (
    name: { type: "Literal"; value: string },
    command: SimpleCommandNode,
  ) => void,
) {
  walkScript(ast);

  function walkScript(node: ScriptNode) {
    for (const stmt of node.statements) {
      walkStatement(stmt);
    }
  }

  function walkStatement(stmt: StatementNode) {
    for (const pipeline of stmt.pipelines) {
      for (const cmd of pipeline.commands) {
        walkCommand(cmd);
      }
    }
  }

  function walkCommand(node: CommandNode) {
    switch (node.type) {
      case "For":
      case "Group":
      case "Subshell":
      case "Until":
      case "While": {
        const stmts = [
          ...("condition" in node ? node.condition : []),
          ...node.body,
        ];
        for (const stmt of stmts) {
          walkStatement(stmt);
        }
        break;
      }
      case "FunctionDef": {
        walkCommand(node.body);
        break;
      }
      case "If": {
        for (const clause of node.clauses) {
          for (const stmt of [...clause.condition, ...clause.body]) {
            walkStatement(stmt);
          }
        }
        for (const stmt of node.elseBody ?? []) {
          walkStatement(stmt);
        }
        break;
      }
      case "SimpleCommand": {
        const part = node.name?.parts[0];
        if (part?.type === "Literal") {
          visit(part, node);
        }
        for (const arg of node.args) {
          for (const p of arg.parts) {
            if (p.type === "CommandSubstitution") {
              walkScript(p.body);
            }
          }
        }
        break;
      }
    }
  }
}

/**
 * Rewrites `wait` to the `fg` command, marked so it answers as `wait`.
 *
 * `wait` is an interpreter builtin, so a custom command cannot shadow it the way
 * `jobs` and `kill` are shadowed. Left alone it exits 0 with no output, which
 * reads as "the process finished and wrote nothing" -- the one wrong answer here
 * that looks right. Nothing can legitimately reach the builtin either, since a
 * trailing `&` makes a background process rather than a shell job, and any
 * other `&` is refused, so there are never shell jobs to wait for.
 *
 * Its own plugin rather than a line inside `command-order`, because this decides
 * what runs. A rewrite that rides along inside a plugin registered to collect
 * metadata stops happening the moment that plugin is made conditional or
 * skipped, and what comes back is the builtin whose answer looks right.
 */
const waitAliasPlugin: TransformPlugin<Record<string, never>> = {
  name: "wait-alias",
  transform(context: { ast: ScriptNode; metadata: Record<string, unknown> }) {
    forEachCommandName(context.ast, (name, command) => {
      if (name.value === "wait") {
        name.value = FG_COMMAND.name;
        command.args.unshift({
          parts: [{ type: "Literal", value: WAIT_MARKER }],
          type: "Word",
        });
      }
    });
    return { ast: context.ast };
  },
};

/** Starts a walk budget over at every command the shell runs. */
function resetEachCommand(
  budget: WalkBudget,
): TransformPlugin<Record<string, never>> {
  return {
    name: "reset-walk-budget",
    transform(context: { ast: ScriptNode; metadata: Record<string, unknown> }) {
      budget.reset();
      return { ast: context.ast };
    },
  };
}

/** Records which commands a script runs, in order, for the tool's metadata. */
const commandOrderPlugin: TransformPlugin<{ commands: string[] }> = {
  name: "command-order",
  transform(context: { ast: ScriptNode; metadata: Record<string, unknown> }) {
    const seen = new Set<string>();
    const commands: string[] = [];

    forEachCommandName(context.ast, (name) => {
      if (!seen.has(name.value)) {
        seen.add(name.value);
        commands.push(name.value);
      }
    });

    return { ast: context.ast, metadata: { commands } };
  },
};

// Commands non-obvious enough to warrant a description alongside their name.
const DESCRIBED_COMMANDS: Record<string, string> = {
  curl: "Download files or fetch HTTP responses (use `-L -o <path> <url>` to download a file)",
  jq: "Parse and manipulate JSON",
  rg: RG_COMMAND.description,
  sqlite3:
    "Query SQLite database files. Dot commands (`.tables`, `.schema`) are NOT implemented -- list tables with `select name from sqlite_master where type='table'`. `-box`/`-json`/`-csv -header` control output",
  xan: "Fast CSV processing, filtering, aggregation, and visualization",
  yq: "Parse and manipulate YAML (like jq but for YAML; e.g. `yq '.key' file.yaml`)",
};

/**
 * What a custom command is built from: the task, the layout of the shell
 * it runs in, which says what each folder it reaches is, and what answers a
 * script's `instrument` calls.
 */
interface CustomCommandContext {
  answerScript: ChannelAnswer;
  layout: WorkspaceFsLayout;
  chatId: ChatId;
}

interface CustomCommandDef {
  description: string;
  /** What the description adds where a script reaches `instrument`. */
  scripting?: string;
  factory: (context: CustomCommandContext) => ReturnType<typeof defineCommand>;
  // When false, the command is available (including via `which`) but omitted
  // from the agent-facing description to discourage its use.
  listInDescription: boolean;
  name: string;
  /** Where the binary exists; elsewhere the name stays unclaimed. */
  platforms?: NodeJS.Platform[];
  /** Whether this build carries what the command runs; without it the name stays unclaimed. */
  available?: () => boolean;
}

/**
 * Commands built with the session id rather than the task id. Background
 * processes are owned by the session that started them, so the commands that
 * list, wait on and stop them have to be keyed the way the registry is.
 */
const SESSION_COMMAND_DEFS: {
  description: string;
  factory: (context: SessionCommandContext) => ReturnType<typeof defineCommand>;
  name: string;
}[] = [
  {
    description: JOBS_COMMAND.description,
    factory: createJobsCommand,
    name: JOBS_COMMAND.name,
  },
  {
    description: FG_COMMAND.description,
    factory: createFgCommand,
    name: FG_COMMAND.name,
  },
  {
    description: KILL_COMMAND.description,
    factory: createKillCommand,
    name: KILL_COMMAND.name,
  },
];

const ALL_CUSTOM_COMMAND_DEFS: CustomCommandDef[] = [
  {
    description: FFMPEG_COMMAND.description,
    factory: ({ layout, chatId }) => createFfmpegCommand(chatId, layout),
    listInDescription: true,
    name: FFMPEG_COMMAND.name,
  },
  {
    description: FFPROBE_COMMAND.description,
    factory: ({ layout, chatId }) => createFfprobeCommand(chatId, layout),
    listInDescription: true,
    name: FFPROBE_COMMAND.name,
  },
  {
    description: GIT_COMMAND.description,
    factory: createGitCommand,
    listInDescription: true,
    name: GIT_COMMAND.name,
  },
  {
    description: NODE_COMMAND.description,
    factory: ({ answerScript, chatId }) =>
      createNodeCommand(chatId, answerScript),
    listInDescription: true,
    name: NODE_COMMAND.name,
    scripting: NODE_COMMAND.scripting,
  },
  {
    description: "Refuses AppleScript the agent writes.",
    // AppleScript the agent writes would have to run outside the sandbox to
    // reach an app, which no check of its text can make safe. By its path,
    // osascript runs inside the sandbox, where no app takes its Apple Events.
    factory: () => stubCommand("osascript", osascriptRefusal()),
    listInDescription: false,
    name: "osascript",
    platforms: ["darwin"],
  },
  // A launchd job (and the `cron`/`at` spoolers) would run later outside
  // every sandbox; `(deny job-creation)` in the Seatbelt profile is the
  // boundary, and these stubs give the agent a clear reason by the bare
  // name rather than a launchd I/O error. Run by path they meet the same
  // profile deny.
  ...SCHEDULING_COMMANDS.map(
    (name): CustomCommandDef => ({
      description: `Refuses ${name}: scheduled or background jobs don't run here.`,
      factory: () => stubCommand(name, schedulingRefusal(name)),
      listInDescription: false,
      name,
      ...(SCHEDULING_PLATFORMS[name]
        ? { platforms: SCHEDULING_PLATFORMS[name] }
        : {}),
    }),
  ),
  {
    description: PNPM_COMMAND.description,
    factory: ({ layout, chatId }) => createPnpmCommand(chatId, layout),
    listInDescription: true,
    name: PNPM_COMMAND.name,
  },
  {
    description: NPX_COMMAND.description,
    factory: ({ layout, chatId }) => createNpxCommand(chatId, layout),
    listInDescription: false,
    name: NPX_COMMAND.name,
  },
  {
    description: PNPX_COMMAND.description,
    factory: ({ layout, chatId }) => createPnpxCommand(chatId, layout),
    listInDescription: false,
    name: PNPX_COMMAND.name,
  },
  {
    description: PNX_COMMAND.description,
    factory: ({ layout, chatId }) => createPnxCommand(chatId, layout),
    listInDescription: true,
    name: PNX_COMMAND.name,
  },
  {
    description: UV_COMMAND.description,
    factory: ({ layout, chatId }) => createUvCommand(chatId, layout),
    listInDescription: true,
    name: UV_COMMAND.name,
  },
  {
    description: UVX_COMMAND.description,
    factory: ({ chatId }) => createUvxCommand(chatId),
    // `uv tool run`; omitted from the description, as `npx` is.
    listInDescription: false,
    name: UVX_COMMAND.name,
  },
  {
    description: PYTHON_COMMAND.description,
    factory: ({ answerScript, layout, chatId }) =>
      createPythonCommand(chatId, layout, answerScript),
    listInDescription: true,
    name: PYTHON_COMMAND.name,
    scripting: PYTHON_COMMAND.scripting,
  },
  {
    description: PYTHON3_COMMAND.description,
    factory: ({ answerScript, layout, chatId }) =>
      createPython3Command(chatId, layout, answerScript),
    // Alias of python; omitted from the description to avoid redundancy.
    listInDescription: false,
    name: PYTHON3_COMMAND.name,
  },
  {
    description: PIP_COMMAND.description,
    factory: ({ layout, chatId }) => createPipCommand(chatId, layout),
    listInDescription: true,
    name: PIP_COMMAND.name,
  },
  {
    description: PIP3_COMMAND.description,
    factory: ({ layout, chatId }) => createPip3Command(chatId, layout),
    // Alias of pip; omitted from the description to avoid redundancy.
    listInDescription: false,
    name: PIP3_COMMAND.name,
  },
  {
    description: VALIDATE_SKILL_COMMAND.description,
    factory: () => createValidateSkillCommand(),
    listInDescription: true,
    name: VALIDATE_SKILL_COMMAND.name,
  },
];

/**
 * `instrument`'s commands for the Mac's own apps, in every shell on macOS:
 * Mail, Notes and Messages through the app's scripts, and Calendar,
 * Reminders and Contacts through the Mac helper where this build carries it.
 */
const MAC_APP_SUBCOMMANDS: (Omit<InstrumentSubcommand, "command"> & {
  available?: () => boolean;
  description: string;
  factory: (context: CustomCommandContext) => Command;
  name: string;
})[] = [
  {
    ...CALENDAR_COMMAND,
    available: () => getWorkspaceConfig().macHelperBinPath !== undefined,
    factory: ({ chatId, layout }) =>
      createMacHelperCommand(CALENDAR_COMMAND, chatId, layout),
  },
  {
    ...CONTACTS_COMMAND,
    available: () => getWorkspaceConfig().macHelperBinPath !== undefined,
    factory: ({ chatId, layout }) =>
      createMacHelperCommand(CONTACTS_COMMAND, chatId, layout),
  },
  {
    ...MAIL_COMMAND,
    factory: ({ chatId, layout }) => createMailCommand(chatId, layout),
  },
  {
    ...MESSAGES_COMMAND,
    factory: ({ chatId, layout }) => createMessagesCommand(chatId, layout),
  },
  {
    ...NOTES_COMMAND,
    factory: ({ chatId, layout }) => createNotesCommand(chatId, layout),
  },
];

/** The Mac app commands this platform and build offer, read per call so a test can pin one. */
function macAppSubcommands() {
  return process.platform === "darwin"
    ? MAC_APP_SUBCOMMANDS.filter((each) => each.available?.() ?? true)
    : [];
}

/**
 * The program each of our commands runs, which `type`, `command -v`, `hash`
 * and `which` name it by. A command not listed runs inside the shell, or
 * runs a program only as part of what it does (`pip` is `uv pip`, `npx` is
 * `pnpm dlx`), and is described as a shell builtin.
 */
const COMMAND_PROGRAMS: Record<string, (chatId: ChatId) => string | undefined> =
  {
    [AGENT_BROWSER_COMMAND.name]: () => AGENT_BROWSER_PATH,
    [FFMPEG_COMMAND.name]: () => FFMPEG_PATH,
    [FFPROBE_COMMAND.name]: () => FFPROBE_PATH,
    [GIT_COMMAND.name]: () => gitBinaryPath(),
    [NODE_COMMAND.name]: () => process.execPath,
    [PNPM_COMMAND.name]: () => getWorkspaceConfig().pnpmBinPath,
    [PYTHON_COMMAND.name]: pythonProgram,
    [PYTHON3_COMMAND.name]: pythonProgram,
    [RG_COMMAND.name]: () => RG_DISK_PATH,
    [UV_COMMAND.name]: () => getUvBinPath(),
  };

/**
 * The interpreter `python` runs in the work folder: its virtualenv's, or the
 * managed Python's own.
 */
function pythonProgram(chatId: ChatId): string | undefined {
  const venv = nearestVenv(chatId, workDir(chatId));
  return venv ? venvPython(venv) : foundManagedPython();
}

/**
 * Our commands that run a program the app ships: those `COMMAND_PROGRAMS`
 * names, and the ones that run one of them for what they do.
 */
const BUNDLED_PROGRAM_COMMANDS: ReadonlySet<string> = new Set([
  ...Object.keys(COMMAND_PROGRAMS),
  NPX_COMMAND.name,
  PIP_COMMAND.name,
  PIP3_COMMAND.name,
  PNPX_COMMAND.name,
  PNX_COMMAND.name,
  UVX_COMMAND.name,
]);

/**
 * `command`, recording each run on the bash call's record (`command-runs.ts`)
 * as `source` unless what it does says more: the program it starts, or the
 * builtin it hands the call to.
 */
function recordingRuns(command: Command, source: CommandRun["source"]) {
  return {
    ...command,
    execute: (...[args, ctx]: Parameters<Command["execute"]>) =>
      runDispatched(command.name, source, () => command.execute(args, ctx)),
  } satisfies Command;
}

/** The program one of our commands runs, in the shell's spelling. */
function commandProgram(chatId: ChatId, name: string): string | undefined {
  let program: string | undefined;
  // A text command uutils or the system answers is described by that program.
  const route = nativeTextRoutes().find((each) => each.name === name);
  try {
    program = route ? routeProgram(route) : COMMAND_PROGRAMS[name]?.(chatId);
  } catch {
    // A program this platform cannot carry (dugite's git elsewhere) runs
    // nothing, so there is nothing to name.
    return undefined;
  }
  return program !== undefined && path.isAbsolute(program)
    ? shellPath(program)
    : undefined;
}

/** The custom commands this platform has, read per call so a test can pin one. */
function customCommandDefs(): CustomCommandDef[] {
  return ALL_CUSTOM_COMMAND_DEFS.filter(
    (cmd) =>
      (cmd.platforms?.includes(process.platform) ?? true) &&
      (cmd.available?.() ?? true),
  );
}

export interface BashEnvOptions {
  folders?: Record<string, MountedFolder.Type>;
  /**
   * Whose shell this is. The chat's own conversation's gets the chat's own
   * commands (`task`, `chat`, `memory`, `tab`) and the apps' folders; a
   * task's, the default, gets neither.
   */
  role?: "chat" | "task";
  /**
   * The `bash` call this shell runs, so a fork it starts leaves that call out
   * of what it inherits.
   */
  callPartId?: StoreId.Part;
  remainingYieldMs?: () => number;
  sessionId: StoreId.Session;
  chatId: ChatId;
  /**
   * The folder of the skill the session loaded last, on the host, which the
   * shell names `INSTRUMENT_SKILL_DIR` (`lastLoadedSkillDir`).
   */
  loadedSkillDir?: string;
  /**
   * The canonical id of the model the call answers to, whose verdict the
   * session recorded says whether a rollover boundary binds.
   */
  model?: string;
}

/** What callers of `createBashEnv` get, wherever the interpreter runs. */
export type BashRunner = Pick<Bash, "exec">;

/**
 * The chat's own commands, listed in every shell's description: it is the
 * same in a fork, which keeps the tool definitions the provider cache is
 * keyed on the same as the chat's. Each description says which of its forms
 * are the chat's alone, and a task's shell refuses those.
 */
const CHAT_COMMAND_LINES = [
  `  ${TASK_COMMAND.name} - ${TASK_COMMAND.description}`,
  `  ${MEMORY_COMMAND.name} - ${MEMORY_COMMAND.description}`,
  `  ${WINDOW_COMMAND.name} - ${WINDOW_COMMAND.description}`,
];

/**
 * The commands the bash tool's description lists: the shell's builtins and
 * the GNU text commands the build's uutils add on every platform. The same
 * on every computer a build runs on, since a tool definition is part of the
 * prefix a provider caches; what one computer adds is in
 * {@link computerCommandsText}.
 */
function describedCommandNames(): string[] {
  return [
    ...new Set([...getCommandNames(), ...bundledTextRouteNames()]),
  ].filter((name) => !BROKEN_COMMANDS.has(name));
}

/**
 * What this computer's shell has beyond the bash tool's description: the
 * commands only its platform, or a program of its own, answers (`ps`, `top`,
 * `tasklist`), and on a Mac the `instrument` commands for its apps. Told in
 * the session's system information and in a note when it changes, so the
 * tool definition stays the same on every computer. Empty when there are
 * none.
 */
export function computerCommandsText(): string {
  const listed = new Set(describedCommandNames());
  const added = [
    ...new Set(
      nativeTextRoutes()
        .map((route) => route.name)
        .filter((name) => !listed.has(name)),
    ),
  ].sort();
  const apps = macAppSubcommands();
  return [
    added.length > 0 &&
      `Your shell on this computer also has ${added.map((name) => `\`${name}\``).join(", ")}.`,
    apps.length > 0 &&
      [
        `\`${INSTRUMENT_COMMAND.name}\` also has these commands for this Mac's own apps:`,
        ...apps.map((cmd) => `  ${cmd.name} - ${cmd.description}`),
      ].join("\n"),
  ]
    .filter((line) => typeof line === "string")
    .join("\n");
}

export function createBashDescription() {
  const allowedCommandNames = describedCommandNames();

  const namedOnly = allowedCommandNames
    .filter((name) => !(name in DESCRIBED_COMMANDS))
    .sort();

  const described = Object.entries(DESCRIBED_COMMANDS)
    .filter(([name]) => allowedCommandNames.includes(name))
    .map(([name, description]) => `  ${name} - ${description}`);

  const customLines = [
    `  ${AGENT_BROWSER_COMMAND.name} - ${agentBrowserCommandDescription()}`,
    // Every computer's: a command one platform or build lacks is never listed.
    ...ALL_CUSTOM_COMMAND_DEFS.filter(
      (cmd) =>
        cmd.listInDescription &&
        cmd.platforms === undefined &&
        cmd.available === undefined,
    ).map(
      (cmd) =>
        `  ${cmd.name} - ${cmd.description}${cmd.scripting && scriptSurfaceOpen() ? ` ${cmd.scripting}` : ""}`,
    ),
    ...SESSION_COMMAND_DEFS.map((cmd) => `  ${cmd.name} - ${cmd.description}`),
    `  ${X_COMMAND.name} - ${X_COMMAND.description}`,
    ...CHAT_COMMAND_LINES,
  ];

  const specializedCommands = [...described, ...customLines].join("\n");

  return dedent`
    Execute bash commands in your work folder.

    IMPORTANT: Files are at their real paths on the user's computer, and every command starts in your work folder. The folders list in your context says which of the user's folders you reach; every command reads and writes them where they sit, native ones included. A change there lands on the user's real files immediately, so treat \`rm\` there as permanent. "Operation not permitted" means the person keeps that place closed or wants to be asked first; the message says which and what to do.

    IMPORTANT: \`${PYTHON_COMMAND.name}\` (alias \`${PYTHON3_COMMAND.name}\`) and \`${NODE_COMMAND.name}\` are real programs: \`${PYTHON_COMMAND.name}\` runs a skill's script with that skill's packages and anything else in the nearest \`.venv\` up to your work folder, which the first \`${PIP_COMMAND.name} install\` makes, and \`${NODE_COMMAND.name}\` finds the packages \`${PNPM_COMMAND.name} add\` installed beside the script or above it. Both run whatever was installed, can start processes, and read the user's folders where they sit. Packages come from \`${PIP_COMMAND.name}\`/\`${UV_COMMAND.name}\` and \`${PNPM_COMMAND.name}\` (\`npm\` is not available). If a system command is unavailable, don't keep probing for equivalent binaries -- a short script can usually do the job, and a missing command does not mean the task is impossible.

    IMPORTANT: Not a persistent terminal -- each call starts fresh in your work folder (\`$${FOLDER_VARIABLES.work}\`), so \`cd .\` is always a no-op. Prefer relative paths inside it. Throwaway files go in the system's temp folder (\`$TMPDIR\`; \`mktemp\` names one there). Shell state (env vars, exported functions, cwd) does NOT carry across calls; to run somewhere else, prefix your command (\`cd subdir && ...\`) within a single call.

    IMPORTANT: Interactive input is not supported -- there is no terminal, so a command that waits at a prompt waits forever. Pass non-interactive flags (\`-y\`, \`--yes\`, \`--no-input\`) instead.
    A command goes to the background when it outlives \`yieldMs\`, or at once when the call ends with \`&\` (\`pnpm dev &\`); \`&\` anywhere else is refused. A command still running when \`yieldMs\` elapses is NOT killed: it keeps running, this call returns a process id, and \`${JOBS_COMMAND.name}\`, \`${FG_COMMAND.name}\` (or \`wait\`) and \`${KILL_COMMAND.name}\` manage it from there. Start a server or watcher with a trailing \`&\` to get its id promptly; leave \`yieldMs\` alone for ordinary commands.
    Those three are ordinary commands, so they compose: \`${FG_COMMAND.name} bg_1 | rg -i error\` filters before you pay for the output, \`${FG_COMMAND.name} bg_1 && ${PNPM_COMMAND.name} test\` runs only on success, and \`${KILL_COMMAND.name} bg_1 bg_2; ${JOBS_COMMAND.name}\` cleans up and confirms in one call.
    A background process is stopped once it has run for ${ms(MAX_RUNNING_AGE_MS, { long: true })}, whatever it is doing. \`${JOBS_COMMAND.name}\` reports that as \`stopped (${ms(MAX_RUNNING_AGE_MS)} cap)\` rather than as a failure or a kill; start it again if the work still needs it.
    Only output written by real binaries (\`${PNPM_COMMAND.name}\`, \`${NODE_COMMAND.name}\`, \`${PYTHON_COMMAND.name}\`, \`${UV_COMMAND.name}\`, \`${FFMPEG_COMMAND.name}\`, ...) streams while a process runs; a long shell pipeline of builtins reports its output only when it finishes.

    \`curl\` reaches the internet and this computer's own network alike: \`localhost\`, a server you started (\`curl http://127.0.0.1:<port>/\`; pick an explicit port when you start it so you know which one to call), and devices on the user's local network such as \`192.168.x.x\` or \`name.local\` hosts.

    Prefer specialized tools over shell equivalents:
      - Use the \`${TOOL_NAMES.readFile}\` tool instead of \`cat\`/\`head\`/\`tail\`.
      - Use the \`${TOOL_NAMES.editFile}\`/\`${TOOL_NAMES.writeFile}\` tools instead of \`sed\`/\`awk\`/redirects for editing.
      - Use \`rg\` for all searching -- there is no separate search tool. File contents: \`rg -n 'pattern'\`, \`-C 3\` for surrounding lines, \`-l\` for filenames only. Files by name: \`rg --files -g '*.ts'\`, or \`--iglob '*report*'\` to ignore case. It composes, so \`rg -l TODO | head\` works.
      - Filter file names inside \`rg\` with \`-g\`/\`--iglob\` rather than by piping \`rg --files\` into another command. A shell builtin such as \`awk\`, \`sed\` or a \`while read\` loop only starts once the whole listing has been collected, so over a large folder that is seconds of the app frozen, where the same filter inside \`rg\` takes milliseconds.
      - Prefer \`rg\` over \`grep\`/\`egrep\`/\`fgrep\`: \`rg\` is the real ripgrep binary and far faster.
      - For audio, video, or image inspection, prefer \`${FFPROBE_COMMAND.name} -v error -show_format -show_streams -of json <path>\` over \`file\`.

    TIP: To download a file from a URL, use \`curl -L -o <path> <url>\`. Only write a script when you need to transform or paginate the response.

    TIP: Before using an unfamiliar command, run \`<command> --help\` to check its argument syntax.

    TIP: Heredoc pipes/redirects go on the \`<<EOF\` line, not after \`EOF\`: \`cmd <<'EOF' | jq\` (not \`cmd <<'EOF'\` ... \`EOF\` ... \`| jq\`).

    Available commands (the complete set of unix builtins): ${namedOnly.join(", ")}

    Any other program on the computer's PATH runs too, held to the same rules as the specialized commands below; \`which <name>\` says whether one is there.

    IMPORTANT: Specialized commands below (e.g. ${FFMPEG_COMMAND.name}, ${FFPROBE_COMMAND.name}) are invoked by bare name only -- never by an absolute path. These binaries are also on PATH inside ${NODE_COMMAND.name} and ${PYTHON_COMMAND.name} scripts, so a script may shell out to \`${FFMPEG_COMMAND.name}\`/\`${FFPROBE_COMMAND.name}\` directly.

    Specialized commands:
    ${specializedCommands}
  `.trim();
}

/**
 * The folders the agent works with, by the names the shell gives them: the
 * workspace's apps, every chat's records (none for the window), its work
 * folder, the output folder, the folder of the skill it loaded last,
 * where it has loaded one, and the workspace's own skills, in the shell's
 * spelling.
 */
function folderVariables(
  layout: WorkspaceFsLayout,
  loadedSkillDir: string | undefined,
): Record<string, string> {
  return {
    [FOLDER_VARIABLES.apps]: shellPath(getWorkspaceConfig().appsDir),
    ...(layout.chats && { [FOLDER_VARIABLES.chats]: layout.chats.shellRoot }),
    // The chat's own folder, so finished work lands beside the transcript
    // the person reads. A chat with no folder yet, the window, which never
    // has one, and a workspace whose folders the person does not open fall
    // back to the Instrument folder (see `finishedWorkFolder`).
    [FOLDER_VARIABLES.output]: shellPath(
      finishedWorkFolder(layout.folder?.hostRoot),
    ),
    ...(loadedSkillDir !== undefined && {
      [FOLDER_VARIABLES.skill]: shellPath(loadedSkillDir),
    }),
    [FOLDER_VARIABLES.work]: layout.chat.shellRoot,
    [FOLDER_VARIABLES.workspaceSkills]: shellPath(getWorkspaceSkillsDir()),
  };
}

/**
 * Commands that act on state only the main thread holds: the background
 * process registry, the task store and its events, the browser, and app
 * credentials. When the interpreter runs in the bash worker, these are
 * stand-ins that send the call back to the main thread; every other command
 * runs where the interpreter does.
 */
const MAIN_THREAD_COMMANDS: ReadonlySet<string> = new Set([
  AGENT_BROWSER_COMMAND.name,
  FG_COMMAND.name,
  INSTRUMENT_COMMAND.name,
  JOBS_COMMAND.name,
  KILL_COMMAND.name,
]);

/**
 * What a task's `instrument` says of the subcommand only the chat has: the
 * task reports to the chat, and there are no tasks within a task.
 */
const CHAT_ONLY_SUBCOMMANDS: Record<string, string> = {
  [TASK_COMMAND.word]:
    "only the chat starts and steers tasks. Do the work here, and say in your report what is left.",
};

/**
 * The agent's shell: in the bash worker when the host set one up (see
 * `bashWorkerEnabled`), otherwise on this thread.
 */
export async function createBashEnv(
  options: BashEnvOptions,
): Promise<BashRunner> {
  // Every program the agent runs is found on this PATH, so the first command
  // after launch waits for the login shell's.
  await shellPathReady();
  return bashWorkerEnabled()
    ? createRemoteBash(options, () => createLocalBashEnv(options))
    : await createLocalBashEnv(options);
}

export async function createLocalBashEnv({
  folders,
  callPartId,
  loadedSkillDir,
  role = "task",
  // Defaulted so the callers that never wait -- skill validation, tests, the
  // sandbox script -- do not have to describe a yield window they do not have.
  remainingYieldMs = () => Number.POSITIVE_INFINITY,
  sessionId,
  standIn,
  chatId,
  model,
  answerScript = answerChannel({ chatId, model, role, sessionId }),
}: BashEnvOptions & {
  /**
   * Answers what a script's `instrument` asks; the bash worker sets one
   * that answers on the main thread, where credentials are.
   */
  answerScript?: ChannelAnswer;
  /** Replaces each of `MAIN_THREAD_COMMANDS`; set by the bash worker. */
  standIn?: (name: string) => Command;
}) {
  // Read as they stand when the shell is made, which is once per bash call.
  const rules = await chatRules({
    chatId,
    folders,
    partId: callPartId,
    sessionId,
  });
  // What the shell mounts, held to the chat's rules. rg, du, agent-browser
  // and the output a promoted command streams all take it from here.
  const layout = roleLayout({ chatId, folders, role, rules });
  // Refusals heard during one exec are told to the agent after its output.
  const { fs, homeWalkBudget, listings, refusals } = await shellFs(layout);

  const allowedCommands = [
    ...getCommandNames(),
    ...getNetworkCommandNames(),
  ].filter((name) => !BROKEN_COMMANDS.has(name)) as CommandName[];

  // What sets the chat's shell apart from a task's: its `instrument` has
  // `task`, and its `memory` and `window` change things, where a task's only
  // read them; `app` and the Mac app commands are every shell's. Putting a
  // thing on the user's screen is the chat's `window`: a task's reply is read
  // by the chat, and a pane of the task's own has nobody looking.
  const nativeCommands = customCommandDefs().map((cmd) =>
    cmd.factory({ answerScript, chatId, layout }),
  );
  const instrumentCommand = createInstrumentCommand({
    missing: role === "chat" ? {} : CHAT_ONLY_SUBCOMMANDS,
    subcommands: [
      {
        ...APP_COMMAND,
        command: createAppCommand({ chatId, model, role, sessionId }),
      },
      { ...X_COMMAND, command: createXCommand({ chatId, sessionId }) },
      {
        ...MEMORY_COMMAND,
        command: createMemoryCommand({ chatId, role }),
      },
      {
        ...WINDOW_COMMAND,
        command: createWindowCommand({
          callPartId,
          chatId,
          layout,
          role,
          sessionId,
        }),
      },
      ...(role === "chat"
        ? [
            {
              ...TASK_COMMAND,
              command: createTaskCommand({
                callPartId,
                chatId,
                remainingYieldMs,
                sessionId,
              }),
            },
          ]
        : []),
      ...macAppSubcommands().map(({ factory, summary, word }) => ({
        command: factory({ answerScript, chatId, layout }),
        summary,
        word,
      })),
    ].toSorted((a, b) => a.word.localeCompare(b.word)),
  });
  const specializedCommands = [instrumentCommand, ...nativeCommands];
  const routes = nativeTextRoutes();
  const runSource = (name: string): CommandRun["source"] => {
    const route = routes.find((each) => each.name === name);
    if (route) {
      return route.binary === "system" ? "system" : "bundled";
    }
    return BUNDLED_PROGRAM_COMMANDS.has(name) ? "bundled" : "instrument";
  };
  const resolvePathProgram = createPathProgramResolver(
    chatId,
    layout.rules.asker,
  );
  const bash = new Bash({
    commands: allowedCommands,
    customCommands: [
      // The tabs the chat or task holds, opening its own behind whatever the
      // user has up.
      createAgentBrowserCommand({ chatId, layout, sessionId }),
      // Registered after the bundled commands, which is what lets it shadow
      // just-bash's own `rg`. The built-in is a TypeScript reimplementation;
      // the real binary is orders of magnitude faster on a large tree and does
      // not carry its `(?i)` and root-level-glob bugs.
      createRgCommand({ layout, chatId }),
      createDuCommand({ layout }),
      // After the bundled commands, so the uutils programs shadow the
      // builtins they answer for.
      ...routes.map((route) =>
        createNativeTextCommand(route, { chatId, layout }),
      ),
      ...specializedCommands,
      // After the bundled commands so these shadow just-bash's own `kill` and
      // `wait`, which act on host pids this sandbox deliberately cannot name.
      ...SESSION_COMMAND_DEFS.map((cmd) =>
        cmd.factory({ remainingYieldMs, sessionId }),
      ),
      createWhichCommand(chatId),
      ...STATIC_STUB_COMMANDS,
    ].map((command) =>
      // A stand-in's run is recorded on the main thread, where it runs.
      standIn && MAIN_THREAD_COMMANDS.has(command.name)
        ? standIn(command.name)
        : recordingRuns(command, runSource(command.name)),
    ),
    cwd: layout.chat.shellRoot,
    executionLimits: {
      maxArrayElements: SANDBOX_MAX_RECORDS,
      maxAwkIterations: SANDBOX_MAX_RECORDS,
      maxCommandCount: SANDBOX_MAX_COMMANDS,
      maxLoopIterations: SANDBOX_MAX_COMMANDS,
      maxOutputSize: SANDBOX_MAX_BYTES,
      maxQueryElements: SANDBOX_MAX_RECORDS,
      maxSedIterations: SANDBOX_MAX_RECORDS,
      maxStringLength: SANDBOX_MAX_BYTES,
      maxTraversalEntries: SANDBOX_MAX_TRAVERSAL,
      maxTraversalWork: SANDBOX_MAX_TRAVERSAL,
    },
    // `curl` reaches every address the native interpreters can, the local network and loopback
    // included. The workspace server on loopback needs a per-launch key the
    // sandbox never sees, so reaching it gets a 401 and nothing more.
    network: {
      dangerouslyAllowFullInternetAccess: true,
      // Defaults to on when NODE_ENV is production.
      denyPrivateRanges: false,
      maxResponseSize: SANDBOX_MAX_BYTES,
    },
    // The shell's own PATH names no folder it mounts. The host's PATH is
    // searched only once the shell's commands pass on a name
    // (`resolveExternalCommand`), and the native commands get it from
    // resolveCommandContext and the shims themselves.
    env: {
      // The home the rules hold, so `~` in the shell is the folder its
      // native commands call home, rather than just-bash's default of `/`.
      HOME: shellPath(rules.home),
      ...folderVariables(layout, loadedSkillDir),
      NO_COLOR: "1",
      PATH: SHELL_PATH,
      // The system's temp folder, which every program it runs gets too.
      TEMP: shellPath(os.tmpdir()),
      TMP: shellPath(os.tmpdir()),
      TMPDIR: shellPath(os.tmpdir()),
      TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
      USER: os.userInfo().username,
    },
    fs,
    // The shell's filesystem is the real disk, so each of our commands is
    // described by the program it runs, or as part of the shell.
    // The shell asks this as each of our commands and its builtins starts,
    // so a folder the command lists first is the one it was asked for.
    registeredCommandPath: (name) => {
      listings.count = 0;
      return commandProgram(chatId, name);
    },
    // A name no builtin or command of ours answers runs the program by that
    // name on the computer's PATH, as a native command.
    resolveExternalCommand: async (name, context) => {
      const found = await resolvePathProgram(name, context);
      return (
        found && { ...found, command: recordingRuns(found.command, "path") }
      );
    },
    // One of our commands records its own runs; just-bash's own are told
    // here, as nothing else sees them start. What bash itself implements
    // (`echo`, `printf`) is part of the shell rather than a command it ran.
    onCommandStart: (name, { bundled, shellBuiltin }) => {
      if (bundled && !shellBuiltin) {
        recordCommandRun({ name, source: "builtin" });
      }
    },
    // A redirect into a folder that does not exist fails, as in bash, rather
    // than making the folder on the disk.
    redirectCreatesDirectories: false,
  });

  // Order matters: the alias runs first so the recorded command list names
  // what actually ran rather than what was typed.
  bash.registerTransformPlugin(waitAliasPlugin);
  bash.registerTransformPlugin(commandOrderPlugin);
  bash.registerTransformPlugin(resetEachCommand(homeWalkBudget));

  // Every native command this shell spawns is held to the same rules, and
  // reaches the services an app's work runs in only once the app is allowed.
  const reach = {
    ...nativeReachFor(layout.rules, layout),
    closedServices:
      process.platform === "darwin"
        ? await closedAppServices(chatId)
        : undefined,
  };
  const exec = bash.exec.bind(bash);
  bash.exec = async (...execArgs) => {
    refusals.clear();
    // What the person's skills, apps, topics and memories are before the
    // call, so what a program it runs changes there is seen: a program writes
    // to the disk directly, where the shell's own commands are recorded as
    // they write (`setup-changes.ts`).
    const setupBefore = await snapshotSetup();
    const startedAt = new Date();
    let result: Awaited<ReturnType<typeof exec>>;
    try {
      result = await withNativeReach(reach, () => exec(...execArgs));
    } catch (error) {
      // An error that escapes the shell ends the whole call; what the rules
      // said still goes with it.
      if (refusals.size > 0 && error instanceof Error) {
        error.message = `${error.message}\n${[...refusals].join("\n")}`;
      }
      throw error;
    } finally {
      await recordProgramSetupChanges(setupBefore);
    }
    // A write Windows' ransomware protection blocked fails as a missing
    // file, whatever wrote it: a call that failed while it blocks is asked
    // of Defender's own log for a block of one of its programs.
    if (result.exitCode !== 0 && (await protectionBlocks())) {
      const ran = (currentCommandRuns()?.rows() ?? []).flatMap((run) =>
        run.program === undefined ? [] : [run.program],
      );
      const blocks = await awaitOurBlocks({ ran, since: startedAt });
      if (blocks.length > 0) {
        refusals.add(await reportBlocks(blocks, layout.rules.asker, shellPath));
      }
    }
    if (refusals.size === 0) {
      return result;
    }
    const notes = [...refusals].join("\n");
    const stderr =
      result.stderr === "" || result.stderr.endsWith("\n")
        ? result.stderr
        : `${result.stderr}\n`;
    return { ...result, stderr: `${stderr}${notes}\n` };
  };

  return bash;
}

/**
 * What a call's programs changed in the person's setup, compared against
 * before the call, recorded for the turn that ran it. Only when a program ran:
 * the shell's own commands are recorded as they write, and a call that ran
 * none credits the turn with nothing it did not record. A change that landed
 * while the program ran is the program's as far as anyone can tell, so one
 * another chat made in the same moment is told to both chats.
 */
async function recordProgramSetupChanges(before: SetupSnapshot) {
  const runs = currentCommandRuns()?.rows();
  const ranProgram =
    runs === undefined ||
    runs.some((run) => run.program !== undefined && run.source !== "builtin");
  if (!ranProgram) {
    return;
  }
  for (const touch of setupTouchesBetween(before, await snapshotSetup())) {
    recordSetupTouch(touch);
  }
}
