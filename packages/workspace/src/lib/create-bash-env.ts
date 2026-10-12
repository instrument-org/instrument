import {
  Bash,
  type Command,
  type CommandName,
  type CommandNode,
  defineCommand,
  getCommandNames,
  getNetworkCommandNames,
  type ScriptNode,
  type StatementNode,
  type TransformPlugin,
} from "just-bash";
import ms from "ms";
import { dedent } from "radashi";

import { type MountedFolder } from "../schemas/mounted-folder";
import { type StoreId } from "../schemas/store-id";
import { TOOL_NAMES } from "../tools/name";
import { bashWorkerEnabled, createRemoteBash } from "./bash-worker/client";
import {
  AGENT_BROWSER_COMMAND,
  agentBrowserCommandDescription,
  createAgentBrowserCommand,
} from "./shell-commands/agent-browser";
import { APP_COMMAND, createAppCommand } from "./shell-commands/app";
import { type AppToolInvoker, appToolHook } from "./app-tool-hook";
import { MAX_RUNNING_AGE_MS } from "./shell-commands/background-job-commands";
import {
  createFgCommand,
  createJobsCommand,
  createKillCommand,
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
  type SessionCommandContext,
} from "./shell-commands/background-jobs";
import { CHAT_COMMAND, createChatCommand } from "./shell-commands/chat";
import { createDuCommand } from "./shell-commands/du";
import { createFfmpegCommand, FFMPEG_COMMAND } from "./shell-commands/ffmpeg";
import {
  createFfprobeCommand,
  FFPROBE_COMMAND,
} from "./shell-commands/ffprobe";
import { createGitCommand, GIT_COMMAND } from "./shell-commands/git";
import { createMemoryCommand, MEMORY_COMMAND } from "./shell-commands/memory";
import { createMktempCommand, MKTEMP_COMMAND } from "./shell-commands/mktemp";
import { createNodeCommand, NODE_COMMAND } from "./shell-commands/node";
import { withNativeReach } from "./native-sandbox";
import { SHELL_PATH } from "./workspace-fs-layout";
import { asksWritten } from "./permissions/asks";
import { chatRules, nativeReachFor } from "./permissions/chat-rules";
import { type Rules } from "./permissions/rules";
import { getWorkspaceConfig } from "./workspace-config";
import {
  CALENDAR_COMMAND,
  CONTACTS_COMMAND,
  createMacHelperCommand,
} from "./shell-commands/mac-helper";
import {
  createShortcutsCommand,
  SHORTCUTS_COMMAND,
} from "./shell-commands/shortcuts";
import {
  createOsascriptCommand,
  OSASCRIPT_COMMAND,
} from "./shell-commands/osascript";
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
import { createTabCommand } from "./shell-commands/tab";
import { TAB_COMMAND } from "./shell-commands/tab-command";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { createTaskCommand } from "./shell-commands/task/command";
import { createUvCommand, UV_COMMAND } from "./shell-commands/uv";
import {
  createValidateSkillCommand,
  VALIDATE_SKILL_COMMAND,
} from "./shell-commands/validate-skill";
import { createWhichCommand } from "./shell-commands/which";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";
import { type ChatId } from "../schemas/chat-id";
import { createWalkBudget, type WalkBudget } from "./walk-budget";
import { workDir } from "./work-dir";

/** FS reads, HTTP bodies, maxStringLength; maxHeredocSize unchanged (64 MiB). */
const SANDBOX_MAX_BYTES = 256 * 1024 * 1024;

/**
 * What one command may build as output, which is a different question from how
 * large a file the agent may work on. A broad walk over a folder mount
 * produces a string the size of the tree and every byte of it is allocated on
 * the thread that paints the window: one unfiltered `rg --files` over a home
 * folder measures 185 MiB and stalls the window for 25 seconds without
 * exceeding anything. Bounding this leaves the file sizes alone.
 */
