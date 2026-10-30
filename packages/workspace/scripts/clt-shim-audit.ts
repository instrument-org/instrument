/**
 * Reports which macOS Command Line Tools stubs a skill install actually
 * reaches. On a Mac that has never installed the tools, a stub asks a launchd
 * service to put the installer dialog on screen, so the list this prints is
 * the list of ways a skill load could show someone that dialog.
 *
 * The audit runs on a normal developer/CI Mac, where the tools are present and
 * no dialog can appear. Two passes:
 *
 * - `shadow` (default) prepends a directory of logging stubs to PATH, so any
 *   `git`/`make`/`python3`/... resolved by name is recorded and then passed
 *   through to the real binary. The install completes as usual; the log is the
 *   evidence. Exits non-zero on a stub outside EXPECTED_SHIMS.
 * - `sandboxed` (default) has the logging stubs answer the way real ones do on
 *   a Mac without the tools whose installer service is closed: Apple's "no
 *   install could be requested" error and exit 1, and `xcode-select -p`
 *   reporting no directory. Each stub also records whether it could have
 *   reached the installer service. The install has to succeed anyway with no
 *   stub reaching the service, and a real chat shell has to add its advice to
 *   a command that reached a stub, fail `xcode-select --install`, and keep a
 *   program it starts from the service. The service checks are skipped where
 *   no GUI session offers the service at all, as on a CI runner. This is the
 *   end-to-end regression test for the boundary.
 *
 * Exits non-zero on any failed install, unrunnable interpreter, unaccounted
 * stub, or (in `sandboxed`) a stub that reached the installer service or a
 * shell that did not say what to do.
 *
 * Usage:
 *   pnpm script:clt-shim-audit                          # spreadsheet, both passes
 *   pnpm script:clt-shim-audit -- --skill document-to-markdown
 *   pnpm script:clt-shim-audit -- --skill spreadsheet --skill pdf
 *   pnpm script:clt-shim-audit -- --mode shadow         # one pass only
 *   pnpm script:clt-shim-audit -- --mode sandboxed      # is the installer closed?
 *   pnpm script:clt-shim-audit -- --keep                # leave the scratch dirs behind
 */

import "dotenv/config";

import "./lib/define-globals-apply";

import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";

import { COMMAND_LINE_TOOLS_INSTALLER } from "../src/lib/command-line-tools-env";
import { createBashEnv } from "../src/lib/create-bash-env";
import { seatbeltAvailable } from "../src/lib/native-sandbox";
import {
  ensureNodeEnvironment,
  ensurePythonEnvironment,
} from "../src/lib/skill-environments";
import { getSkillRuntime } from "../src/lib/skill-runtime";
import { loadChatIndex, placeChat } from "../src/lib/record-folders";
import { venvPython } from "../src/lib/uv";
import { workDir } from "../src/lib/work-dir";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { AbsolutePathSchema } from "../src/schemas/paths";
import { StoreId } from "../src/schemas/store-id";
import { ChatIdSchema } from "../src/schemas/chat-id";
import { CLT_SHIM_NAMES, SAFE_SHIM_INVOCATIONS } from "./lib/clt-shims";
import { createStubWorkspaceConfig } from "./lib/stub-workspace-config";

const MODES = ["shadow", "sandboxed"] as const;
type Mode = (typeof MODES)[number];

/**
 * Stubs a clean run is known to reach, so anything else is new exposure to
 * reason about rather than noise to skim past. `install_name_tool` is uv
 * relocating the managed interpreter's libpython, which it treats as
 * best-effort; `xcode-select -p` is a probe, the one stub that reports a
 * missing developer directory instead of offering to install one.
 */
const EXPECTED_SHIMS = new Set(["install_name_tool", "xcode-select"]);

/** Long enough for a cold uv cache to fetch numpy/pandas on a slow connection. */
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

