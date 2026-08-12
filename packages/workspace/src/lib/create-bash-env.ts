import {
  Bash,
  type CommandName,
  type CommandNode,
  defineCommand,
  getCommandNames,
  getNetworkCommandNames,
  type ScriptNode,
  type StatementNode,
  type TransformPlugin,
} from "just-bash";
import { dedent } from "radashi";

import { MOUNT } from "../mount-points";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TOOL_NAMES } from "../tools/name";
import {
  AGENT_BROWSER_COMMAND,
  agentBrowserCommandDescription,
  createAgentBrowserCommand,
} from "./shell-commands/agent-browser";
import {
  createFgCommand,
  createJobsCommand,
  createKillCommand,
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
} from "./shell-commands/background-jobs";
import { createFfmpegCommand, FFMPEG_COMMAND } from "./shell-commands/ffmpeg";
import {
  createFfprobeCommand,
  FFPROBE_COMMAND,
} from "./shell-commands/ffprobe";
import { createGitCommand, GIT_COMMAND } from "./shell-commands/git";
import { createNodeCommand, NODE_COMMAND } from "./shell-commands/node";
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
import { createShowCommand, SHOW_COMMAND } from "./shell-commands/show";
import { createTsCommand, TS_COMMAND } from "./shell-commands/ts";
import { createTscCommand, TSC_COMMAND } from "./shell-commands/tsc";
import { createUvCommand, UV_COMMAND } from "./shell-commands/uv";
import {
  createValidateSkillCommand,
  VALIDATE_SKILL_COMMAND,
} from "./shell-commands/validate-skill";
import { createWhichCommand } from "./shell-commands/which";
import { taskDir } from "./task-dir-utils";
import { buildBashFs, buildWorkspaceFsLayout } from "./workspace-fs-layout";

/** FS reads, HTTP bodies, maxStringLength/maxOutputSize; maxHeredocSize unchanged (64 MiB). */
const SANDBOX_MAX_BYTES = 256 * 1024 * 1024;

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
const BROKEN_COMMANDS = new Set<CommandName>([
  "html-to-markdown", // depends on `turndown`, which requires `@mixmark-io/domino` as an undeclared peer dependency
  "which", // always errors in this environment; replaced with a stub below
]);

const STATIC_STUB_COMMANDS = [
  stubCommand(
    "npm",
    "npm is not available in this environment. Use 'pnpm' instead (e.g. 'pnpm add <package>').",
  ),
];

const commandOrderPlugin: TransformPlugin<{ commands: string[] }> = {
  name: "command-order",
  transform(context: { ast: ScriptNode; metadata: Record<string, unknown> }) {
    const seen = new Set<string>();
    const commands: string[] = [];

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
            // `wait` is an interpreter builtin, so a custom command cannot
            // shadow it the way `jobs` and `kill` are shadowed. Left alone it
            // exits 0 with no output, which reads as "the process finished and
            // wrote nothing" -- the one wrong answer here that looks right.
            // Nothing can legitimately reach it either, since `&` is
            // unsupported and there are never shell jobs to wait for.
            if (part.value === "wait") {
              part.value = FG_COMMAND.name;
            }
            if (!seen.has(part.value)) {
              seen.add(part.value);
              commands.push(part.value);
            }
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

    walkScript(context.ast);
    return { ast: context.ast, metadata: { commands } };
  },
};

// Commands non-obvious enough to warrant a description alongside their name.
const DESCRIBED_COMMANDS: Record<string, string> = {
  curl: "Download files or fetch HTTP responses (use `-L -o <path> <url>` to download a file)",
  jq: "Parse and manipulate JSON",
  rg: RG_COMMAND.description,
  sqlite3:
    "Query SQLite database files. Dot commands (`.tables`, `.schema`) are NOT implemented -- list tables with `select name from sqlite_master where type='table'`. Pass `-bail` or a SQL error still exits 0. `-box`/`-json`/`-csv -header` control output",
  xan: "Fast CSV processing, filtering, aggregation, and visualization",
  yq: "Parse and manipulate YAML (like jq but for YAML; e.g. `yq '.key' file.yaml`)",
};

interface CustomCommandDef {
  description: string;
  factory: (taskId: TaskId) => ReturnType<typeof defineCommand>;
  // When false, the command is available (including via `which`) but omitted
  // from the agent-facing description to discourage its use.
  listInDescription: boolean;
  name: string;
}

/**
 * Commands built with the session id rather than the task id. Background
 * processes are owned by the session that started them, so the commands that
 * list, wait on and stop them have to be keyed the way the registry is.
 */
