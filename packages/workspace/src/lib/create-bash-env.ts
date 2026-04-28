import { envForProviderConfigs } from "@instrument-org/ai-gateway";
import {
  Bash,
  type CommandName,
  type CommandNode,
  defineCommand,
  getCommandNames,
  getNetworkCommandNames,
  ReadWriteFs,
  type ScriptNode,
  type StatementNode,
  type TransformPlugin,
} from "just-bash";

import type { AppConfig } from "./app-config/types";

import { getWorkspaceServerURL } from "../logic/server/url";
import { type StoreId } from "../schemas/store-id";
import { type UpsertContextItem } from "./capture-browser-screenshot";
import {
  AGENT_BROWSER_COMMAND,
  createAgentBrowserCommand,
} from "./shell-commands/agent-browser";
import { createFfmpegCommand, FFMPEG_COMMAND } from "./shell-commands/ffmpeg";
import {
  createFfprobeCommand,
  FFPROBE_COMMAND,
} from "./shell-commands/ffprobe";
import { createNodeCommand, NODE_COMMAND } from "./shell-commands/node";
import { createPnpmCommand, PNPM_COMMAND } from "./shell-commands/pnpm";
import { createTsCommand, TS_COMMAND } from "./shell-commands/ts";
import { createTscCommand, TSC_COMMAND } from "./shell-commands/tsc";
import { createWhichCommand } from "./shell-commands/which";

// cspell:ignore mixmark papaparse

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
  // cspell:ignore compressjs
  "file", // depends on `file-type`, which uses a CJS dynamic require("tty") incompatible with just-bash's ESM bundle
  "html-to-markdown", // depends on `turndown`, which requires `@mixmark-io/domino` as an undeclared peer dependency
  "sqlite3", // requires a separately compiled worker.js on disk (via import.meta.url resolution) that is not present in the asar bundle; sql.js is excluded from the build
  "tar", // depends on `compressjs`, whose default export is undefined in the ESM bundle context, crashing on load
  "which", // always errors in this environment; replaced with a stub below
  "yq", // depends on `papaparse`, which uses a CJS dynamic require("process") incompatible with just-bash's ESM bundle
]);

const STATIC_STUB_COMMANDS = [
  stubCommand(
    "file",
    `file is not available. For audio, video, or image inspection, consider \`${FFPROBE_COMMAND.name} -v error -show_format -show_streams -of json <path>\`.`,
  ),
  stubCommand(
    "npm",
    "npm is not available in this environment. Use 'pnpm' instead (e.g. 'pnpm add <package>').",
  ),
  stubCommand("sqlite3", "SQLite is not available in this environment"),
  stubCommand("tar"),
  stubCommand("yq"),
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
};

interface CustomCommandDef {
  description: string;
  factory: (appConfig: AppConfig) => ReturnType<typeof defineCommand>;
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

  return [
    "Execute bash commands in the project directory.",
    "",
    "IMPORTANT: This is a sandboxed environment. python and other runtimes",
    "are NOT available as system binaries. Do NOT attempt to run them directly.",
    "Use the specialized `tsx` command below to execute TypeScript/JavaScript files.",
    "",
    "IMPORTANT: `npm` is NOT available. Use `pnpm` for all package management.",
    "",
    "IMPORTANT: Not a persistent terminal -- each call starts fresh from the project root, so `cd .` is always a no-op. Shell state (env vars, exported functions, cwd) does NOT carry across calls; to run somewhere else, prefix your command (`cd subdir && ...`) within a single call.",
    "",
    "IMPORTANT: Backgrounding is NOT supported. Each call must complete within `timeoutMs`.",
    "",
    "IMPORTANT: Prefer specialized tools over shell equivalents:",
    "  - Use the `read_file` tool instead of `cat`/`head`/`tail`.",
    "  - Use the `edit_file`/`write_file` tools instead of `sed`/`awk`/redirects for editing.",
    `  - The \`file\` command is unavailable. For audio, video, or image inspection, consider \`${FFPROBE_COMMAND.name} -v error -show_format -show_streams -of json <path>\`.`,
    "",
    "TIP: Before using an unfamiliar command, run `<command> --help` to check its argument syntax.",
    "",
    "TIP: Heredoc pipes/redirects go on the `<<EOF` line, not after `EOF`: `cmd <<'EOF' | jq` (not `cmd <<'EOF'` ... `EOF` ... `| jq`).",
    "",
    `Available commands: ${namedOnly.join(", ")}`,
    "",
    "Specialized commands:",
    ...described,
    ...customLines,
  ].join("\n");
}

export function createBashEnv({
  appConfig,
  sessionId,
  upsertContextItem,
}: {
  appConfig: AppConfig;
  sessionId: StoreId.Session;
  upsertContextItem: UpsertContextItem;
}) {
  const fs = new ReadWriteFs({ root: appConfig.appDir });

  const allowedCommands = [
    ...getCommandNames(),
    ...getNetworkCommandNames(),
  ].filter(
    (name) => !BROKEN_COMMANDS.has(name as CommandName),
  ) as CommandName[];

  const providerEnv = envForProviderConfigs({
    configs: appConfig.workspaceConfig.getAIProviderConfigs(),
    workspaceServerURL: getWorkspaceServerURL(),
  });

  const bash = new Bash({
    commands: allowedCommands,
    customCommands: [
      createAgentBrowserCommand({
        appConfig,
        sessionId,
        upsertContextItem,
      }),
      ...CUSTOM_COMMAND_DEFS.map((cmd) => cmd.factory(appConfig)),
      createWhichCommand(
        new Set([
          AGENT_BROWSER_COMMAND.name,
          ...allowedCommands,
          ...CUSTOM_COMMAND_DEFS.map((cmd) => cmd.name),
        ]),
      ),
      ...STATIC_STUB_COMMANDS,
    ],
    cwd: "/",
    network: {
      // No per-domain allow-list to maintain; the agent legitimately fetches
      // arbitrary public URLs (downloads, scraping, etc.). Someday: gate this
      // behind a per-session human-in-the-loop allow-list / approval prompt.
      dangerouslyAllowFullInternetAccess: true,
      // SSRF block: loopback/RFC1918/metadata, with DNS check + redirect re-check.
      // Enforced even when the dangerously-allow flag is on.
      denyPrivateRanges: true,
    },
    // Seed with process.env so PATH and other system vars are available to
    // commands that pass ctx.env explicitly (e.g. pnpm, tsx). Provider env
    // overrides last so AI keys are always present. pnpm shim files also
    // use sed, uname, etc when on unix systems.
    env: {
      NO_COLOR: "1",
      ...(process.env.PATH && { PATH: process.env.PATH }),
      ...providerEnv,
    },
    fs,
  });

  bash.registerTransformPlugin(commandOrderPlugin);

  return bash;
}