interface ShimInvocation {
  args: string[];
  /**
   * What looking up the installer service returned where the stub ran: `0`
   * is a service it could ask. Empty in a pass that does not look.
   */
  installer: string;
  name: string;
  parent: string;
}

interface SkillResult {
  interpreter?: string;
  node?: { exitCode: number; output: string };
  python?: { output?: string; state: string };
  skill: string;
}

function indent(text: string) {
  return text
    .split("\n")
    .slice(0, 20)
    .map((line) => `    | ${line}`)
    .join("\n");
}

/** A chat and its work folder, empty, as the chat's first command finds it. */
async function placeAuditChat() {
  const chatId = ChatIdSchema.parse(ulid().toLowerCase());
  // Put in the chat index, so every later lookup of the id finds its folder.
  const sessionId = StoreId.newSessionId();
  await fs.mkdir(placeChat(chatId, sessionId), { recursive: true });
  const dir = workDir(chatId);
  await fs.mkdir(dir, { recursive: true });
  return { chatId, dir, sessionId };
}

/**
 * Does the mach-lookup of the installer service a stub makes, as Python's
 * ctypes can, and prints the kern_return_t: 0 is a port, anything else is
 * no service to ask.
 */
const INSTALLER_LOOKUP = [
  "import ctypes, sys",
  'lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")',
  "port = ctypes.c_uint(0)",
  'print(lib.bootstrap_look_up(ctypes.c_uint.in_dll(lib, "bootstrap_port"), sys.argv[1].encode(), ctypes.byref(port)))',
].join("\n");

/**
 * Whether the installer service is in reach of a process outside the sandbox
 * here. Without a GUI session (a CI runner) it is in reach of nothing, so a
 * refusal inside the sandbox would prove nothing.
 */
async function installerReachableOutside() {
  if (!seatbeltAvailable()) {
    return {
      reachable: false,
      why: "Seatbelt cannot be applied from this process",
    };
  }
  const outside = await execa(
    "/usr/bin/python3",
    ["-c", INSTALLER_LOOKUP, COMMAND_LINE_TOOLS_INSTALLER],
    { reject: false },
  );
  const answer = outside.stdout.trim() || outside.stderr.trim();
  return answer === "0"
    ? { reachable: true, why: "" }
    : {
        reachable: false,
        why: `not reachable outside the sandbox either (${answer})`,
      };
}

/**
 * The boundary on a Mac without the tools, through a real chat shell: a
 * command that reached a stub fails with the advice to install the tools,
 * `xcode-select --install` fails though the stub exits 0, and a program the
 * shell starts cannot ask for the installer, whatever its environment.
 * Returns the failures.
 */