const SANDBOX_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Operations and entries one traversal may spend, both 1,000,000 by default.
 * A home folder reaches that after about twenty seconds and returns nothing to
 * show for it, since a pipeline stage buffers rather than streams. This is the
 * backstop rather than the fix, so it is set to give up while the user is still
 * watching without failing work a task legitimately does: a whole monorepo
 * checkout with its `node_modules`, the heaviest tree a task holds, is about
 * 107,000 files, and traversal charges upwards of one unit each.
 */
const SANDBOX_MAX_TRAVERSAL = 300_000;

/**
 * The same budget for walks over a folder that holds the workspace (the
 * user's whole home folder), counted on their own (`WalkBudget`). A stray
 * `find` over the home folder is the likeliest runaway walk there is, and the
 * budget counts entries rather than time: 300,000 of them costs a few
 * seconds of `find` on macOS and over half a minute on Windows, all on the
 * thread that paints the window.
 */
const HOME_MAX_TRAVERSAL = 20_000;

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
  "which", // always errors in this environment; replaced with a stub below
  // Writes under /tmp, which no mount covers, so every call fails. Every
  // shell gets ours (shell-commands/mktemp.ts) instead.
  "mktemp",
]);

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
  visit: (name: { type: "Literal"; value: string }) => void,
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
          visit(part);
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
 * Rewrites `wait` to the `fg` command.
 *
 * `wait` is an interpreter builtin, so a custom command cannot shadow it the way
 * `jobs` and `kill` are shadowed. Left alone it exits 0 with no output, which
 * reads as "the process finished and wrote nothing" -- the one wrong answer here
 * that looks right. Nothing can legitimately reach the builtin either, since `&`
 * is unsupported and there are never shell jobs to wait for.
 *
 * Its own plugin rather than a line inside `command-order`, because this decides
 * what runs. A rewrite that rides along inside a plugin registered to collect
 * metadata stops happening the moment that plugin is made conditional or
 * skipped, and what comes back is the builtin whose answer looks right.
 */
