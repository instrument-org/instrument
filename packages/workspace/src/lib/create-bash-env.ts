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

import { type FolderAttachment } from "../schemas/folder-attachment";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TOOL_NAMES } from "../tools/name";
import {
  AGENT_BROWSER_COMMAND,
  createAgentBrowserCommand,
} from "./shell-commands/agent-browser";
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
import { createTsCommand, TS_COMMAND } from "./shell-commands/ts";
import { createTscCommand, TSC_COMMAND } from "./shell-commands/tsc";
import { createUvCommand, UV_COMMAND } from "./shell-commands/uv";
import { createWhichCommand } from "./shell-commands/which";
import { taskDir } from "./task-dir-utils";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  SKILLS_MOUNT_POINT,
  TASK_MOUNT_POINT,
} from "./workspace-fs-layout";

// cspell:ignore mixmark

/** FS reads, HTTP bodies, maxStringLength/maxOutputSize; maxHeredocSize unchanged (10 MiB). */
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
const BROKEN_COMMANDS = new Set<CommandName>([
  "html-to-markdown", // depends on `turndown`, which requires `@mixmark-io/domino` as an undeclared peer dependency
  "sqlite3", // resolves its worker via import.meta.url on disk; incompatible with asar bundling
  "which", // always errors in this environment; replaced with a stub below
]);

const STATIC_STUB_COMMANDS = [
  stubCommand(
    "npm",
    "npm is not available in this environment. Use 'pnpm' instead (e.g. 'pnpm add <package>').",
  ),
  stubCommand("sqlite3", "SQLite is not available in this environment"),
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

    // cspell:ignore Subshell
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
          if (part?.type === "Literal" && !seen.has(part.value)) {
            seen.add(part.value);
            commands.push(part.value);
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
    `  ${AGENT_BROWSER_COMMAND.name} - ${AGENT_BROWSER_COMMAND.description}`,
    ...CUSTOM_COMMAND_DEFS.filter((cmd) => cmd.listInDescription).map(
      (cmd) => `  ${cmd.name} - ${cmd.description}`,
    ),
  ];

  const specializedCommands = [...described, ...customLines].join("\n");

  return dedent`
    Execute bash commands in the task directory.

    IMPORTANT: This is a unix-like (POSIX) shell, regardless of the host OS.

    IMPORTANT: Folders the user attaches appear as read-only mounts under \`/mnt/\` (one directory per folder). You can read, list, and search them (\`ls\`, \`cat\`, \`grep\`, \`find\`) but cannot write into them -- any write, or a script/command that outputs into \`/mnt/\`, fails with EROFS. They live outside the task root, so address them by their \`/mnt/...\` path. To modify or process an attached file, copy it into the task first (e.g. \`cp '/mnt/<folder>/file' attachments/\`) and work on the copy.

    IMPORTANT: Python is available via the specialized \`${PYTHON_COMMAND.name}\`/\`${PYTHON3_COMMAND.name}\`/\`${PIP_COMMAND.name}\`/\`${UV_COMMAND.name}\` commands below (backed by a per-task virtualenv in work/.venv), and TypeScript/JavaScript via the specialized \`${TS_COMMAND.name}\` command. If a system command is unavailable, don't keep probing for equivalent binaries -- a short script can usually do the job, and a missing command does not mean the task is impossible. Inside script code run by these commands, use task-relative paths (\`work/data.csv\`): command-line path ARGUMENTS are translated, and quoted \`${TASK_MOUNT_POINT}/...\` strings in inline code (-e/-c/heredoc programs) are bridged too, but \`/mnt/...\` never is (copy attached files into the task first) and paths inside script FILES on disk are never translated.

    IMPORTANT: \`npm\` is NOT available. Use \`${PNPM_COMMAND.name}\` for all package management.

    IMPORTANT: Not a persistent terminal -- each call starts fresh from the task root (\`${TASK_MOUNT_POINT}\`, your working directory), so \`cd .\` is always a no-op. Prefer relative paths (\`work/...\`, \`output/...\`). Only \`${TASK_MOUNT_POINT}\`, the \`/mnt\` mounts, and \`${SKILLS_MOUNT_POINT}\` exist; writing anywhere else (e.g. \`/tmp\`) fails -- use \`work/\` for scratch files. Shell state (env vars, exported functions, cwd) does NOT carry across calls; to run somewhere else, prefix your command (\`cd subdir && ...\`) within a single call.

    IMPORTANT: Backgrounding is NOT supported. Each call must complete within \`timeoutMs\`.

    IMPORTANT: Prefer specialized tools over shell equivalents:
      - Use the \`${TOOL_NAMES.readFile}\` tool instead of \`cat\`/\`head\`/\`tail\`.
      - Use the \`${TOOL_NAMES.editFile}\`/\`${TOOL_NAMES.writeFile}\` tools instead of \`sed\`/\`awk\`/redirects for editing.
      - For audio, video, or image inspection, prefer \`${FFPROBE_COMMAND.name} -v error -show_format -show_streams -of json <path>\` over \`file\`.

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
  sessionId,
  taskId,
}: {
  attachedFolders?: Record<string, FolderAttachment.Type>;
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  // The layout is the single source of truth for what the agent can see: the
  // writable task directory mounted at /task (the working directory) plus any
  // read-only user-attached folders under /mnt. The bash interpreter, the
  // native-binary path bridge, and the dedicated file tools all route through
  // it so they agree on virtual<->real mapping.
  const layout = buildWorkspaceFsLayout({
    attachedFolders,
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
      ...CUSTOM_COMMAND_DEFS.map((cmd) => cmd.factory(taskId)),
      createWhichCommand(
        new Set([
          AGENT_BROWSER_COMMAND.name,
          ...allowedCommands,
          ...CUSTOM_COMMAND_DEFS.map((cmd) => cmd.name),
        ]),
      ),
      ...STATIC_STUB_COMMANDS,
    ],
    cwd: TASK_MOUNT_POINT,
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