async function probeBoundary(installerReachable: boolean) {
  const { chatId, sessionId } = await placeAuditChat();
  const bash = await createBashEnv({
    chatId,
    sessionId,
  });
  let failed = 0;
  const report = (ok: boolean, line: string) => {
    if (!ok) {
      failed++;
    }
    process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${line}\n`);
  };

  process.stdout.write("\nshell boundary:\n");
  for (const command of [
    "make --version",
    "env make --version",
    "xcode-select --install",
  ]) {
    const result = await bash.exec(command);
    report(
      result.stderr.includes("needs Apple's Command Line Tools") &&
        result.exitCode !== 0,
      `${command}: exit ${result.exitCode}, ${result.stderr.trim().split("\n").at(-1) ?? ""}`,
    );
  }

  // The sandbox's half needs a Python; the chat's is the one a script runs.
  if (installerReachable) {
    const wrapped = await bash.exec(
      `python3 -c '${INSTALLER_LOOKUP}' ${COMMAND_LINE_TOOLS_INSTALLER}`,
    );
    report(
      wrapped.exitCode === 0 && wrapped.stdout.trim() !== "0",
      `installer service from inside the sandbox: ${wrapped.stdout.trim() || wrapped.stderr.trim()} (0 outside it)`,
    );
  }
  return failed;
}

/**
 * Builds the environments `load_skill` builds for the skill, in the pass's
 * runtime folder, for a throwaway chat.
 */
async function installSkill({
  registrySkillsDir,
  skillName,
}: {
  registrySkillsDir: string;
  skillName: string;
}): Promise<SkillResult> {
  const skillDir = AbsolutePathSchema.parse(
    path.join(registrySkillsDir, skillName),
  );
  const runtime = getSkillRuntime(skillDir, skillName);
  if ("error" in runtime) {
    throw new Error(runtime.error);
  }

  const { chatId } = await placeAuditChat();

  const signal = AbortSignal.timeout(INSTALL_TIMEOUT_MS);
  const result: SkillResult = { skill: skillName };

  if (runtime.node) {
    const built = await ensureNodeEnvironment({ chatId, signal, skillDir });
    result.node =
      "dir" in built
        ? { exitCode: 0, output: "" }
        : { exitCode: built.error.exitCode, output: built.error.output };
  }

  if (runtime.python) {
    const built = await ensurePythonEnvironment({ chatId, signal, skillDir });
    result.python =
      "venv" in built
        ? { state: "success" }
        : {
            output: built.error.output,
            state: `failure (${built.error.exitCode})`,
          };

    if ("venv" in built) {
      // uv patches the managed interpreter's dylib install name with
      // install_name_tool, which is one of the stubs. Running the interpreter is
      // what proves the install survives that step being unavailable.
      const probe = await execa(
        venvPython(built.venv),
        ["-c", "import sys; print(sys.version.split()[0])"],
        { all: true, reject: false },
      );
      result.interpreter =
        probe.exitCode === 0
          ? `runs (${probe.stdout.trim()})`
          : `BROKEN: ${probe.all.trim()}`;
    }
  }

  return result;
}

function parseArgs(argv: string[]) {
  let keep = false;
  const modes: Mode[] = [];
  const skills: string[] = [];

  const remaining = [...argv];
  while (remaining.length > 0) {
    const arg = remaining.shift();
    switch (arg) {
      // pnpm forwards its own `--` separator.
      case "--":
      case undefined: {
        break;
      }
      case "--keep": {
        keep = true;
        break;
      }
      case "--mode": {
        const value = remaining.shift();
        const mode = MODES.find((candidate) => candidate === value);
        if (mode === undefined) {
          throw new Error(`--mode must be one of: ${MODES.join(", ")}`);
        }
        modes.push(mode);
        break;
      }
      case "--skill": {
        const skill = remaining.shift();
        if (skill !== undefined) {
          skills.push(skill);
        }
        break;
      }
      default: {
        throw new Error(`unknown argument: ${arg}`);
      }
    }
  }

  return {
    keep,
    modes: modes.length > 0 ? modes : [...MODES],
    skills: skills.length > 0 ? skills : ["spreadsheet"],
  };
}

async function readShimLog(logPath: string): Promise<ShimInvocation[]> {
  const raw = await fs.readFile(logPath, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [name = "", parent = "", installer = "", ...args] =
        line.split("\t");
      return { args, installer, name, parent };
    });
}

function reportInstall(result: SkillResult) {
  const lines: string[] = [];
  if (result.node) {
    lines.push(
      `  node build:   ${result.node.exitCode === 0 ? "ok" : `FAILED (exit ${result.node.exitCode})`}`,
    );
    if (result.node.exitCode !== 0) {
      lines.push(indent(result.node.output));
    }
  }
  if (result.python) {
    lines.push(`  uv install:   ${result.python.state}`);
    if (result.python.output) {
      lines.push(indent(result.python.output));
    }
  }
  if (result.interpreter) {
    lines.push(`  interpreter:  ${result.interpreter}`);
  }
  return lines.join("\n");
}

function reportShims(invocations: ShimInvocation[]) {
  if (invocations.length === 0) {
    return "  no Command Line Tools stub was invoked";
  }

  const byName = new Map<string, ShimInvocation[]>();
  for (const invocation of invocations) {
    byName.set(invocation.name, [
      ...(byName.get(invocation.name) ?? []),
      invocation,
    ]);
  }

  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([name, calls]) => {
      const safeArgs = SAFE_SHIM_INVOCATIONS[name];
      const benign =
        safeArgs !== undefined &&
        calls.every((call) => call.args.every((arg) => safeArgs.includes(arg)));
      return [
        `  ${name} (${calls.length}x)${benign ? " -- probe only, never prompts" : ""}`,
        ...calls.slice(0, 5).map((call) => {
          const args = call.args.join(" ");
          return `    from ${call.parent || "?"}: ${name}${args ? ` ${args}` : ""}`;
        }),
        ...(calls.length > 5 ? [`    ... ${calls.length - 5} more`] : []),
      ];
    })
    .join("\n");
}

/**
 * The binaries Studio ships, not whatever the developer has on PATH. `pnpm` in
 * particular has to be the `.mjs` entry, because the workspace forks it with
 * node the same way the app does.
 */
async function resolveBundledBinary(bundled: string, fallbackName: string) {
  const exists = await fs
    .access(bundled)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    return AbsolutePathSchema.parse(bundled);
  }
  const { stdout } = await execa("which", [fallbackName], { reject: false });
  return AbsolutePathSchema.parse(stdout.trim() || `/usr/bin/${fallbackName}`);
}

/**
 * A stub per shim name that records the call and then hands off to the real
 * binary, so the install proceeds normally and the audit sees every invocation
 * rather than only the first. With `toolsMissing`, it answers as a real stub
 * does on a Mac without the tools whose installer service is closed, and
 * records whether that service was in reach.
 */
async function writeShimStubs({
  binDir,
  logPath,
  toolsMissing = false,
}: {
  binDir: string;
  logPath: string;
  toolsMissing?: boolean;
}) {
  await fs.mkdir(binDir, { recursive: true });

  await Promise.all(
    CLT_SHIM_NAMES.map(async (name) => {
      const real = path.join("/usr/bin", name);
      const handoff = !toolsMissing
        ? [`if [ -x '${real}' ]; then exec '${real}' "$@"; fi`, "exit 127"]
        : name === "xcode-select"
          ? [
              'if [ "$1" = --install ]; then',
              "  echo 'xcode-select: error: no developer tools were found, and no install could be requested (perhaps no UI is present), please install manually from developer.apple.com.' >&2",
              "  exit 0",
              "fi",
              "echo 'xcode-select: error: unable to get active developer directory' >&2",
              "exit 2",
            ]
          : [
              "echo 'xcode-select: error: No developer tools were found and no install could be requested (possibly because there is no active GUI session).' >&2",
              "exit 1",
            ];
      const script = [
        "#!/bin/sh",
        // By path, so this lookup is not itself a logged stub.
        toolsMissing
          ? `installer=$(/usr/bin/python3 -c '${INSTALLER_LOOKUP}' '${COMMAND_LINE_TOOLS_INSTALLER}' 2>&1)`
          : "installer=",
        "{",
        `  printf '%s\\t%s\\t%s' '${name}' "$(ps -o comm= -p "$PPID" 2>/dev/null | sed 's|.*/||')" "$installer"`,
        `  for arg in "$@"; do printf '\\t%s' "$arg"; done`,
        "  printf '\\n'",
        `} >> '${logPath}'`,
        ...handoff,
        "",
      ].join("\n");
      const stubPath = path.join(binDir, name);
      await fs.writeFile(stubPath, script, { mode: 0o755 });
    }),
  );
}

const args = parseArgs(process.argv.slice(2));

if (process.platform !== "darwin") {
  throw new Error("clt-shim-audit only means anything on macOS.");
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const registrySkillsDir = path.join(repoRoot, "registry", "skills");

let failures = 0;

const uvBinPath = await resolveBundledBinary(
  path.join(repoRoot, "apps/studio/resources/uv/uv"),
  "uv",
);
const pnpmBinPath = await resolveBundledBinary(
  path.join(repoRoot, "apps/studio/node_modules/pnpm/bin/pnpm.mjs"),
  "pnpm",
);
const originalPath = process.env.PATH ?? "";

for (const mode of args.modes) {
  // A cold uv cache and pnpm store per pass. A warm one skips the downloads,
  // and with them every subprocess the audit exists to observe.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `clt-audit-${mode}-`));
  const logPath = path.join(root, "shims.log");
  const binDir = path.join(root, "shim-bin");

  await writeShimStubs({
    binDir,
    logPath,
    toolsMissing: mode === "sandboxed",
  });
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;

  setWorkspaceConfig({
    ...createStubWorkspaceConfig({ tasksDir: path.join(root, "tasks") }),
    pnpmBinPath,
    uvBinPath,
  });
  await fs.mkdir(path.join(root, "tasks"), { recursive: true });
  await loadChatIndex();

  process.stdout.write(`\n=== pass: ${mode} ===\n`);
  process.stdout.write(`scratch: ${root}\n`);

  for (const skillName of args.skills) {
    process.stdout.write(`\n${skillName}\n`);
    try {
      const result = await installSkill({ registrySkillsDir, skillName });
      const installReport = reportInstall(result);
      if (installReport) {
        process.stdout.write(`${installReport}\n`);
      }
      // Independent conditions: a skill that installs its Node half and fails
      // its Python half is still a failure, as is one that installs both and
      // leaves an interpreter that cannot run.
      if (result.node !== undefined && result.node.exitCode !== 0) {
        failures++;
      }
      if (result.python?.state.startsWith("failure")) {
        failures++;
      }
      if (result.interpreter?.startsWith("BROKEN")) {
        failures++;
      }
    } catch (error) {
      failures++;
      process.stdout.write(
        `  install threw: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  const invocations = await readShimLog(logPath);
  process.stdout.write(`\nCommand Line Tools stubs reached:\n`);
  process.stdout.write(`${reportShims(invocations)}\n`);

  const unexpected = [
    ...new Set(
      invocations
        .map(({ name }) => name)
        .filter((name) => !EXPECTED_SHIMS.has(name)),
    ),
  ];
  if (unexpected.length > 0) {
    failures++;
    process.stdout.write(
      `\nUNEXPECTED: ${unexpected.join(", ")} -- a stub no previous run reached. ` +
        `On a Mac without the Command Line Tools this is a new way for the ` +
        `installer dialog to appear. Work out who calls it before adding it ` +
        `to EXPECTED_SHIMS.\n`,
    );
  }

  if (mode === "sandboxed") {
    const outside = await installerReachableOutside();
    if (!outside.reachable) {
      process.stdout.write(`\nskip installer service: ${outside.why}\n`);
    }
    // Read after the install's report, so the stubs this probe reaches on
    // purpose are not counted against EXPECTED_SHIMS.
    failures += await probeBoundary(outside.reachable);

    const reached = (await readShimLog(logPath)).filter(
      ({ installer }) => installer === "0",
    );
    if (outside.reachable && reached.length > 0) {
      failures++;
      process.stdout.write(
        `\nINSTALLER IN REACH: ${reached
          .map(({ name, parent }) => `${name} from ${parent || "?"}`)
          .join(", ")} -- on a Mac without the Command Line Tools each of ` +
          `these opens the installer dialog. The process that reached it ran ` +
          `outside a profile that closes the service.\n`,
      );
    }
  }

  if (!args.keep) {
    await fs.rm(root, { force: true, recursive: true });
  }
}

process.env.PATH = originalPath;
process.exitCode = failures > 0 ? 1 : 0;