const waitAliasPlugin: TransformPlugin<Record<string, never>> = {
  name: "wait-alias",
  transform(context: { ast: ScriptNode; metadata: Record<string, unknown> }) {
    forEachCommandName(context.ast, (name) => {
      if (name.value === "wait") {
        name.value = FG_COMMAND.name;
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
 * script's app tool calls.
 */
interface CustomCommandContext {
  layout: WorkspaceFsLayout;
  chatId: ChatId;
  invokeTool: AppToolInvoker;
}

interface CustomCommandDef {
  description: string;
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
    description: MKTEMP_COMMAND.description,
    factory: () => createMktempCommand(),
    listInDescription: true,
    name: MKTEMP_COMMAND.name,
  },
  {
    description: NODE_COMMAND.description,
    factory: ({ chatId, invokeTool }) => createNodeCommand(chatId, invokeTool),
    listInDescription: true,
    name: NODE_COMMAND.name,
  },
  {
    available: () => getWorkspaceConfig().macHelperBinPath !== undefined,
    description: CALENDAR_COMMAND.description,
    factory: ({ chatId }) => createMacHelperCommand(CALENDAR_COMMAND, chatId),
    listInDescription: true,
    name: CALENDAR_COMMAND.name,
    platforms: ["darwin"],
  },
  {
    available: () => getWorkspaceConfig().macHelperBinPath !== undefined,
    description: CONTACTS_COMMAND.description,
    factory: ({ chatId }) => createMacHelperCommand(CONTACTS_COMMAND, chatId),
    listInDescription: true,
    name: CONTACTS_COMMAND.name,
    platforms: ["darwin"],
  },
  {
    description: SHORTCUTS_COMMAND.description,
    factory: ({ layout, chatId }) => createShortcutsCommand(chatId, layout),
    listInDescription: true,
    name: SHORTCUTS_COMMAND.name,
    platforms: ["darwin"],
  },
  {
    description: OSASCRIPT_COMMAND.description,
    factory: ({ layout, chatId }) => createOsascriptCommand(chatId, layout),
    listInDescription: true,
    name: OSASCRIPT_COMMAND.name,
    platforms: ["darwin"],
  },
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
    description: PYTHON_COMMAND.description,
    factory: ({ layout, chatId }) => createPythonCommand(chatId, layout),
    listInDescription: true,
    name: PYTHON_COMMAND.name,
  },
  {
    description: PYTHON3_COMMAND.description,
    factory: ({ layout, chatId }) => createPython3Command(chatId, layout),
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
   * Present when the shell is a chat's own conversation's: it gets the
   * chat's own commands (`task`, `chat`, `memory`, `tab`) and the apps'
   * folders.
   */
  chat?: { id: ChatId };
  /**
   * The `bash` call this shell runs, so a fork it starts leaves that call out
   * of what it inherits.
   */
  callPartId?: StoreId.Part;
  remainingYieldMs?: () => number;
  sessionId: StoreId.Session;
  chatId: ChatId;
}

/** What callers of `createBashEnv` get, wherever the interpreter runs. */
export type BashRunner = Pick<Bash, "exec">;

/**
 * What the chat runs beside a task's shell, listed in every shell's
 * description: it is the same in a fork, which keeps the tool definitions
 * the provider cache is keyed on the same as the chat's, and the fork is
 * told these are not there.
 */
const CHAT_COMMAND_LINES = [
  `  ${TASK_COMMAND.name} - ${TASK_COMMAND.description}`,
  `  ${CHAT_COMMAND.name} - ${CHAT_COMMAND.description}`,
  `  ${MEMORY_COMMAND.name} - ${MEMORY_COMMAND.description}`,
  `  ${TAB_COMMAND.name} - ${TAB_COMMAND.description}`,
];

export function createBashDescription() {
  const allowedCommandNames = getCommandNames().filter(
    (name) => !BROKEN_COMMANDS.has(name),
  );

  const namedOnly = allowedCommandNames
    .filter((name) => !(name in DESCRIBED_COMMANDS))
    .sort();

  const described = Object.entries(DESCRIBED_COMMANDS)
    .filter(([name]) => allowedCommandNames.includes(name))
    .map(([name, description]) => `  ${name} - ${description}`);

  const customLines = [
    `  ${AGENT_BROWSER_COMMAND.name} - ${agentBrowserCommandDescription()}`,
    ...customCommandDefs()
      .filter((cmd) => cmd.listInDescription)
      .map((cmd) => `  ${cmd.name} - ${cmd.description}`),
    ...SESSION_COMMAND_DEFS.map((cmd) => `  ${cmd.name} - ${cmd.description}`),
    ...CHAT_COMMAND_LINES,
  ];

  const specializedCommands = [...described, ...customLines].join("\n");

  return dedent`
    Execute bash commands in this conversation's folder.

    IMPORTANT: Files are at their real paths on the user's computer, and your working directory is this conversation's folder. The folders list in your context says which of the user's folders you reach; every command reads and writes them where they sit, native ones included. A change there lands on the user's real files immediately, so treat \`rm\` there as permanent. "Operation not permitted" means the person keeps that place closed or wants to be asked first; the message says which and what to do.

    IMPORTANT: \`${PYTHON_COMMAND.name}\` (alias \`${PYTHON3_COMMAND.name}\`) is the real interpreter in this conversation's virtualenv, and \`${NODE_COMMAND.name}\` is a real Node with this conversation's packages. Both run whatever was installed, can start processes, and read the user's folders where they sit. Packages come from \`${PIP_COMMAND.name}\`/\`${UV_COMMAND.name}\` and \`${PNPM_COMMAND.name}\` (\`npm\` is not available). If a system command is unavailable, don't keep probing for equivalent binaries -- a short script can usually do the job, and a missing command does not mean the task is impossible.

    IMPORTANT: Not a persistent terminal -- each call starts fresh from this conversation's folder, your working directory, so \`cd .\` is always a no-op. Prefer relative paths (\`work/...\`) inside it. Writing outside the folders you reach (e.g. \`/tmp\`) fails -- use \`work/\` for scratch files, or \`${MKTEMP_COMMAND.name}\` to name one. Shell state (env vars, exported functions, cwd) does NOT carry across calls; to run somewhere else, prefix your command (\`cd subdir && ...\`) within a single call.

    IMPORTANT: Interactive input is not supported -- there is no terminal, so a command that waits at a prompt waits forever. Pass non-interactive flags (\`-y\`, \`--yes\`, \`--no-input\`) instead.
    A command goes to the background by outliving \`yieldMs\`, NOT by \`&\` (\`&\`, \`nohup\` and \`disown\` are unsupported). A command still running when \`yieldMs\` elapses is NOT killed: it keeps running, this call returns a process id, and \`${JOBS_COMMAND.name}\`, \`${FG_COMMAND.name}\` and \`${KILL_COMMAND.name}\` manage it from there. Start a server or watcher with a small \`yieldMs\` to get its id promptly; leave \`yieldMs\` alone for ordinary commands.
    Those three are ordinary commands, so they compose: \`${FG_COMMAND.name} bg_1 | rg -i error\` filters before you pay for the output, \`${FG_COMMAND.name} bg_1 && ${PNPM_COMMAND.name} test\` runs only on success, and \`${KILL_COMMAND.name} bg_1 bg_2; ${JOBS_COMMAND.name}\` cleans up and confirms in one call.
    A background process is stopped once it has run for ${ms(MAX_RUNNING_AGE_MS, { long: true })}, whatever it is doing. \`${JOBS_COMMAND.name}\` reports that as \`stopped (${ms(MAX_RUNNING_AGE_MS)} cap)\` rather than as a failure or a kill; start it again if the work still needs it.
    Only output written by real binaries (\`${PNPM_COMMAND.name}\`, \`${NODE_COMMAND.name}\`, \`${PYTHON_COMMAND.name}\`, \`${UV_COMMAND.name}\`, \`${FFMPEG_COMMAND.name}\`, ...) streams while a process runs; a long shell pipeline of builtins reports its output only when it finishes.

    \`curl\` reaches the internet and this computer's own network alike: \`localhost\`, a server you started (\`curl http://127.0.0.1:<port>/\`; pick an explicit port when you start it so you know which one to call), and devices on the user's local network such as \`192.168.x.x\` or \`name.local\` hosts.

    Prefer specialized tools over shell equivalents:
      - Use the \`${TOOL_NAMES.readFile}\` tool instead of \`cat\`/\`head\`/\`tail\`.
      - Use the \`${TOOL_NAMES.editFile}\`/\`${TOOL_NAMES.writeFile}\` tools instead of \`sed\`/\`awk\`/redirects for editing.
      - Use \`rg\` for all searching -- there is no separate search tool. File contents: \`rg -n 'pattern'\`, \`-C 3\` for surrounding lines, \`-l\` for filenames only. Files by name: \`rg --files -g '*.ts'\`, or \`--iglob '*report*'\` to ignore case. It composes, so \`rg -l TODO | head\` works.
      - Filter file names inside \`rg\` with \`-g\`/\`--iglob\`, never by piping \`rg --files\` into another command: a pipe stage only starts once the whole listing has been collected, so over a large folder that is seconds of the app frozen, where the same filter inside \`rg\` takes milliseconds.
      - Prefer \`rg\` over \`grep\`/\`egrep\`/\`fgrep\`: \`rg\` is the real ripgrep binary and far faster.
      - For audio, video, or image inspection, prefer \`${FFPROBE_COMMAND.name} -v error -show_format -show_streams -of json <path>\` over \`file\`.

    TIP: To download a file from a URL, use \`curl -L -o <path> <url>\`. Only write a script when you need to transform or paginate the response.

    TIP: Before using an unfamiliar command, run \`<command> --help\` to check its argument syntax.

    TIP: Heredoc pipes/redirects go on the \`<<EOF\` line, not after \`EOF\`: \`cmd <<'EOF' | jq\` (not \`cmd <<'EOF'\` ... \`EOF\` ... \`| jq\`).

    Available commands (this is the complete set of unix builtins; if a command is not listed here it is NOT available, so use one of these or a specialized command below instead of assuming): ${namedOnly.join(", ")}

    IMPORTANT: Specialized commands below (e.g. ${FFMPEG_COMMAND.name}, ${FFPROBE_COMMAND.name}) are invoked by bare name only -- never by an absolute path. \`which\`/\`command -v\`/\`type\` may report a path like /usr/bin/${FFMPEG_COMMAND.name}, but that path does NOT exist; ignore it. These binaries are also on PATH inside ${NODE_COMMAND.name} and ${PYTHON_COMMAND.name} scripts, so a script may shell out to \`${FFMPEG_COMMAND.name}\`/\`${FFPROBE_COMMAND.name}\` directly.

    Specialized commands:
    ${specializedCommands}
  `.trim();
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
  APP_COMMAND.name,
  CHAT_COMMAND.name,
  FG_COMMAND.name,
  JOBS_COMMAND.name,
  KILL_COMMAND.name,
  MEMORY_COMMAND.name,
  TAB_COMMAND.name,
  TASK_COMMAND.name,
]);

/**
 * What a shell built with these options mounts, each folder at its real path:
 * the chat's own folder (the working directory), the folders the chat
 * reaches, the skills, and for the chat its apps, held to the chat's rules.
 * rg, du, and the output a promoted command streams all take it from here.
 */
function shellLayout({
  folders,
  chat,
  chatId,
  rules,
}: Pick<BashEnvOptions, "folders" | "chat" | "chatId"> & { rules?: Rules }) {
  return buildWorkspaceFsLayout({
    // The chat authors apps, so it gets their folders; a task reaches
    // the apps it was handed through the command alone.
    apps: chat !== undefined,
    folders,
    rules,
    taskHostRoot: workDir(chatId),
  });
}

/**
 * The agent's shell: in the bash worker when the host set one up (see
 * `bashWorkerEnabled`), otherwise on this thread.
 */
export async function createBashEnv(
  options: BashEnvOptions,
): Promise<BashRunner> {
  return bashWorkerEnabled()
    ? createRemoteBash(options, () => createLocalBashEnv(options))
    : await createLocalBashEnv(options);
}

export async function createLocalBashEnv({
  folders,
  callPartId,
  chat,
  // Defaulted so the callers that never wait -- skill validation, tests, the
  // sandbox script -- do not have to describe a yield window they do not have.
  remainingYieldMs = () => Number.POSITIVE_INFINITY,
  sessionId,
  standIn,
  chatId,
  invokeTool = appToolHook,
}: BashEnvOptions & {
  /**
   * Answers a `node` script's `tools.<slug>.<tool>()`; the bash worker
   * sets one that makes the call on the main thread, where credentials are.
   */
  invokeTool?: AppToolInvoker;
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
  const layout = shellLayout({ folders, chat, chatId, rules });
  // The working folder walks at the sandbox's budget, and the home folder at
  // its own, smaller one.
  const homeWalkBudget = createWalkBudget(HOME_MAX_TRAVERSAL);
  // Refusals heard during one exec, told to the agent after its output with
  // the host path spelled out, which an error from a script worker loses.
  const refusals = new Set<string>();
  const fs = await buildBashFs(layout, {
    homeWalkBudget,
    maxFileReadSize: SANDBOX_MAX_BYTES,
    onRefusal: (refusal) => refusals.add(refusal),
  });

  const allowedCommands = [
    ...getCommandNames(),
    ...getNetworkCommandNames(),
  ].filter((name) => !BROKEN_COMMANDS.has(name)) as CommandName[];

  // What sets the chat's shell apart from a task's: it gets `task`, `chat`,
  // `memory` and `tab` beside the native hatches every shell has. Putting a
  // thing on the user's screen is the chat's `tab`: a task's reply is read
  // by the chat, and a pane of the task's own has nobody looking.
  const nativeCommands = customCommandDefs().map((cmd) =>
    cmd.factory({ chatId, invokeTool, layout }),
  );
  const nativeCommandNames = customCommandDefs().map((cmd) => cmd.name);
  const specializedCommands = [
    ...(chat
      ? [
          createTaskCommand({
            callPartId,
            chatId: chat.id,
            remainingYieldMs,
            sessionId,
          }),
          createChatCommand(),
          createMemoryCommand({ chatId: chat.id, sessionId }),
          createTabCommand({ chatId: chat.id, layout }),
        ]
      : []),
    createAppCommand({ chatId }),
    ...nativeCommands,
  ];
  const specializedCommandNames = [
    ...(chat
      ? [
          TASK_COMMAND.name,
          CHAT_COMMAND.name,
          MEMORY_COMMAND.name,
          TAB_COMMAND.name,
        ]
      : []),
    APP_COMMAND.name,
    ...nativeCommandNames,
  ];

  const bash = new Bash({
    commands: allowedCommands,
    customCommands: [
      // The tabs the chat or task holds, opening its own behind whatever the
      // user has up.
      createAgentBrowserCommand({ sessionId, chatId }),
      // Registered after the bundled commands, which is what lets it shadow
      // just-bash's own `rg`. The built-in is a TypeScript reimplementation;
      // the real binary is orders of magnitude faster on a large tree and does
      // not carry its `(?i)` and root-level-glob bugs.
      createRgCommand({ layout, chatId }),
      createDuCommand({ layout }),
      ...specializedCommands,
      // After the bundled commands so these shadow just-bash's own `kill` and
      // `wait`, which act on host pids this sandbox deliberately cannot name.
      ...SESSION_COMMAND_DEFS.map((cmd) =>
        cmd.factory({ remainingYieldMs, sessionId }),
      ),
      createWhichCommand(
        new Set([
          AGENT_BROWSER_COMMAND.name,
          RG_COMMAND.name,
          ...allowedCommands,
          ...SESSION_COMMAND_DEFS.map((cmd) => cmd.name),
          ...specializedCommandNames,
        ]),
      ),
      ...STATIC_STUB_COMMANDS,
    ].map((command) =>
      standIn && MAIN_THREAD_COMMANDS.has(command.name)
        ? standIn(command.name)
        : command,
    ),
    cwd: layout.task.shellRoot,
    executionLimits: {
      maxOutputSize: SANDBOX_MAX_OUTPUT_BYTES,
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
    // The shell's own PATH names no folder it mounts. The home folder is
    // mounted at its real path, so the host's PATH would put a binary there
    // (a pnpm or nvm shim under ~/Library or ~/.local) ahead of the command
    // registered by the same name. The native commands get the host's PATH
    // from resolveCommandContext and the shims themselves.
    env: {
      NO_COLOR: "1",
      PATH: SHELL_PATH,
      TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    fs,
  });

  // Order matters: the alias runs first so the recorded command list names
  // what actually ran rather than what was typed.
  bash.registerTransformPlugin(waitAliasPlugin);
  bash.registerTransformPlugin(commandOrderPlugin);
  bash.registerTransformPlugin(resetEachCommand(homeWalkBudget));

  // Every native command this shell spawns is held to the same rules.
  const reach = nativeReachFor(layout.rules, layout);
  const exec = bash.exec.bind(bash);
  bash.exec = async (...execArgs) => {
    refusals.clear();
    let result: Awaited<ReturnType<typeof exec>>;
    try {
      result = await withNativeReach(reach, () => exec(...execArgs));
    } catch (error) {
      // A write outside every mount throws out of the whole call rather
      // than failing its command; what the rules said still goes with it.
      await asksWritten();
      if (refusals.size > 0 && error instanceof Error) {
        error.message = `${error.message}\n${[...refusals].join("\n")}`;
      }
      throw error;
    }
    await asksWritten();
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