const SESSION_COMMAND_DEFS: {
  description: string;
  factory: (sessionId: StoreId.Session) => ReturnType<typeof defineCommand>;
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

const CUSTOM_COMMAND_DEFS: CustomCommandDef[] = [
  {
    description: FFMPEG_COMMAND.description,
    factory: createFfmpegCommand,
    listInDescription: true,
    name: FFMPEG_COMMAND.name,
  },
  {
    description: FFPROBE_COMMAND.description,
    factory: createFfprobeCommand,
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
    factory: createNodeCommand,
    // Omitted from the description so the agent prefers TypeScript via `tsx`.
    listInDescription: false,
    name: NODE_COMMAND.name,
  },

  {
    description: PNPM_COMMAND.description,
    factory: createPnpmCommand,
    listInDescription: true,
    name: PNPM_COMMAND.name,
  },
  {
    description: NPX_COMMAND.description,
    factory: createNpxCommand,
    listInDescription: false,
    name: NPX_COMMAND.name,
  },
  {
    description: PNPX_COMMAND.description,
    factory: createPnpxCommand,
    listInDescription: false,
    name: PNPX_COMMAND.name,
  },
  {
    description: PNX_COMMAND.description,
    factory: createPnxCommand,
    listInDescription: true,
    name: PNX_COMMAND.name,
  },
  {
    description: TS_COMMAND.description,
    factory: createTsCommand,
    listInDescription: true,
    name: TS_COMMAND.name,
  },
  {
    description: TSC_COMMAND.description,
    factory: createTscCommand,
    listInDescription: true,
    name: TSC_COMMAND.name,
  },
  {
    description: UV_COMMAND.description,
    factory: createUvCommand,
    listInDescription: true,
    name: UV_COMMAND.name,
  },
  {
    description: PYTHON_COMMAND.description,
    factory: createPythonCommand,
    listInDescription: true,
    name: PYTHON_COMMAND.name,
  },
  {
    description: PYTHON3_COMMAND.description,
    factory: createPython3Command,
    // Alias of python; omitted from the description to avoid redundancy.
    listInDescription: false,
    name: PYTHON3_COMMAND.name,
  },
  {
    description: PIP_COMMAND.description,
    factory: createPipCommand,
    listInDescription: true,
    name: PIP_COMMAND.name,
  },
  {
    description: PIP3_COMMAND.description,
    factory: createPip3Command,
    // Alias of pip; omitted from the description to avoid redundancy.
    listInDescription: false,
    name: PIP3_COMMAND.name,
  },
  {
    description: VALIDATE_SKILL_COMMAND.description,
    factory: createValidateSkillCommand,
    listInDescription: true,
    name: VALIDATE_SKILL_COMMAND.name,
  },
];

export function createBashDescription() {
  const allowedCommandNames = getCommandNames().filter(
    (name) => !BROKEN_COMMANDS.has(name as CommandName),
  );

  const namedOnly = allowedCommandNames
    .filter((name) => !(name in DESCRIBED_COMMANDS))
    .sort();

  const described = Object.entries(DESCRIBED_COMMANDS)
    .filter(([name]) => allowedCommandNames.includes(name))
    .map(([name, description]) => `  ${name} - ${description}`);

  const customLines = [
    `  ${AGENT_BROWSER_COMMAND.name} - ${agentBrowserCommandDescription()}`,
    `  ${SHOW_COMMAND.name} - ${SHOW_COMMAND.description}`,
    ...CUSTOM_COMMAND_DEFS.filter((cmd) => cmd.listInDescription).map(
      (cmd) => `  ${cmd.name} - ${cmd.description}`,
    ),
    ...SESSION_COMMAND_DEFS.map((cmd) => `  ${cmd.name} - ${cmd.description}`),
  ];

  const specializedCommands = [...described, ...customLines].join("\n");

  return dedent`
    Execute bash commands in the task directory.

    IMPORTANT: Folders the user attaches appear as mounts under \`${MOUNT.attachedFolders}/\`, each read-only or read-and-write; the attached-folders list in your context says which. A write into a read-only one fails with EROFS. A write into a read-and-write one lands on the user's real files immediately, so treat \`rm\` there as permanent. \`rg\` searches mount paths directly, but the interpreter hatches (python, node, ffmpeg, pnpm) cannot resolve one: copy the file into the task first (e.g. \`cp '${MOUNT.attachedFolders}/<folder>/file' attachments/\`), work on the copy, and \`mv\` the result back if it belongs in the folder.

    IMPORTANT: Python is available via the specialized \`${PYTHON_COMMAND.name}\`/\`${PYTHON3_COMMAND.name}\`/\`${PIP_COMMAND.name}\`/\`${UV_COMMAND.name}\` commands below (backed by a per-task virtualenv in work/.venv), TypeScript/JavaScript via \`${TS_COMMAND.name}\`, and package management via \`${PNPM_COMMAND.name}\` (\`npm\` is not available). If a system command is unavailable, don't keep probing for equivalent binaries -- a short script can usually do the job, and a missing command does not mean the task is impossible. Inside script code run by these commands, use task-relative paths (\`work/data.csv\`): command-line path ARGUMENTS are translated, and quoted \`${MOUNT.task}/...\` strings in inline code (-e/-c/heredoc programs) are bridged too, but \`${MOUNT.attachedFolders}/...\` never is (copy attached files into the task first) and paths inside script FILES on disk are never translated.

    IMPORTANT: Not a persistent terminal -- each call starts fresh from the task root (\`${MOUNT.task}\`, your working directory), so \`cd .\` is always a no-op. Prefer relative paths (\`work/...\`, \`output/...\`). Only \`${MOUNT.task}\`, the \`${MOUNT.attachedFolders}\` mounts, and \`${MOUNT.skills}\` exist; writing anywhere else (e.g. \`/tmp\`) fails -- use \`work/\` for scratch files. Shell state (env vars, exported functions, cwd) does NOT carry across calls; to run somewhere else, prefix your command (\`cd subdir && ...\`) within a single call.

    IMPORTANT: Interactive input is not supported -- there is no terminal, so a command that waits at a prompt waits forever. Pass non-interactive flags (\`-y\`, \`--yes\`, \`--no-input\`) instead.
    A command goes to the background by outliving \`yieldMs\`, NOT by \`&\` (\`&\`, \`nohup\` and \`disown\` are unsupported). A command still running when \`yieldMs\` elapses is NOT killed: it keeps running, this call returns a process id, and \`${JOBS_COMMAND.name}\`, \`${FG_COMMAND.name}\` and \`${KILL_COMMAND.name}\` manage it from there. Start a server or watcher with a small \`yieldMs\` to get its id promptly; leave \`yieldMs\` alone for ordinary commands.
    Those three are ordinary commands, so they compose: \`${FG_COMMAND.name} bg_1 | rg -i error\` filters before you pay for the output, \`${FG_COMMAND.name} bg_1 && ${PNPM_COMMAND.name} test\` runs only on success, and \`${KILL_COMMAND.name} bg_1 bg_2; ${JOBS_COMMAND.name}\` cleans up and confirms in one call.
    Only output written by real binaries (\`${PNPM_COMMAND.name}\`, \`${TS_COMMAND.name}\`, \`${PYTHON_COMMAND.name}\`, \`${UV_COMMAND.name}\`, \`${FFMPEG_COMMAND.name}\`, ...) streams while a process runs; a long shell pipeline of builtins reports its output only when it finishes.

    IMPORTANT: \`curl\`/\`wget\` refuse private and loopback addresses, so they cannot reach a server you started, and they fail with a bare exit 7 and no message. Make that request from a real process instead: a \`${TS_COMMAND.name}\` or \`${PYTHON_COMMAND.name}\` script fetching \`http://127.0.0.1:<port>/\`. Pick an explicit port when you start the server so you know which one to call.

    Prefer specialized tools over shell equivalents:
      - Use the \`${TOOL_NAMES.readFile}\` tool instead of \`cat\`/\`head\`/\`tail\`.
      - Use the \`${TOOL_NAMES.editFile}\`/\`${TOOL_NAMES.writeFile}\` tools instead of \`sed\`/\`awk\`/redirects for editing.
      - Use \`rg\` for all searching -- there is no separate search tool. File contents: \`rg -n 'pattern'\`, \`-C 3\` for surrounding lines, \`-l\` for filenames only. Files by name: \`rg --files -g '*.ts'\`. It composes, so \`rg -l TODO | head\` works.
      - Prefer \`rg\` over \`grep\`/\`egrep\`/\`fgrep\`: \`rg\` is the real ripgrep binary and far faster.
      - For audio, video, or image inspection, prefer \`${FFPROBE_COMMAND.name} -v error -show_format -show_streams -of json <path>\` over \`file\`.

    TIP: To download a file from a URL, use \`curl -L -o <path> <url>\`. Only write a script when you need to transform or paginate the response.

    TIP: Before using an unfamiliar command, run \`<command> --help\` to check its argument syntax.

    TIP: Heredoc pipes/redirects go on the \`<<EOF\` line, not after \`EOF\`: \`cmd <<'EOF' | jq\` (not \`cmd <<'EOF'\` ... \`EOF\` ... \`| jq\`).

    Available commands (this is the complete set of unix builtins; if a command is not listed here it is NOT available, so use one of these or a specialized command below instead of assuming): ${namedOnly.join(", ")}

    IMPORTANT: Specialized commands below (e.g. ${FFMPEG_COMMAND.name}, ${FFPROBE_COMMAND.name}) are invoked by bare name only -- never by an absolute path. \`which\`/\`command -v\`/\`type\` may report a path like /usr/bin/${FFMPEG_COMMAND.name}, but that path does NOT exist; ignore it. These binaries are also on PATH inside ${TS_COMMAND.name}/${NODE_COMMAND.name} scripts, so a script may shell out to \`${FFMPEG_COMMAND.name}\`/\`${FFPROBE_COMMAND.name}\` directly.

    Specialized commands:
    ${specializedCommands}
  `.trim();
}

export async function createBashEnv({
  attachedFolders,
  projectFolderName,
  sessionId,
  taskId,
}: {
  attachedFolders?: Record<string, FolderAttachment.Type>;
  projectFolderName?: string;
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  // The layout is the single source of truth for what the agent can see: the
  // writable task directory mounted at /task (the working directory), the
  // project folder at /project when the task belongs to one, plus any
  // user-attached folders under /mnt, each read-only or writable. The bash
  // native-binary path bridge, and the dedicated file tools all route through
  // it so they agree on virtual<->real mapping.
  const layout = buildWorkspaceFsLayout({
    attachedFolders,
    projectFolderName,
    taskHostRoot: taskDir(taskId),
  });
  const fs = await buildBashFs(layout, { maxFileReadSize: SANDBOX_MAX_BYTES });

  const allowedCommands = [
    ...getCommandNames(),
    ...getNetworkCommandNames(),
  ].filter(
    (name) => !BROKEN_COMMANDS.has(name as CommandName),
  ) as CommandName[];

  const bash = new Bash({
    commands: allowedCommands,
    customCommands: [
      createAgentBrowserCommand({
        sessionId,
        taskId,
      }),
      // Registered after the bundled commands, which is what lets it shadow
      // just-bash's own `rg`. The built-in is a TypeScript reimplementation;
      // the real binary is orders of magnitude faster on a large tree and does
      // not carry its `(?i)` and root-level-glob bugs.
      createRgCommand({ attachedFolders, projectFolderName, taskId }),
      createShowCommand({ sessionId, taskId }),
      ...CUSTOM_COMMAND_DEFS.map((cmd) => cmd.factory(taskId)),
      // After the bundled commands so these shadow just-bash's own `kill` and
      // `wait`, which act on host pids this sandbox deliberately cannot name.
      ...SESSION_COMMAND_DEFS.map((cmd) => cmd.factory(sessionId)),
      createWhichCommand(
        new Set([
          AGENT_BROWSER_COMMAND.name,
          SHOW_COMMAND.name,
          ...allowedCommands,
          ...CUSTOM_COMMAND_DEFS.map((cmd) => cmd.name),
          ...SESSION_COMMAND_DEFS.map((cmd) => cmd.name),
        ]),
      ),
      ...STATIC_STUB_COMMANDS,
    ],
    cwd: MOUNT.task,
    executionLimits: {
      maxOutputSize: SANDBOX_MAX_BYTES,
      maxStringLength: SANDBOX_MAX_BYTES,
    },
    network: {
      // No per-domain allow-list to maintain; the agent legitimately fetches
      // arbitrary public URLs (downloads, scraping, etc.). Someday: gate this
      // behind a per-session human-in-the-loop allow-list / approval prompt.
      dangerouslyAllowFullInternetAccess: true,
      // SSRF block: loopback/RFC1918/metadata, with DNS check + redirect re-check.
      // Enforced even when the dangerously-allow flag is on.
      denyPrivateRanges: true,
      maxResponseSize: SANDBOX_MAX_BYTES,
    },
    // Seed with process.env so PATH and other system vars are available to
    // commands that pass ctx.env explicitly (e.g. pnpm, tsx). pnpm shim files
    // also use sed, uname, etc when on unix systems.
    env: {
      NO_COLOR: "1",
      TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(process.env.PATH && { PATH: process.env.PATH }),
    },
    fs,
  });

  bash.registerTransformPlugin(commandOrderPlugin);

  return bash;
}
