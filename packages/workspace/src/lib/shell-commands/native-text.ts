import {
  type Command,
  type CommandContext,
  defineCommand,
  getCommandNames,
} from "just-bash";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import nodePath from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { inheritedEnv } from "../native-env";
import { isAtOrUnder } from "../path-containment";
import { macosRefusalNote } from "../chat/asks";
import { reachOf } from "../permissions/rules";
import { ruleRefusal } from "../permissions/rules-fs";
import { runtimeLayout } from "../runtime-dir";
import { getWorkspaceConfig } from "../workspace-config";
import {
  hostPathOf,
  otherFolders,
  outsideFolderRefusal,
  resolveHostPath,
  shellPath,
  shellPathOfHostSpelling,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { recordBuiltinAnswered } from "./command-runs";
import { binaryStdout, mapStreams, shimOutput } from "./exec-shim";
import { runNative } from "./pipe-stage";
import { tarProgramArgs, tarWrites, tarWritesStdout } from "./tar-args";
import {
  classifyProcessList,
  type ProcessLister,
  systemOwned,
} from "./unsandboxed-process-list";
import { classifyLog, type LogCall } from "./unsandboxed-log";
import { classifyUnsandboxed, type TierBFixup } from "./unsandboxed-uutils";
import { unsandboxedEnv } from "./unsandboxed-uutils-env";
import { uutilsBinaryReviewed } from "./unsandboxed-uutils-integrity";
import { openOperandForStdin } from "./unsandboxed-uutils-operand";
import { hostPathArgs, resolveCommandContext, subprocessStdin } from "./utils";

/** The bundled uutils binaries, by their base name. */
type UutilsBinary = "coreutils" | "diffutils" | "find" | "grep" | "xargs";

/**
 * A GNU text command the bundled uutils or the computer's own program
 * answer, every time it runs on the platforms it lists. Which commands are
 * here is a fixed table rather than a decision made per call, so a command
 * answers the same way in a loop as on its own.
 */
interface NativeTextRoute {
  binary: UutilsBinary | "system";
  /**
   * For `system`, where the computer keeps the program on each platform,
   * first match winning. A computer without it leaves the name to the
   * builtin.
   */
  system?: Partial<Record<NodeJS.Platform, () => string[]>>;
  name: string;
  /** Where the program answers it; elsewhere the builtin keeps it. */
  platforms?: NodeJS.Platform[];
  /** Operands it writes rather than reads (`sort -o out`, `dd of=out`). */
  writes?: (args: string[]) => string[];
  /**
   * Prints nothing but paths, so on Windows every backslash it prints is a
   * separator the shell spells as a slash.
   */
  printsPaths?: boolean;
  /**
   * Its operands are names it only takes apart and never opens (`basename`,
   * `dirname`), so none is held to the rules as a path.
   */
  opensNothing?: boolean;
  /**
   * Arguments the program accepts but does not honor, which send the call
   * to the builtin; `args` is how the generated table names them.
   */
  builtinFor?: { args: string; matches: (args: string[]) => boolean };
  /** Arguments that make it write data to stdout (an archive) rather than text. */
  writesData?: (args: string[]) => boolean;
  /** The arguments as the program gets them, when they differ. */
  programArgs?: (args: string[]) => string[];
  /** Variables the program runs with besides the shell's own. */
  env?: Record<string, string>;
  /**
   * Reads what the sandbox would hide or keep it from starting (the person's
   * processes, the system log): runs outside the sandbox, from a program the
   * system owns, with only the calls this allows, and is refused otherwise.
   */
  outsideSandbox?: (args: readonly string[]) => LogCall;
}

const listsProcesses =
  (name: ProcessLister) =>
  (args: readonly string[]): LogCall =>
    classifyProcessList(name, args);

const UNIX: NodeJS.Platform[] = ["darwin", "linux"];

/** Where a Linux distribution keeps a system program. */
const linuxBin = (name: string) => [`/usr/bin/${name}`, `/bin/${name}`];

/** The value of `-o FILE`, `-oFILE` or `--output=FILE`. */
function sortOutput(args: string[]): string[] {
  const out: string[] = [];
  args.forEach((arg, index) => {
    if (arg === "-o" || arg === "--output") {
      const next = args[index + 1];
      if (next !== undefined) {
        out.push(next);
      }
    } else if (arg.startsWith("--output=")) {
      out.push(arg.slice("--output=".length));
    } else if (/^-o./.test(arg)) {
      out.push(arg.slice(2));
    }
  });
  return out;
}

/** split's short options that take a value, joined or the next argument. */
const SPLIT_SHORT_VALUE = /[abClnt]/;

/** split's long options that take the next argument when not joined by `=`. */
const SPLIT_LONG_VALUE = new Set([
  "--additional-suffix",
  "--bytes",
  "--filter",
  "--io-blksize",
  "--line-bytes",
  "--lines",
  "--number",
  "--separator",
  "--suffix-length",
]);

/**
 * The prefix split names its pieces by (`split [OPTION]... [FILE [PREFIX]]`,
 * `x` by default): each piece is the prefix with a suffix that holds no
 * separator, so it is written where the prefix is.
 */
export function splitPrefix(args: string[]): string {
  const operands: string[] = [];
  let onlyOperands = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (onlyOperands || arg === "-" || !arg.startsWith("-")) {
      operands.push(arg);
    } else if (arg === "--") {
      onlyOperands = true;
    } else if (arg.startsWith("--")) {
      if (!arg.includes("=") && SPLIT_LONG_VALUE.has(arg)) {
        index++;
      }
    } else if (!/^-\d+$/.test(arg)) {
      // A cluster ends at the first letter taking a value: the rest of the
      // cluster is that value, or else the next argument is.
      const at = arg.slice(1).search(SPLIT_SHORT_VALUE);
      if (at !== -1 && at === arg.length - 2) {
        index++;
      }
    }
  }
  return operands[1] ?? "x";
}

/** xargs' long options that take the next argument as their value. */
const XARGS_LONG_VALUE = new Set([
  "--arg-file",
  "--delimiter",
  "--max-args",
  "--max-chars",
  "--process-slot-var",
]);

/**
 * Asks for parallel runs (`-P N`, `-ON`, `-0P4`, `--max-procs=N`), in the
 * options before the command xargs starts. uutils xargs 0.10.0 accepts `-P`
 * and runs one at a time; the builtin runs that many at once.
 */
export function xargsRunsParallel(args: string[]): boolean {
  return scanXargs(args).parallel;
}

/**
 * Starts `kill`, which the builtin xargs runs as the shell's own: the one
 * that can reach the agent's processes, where the program on the PATH runs
 * in a sandbox of its own and reaches none of them.
 */
function xargsRunsKill(args: string[]): boolean {
  return scanXargs(args).command === "kill";
}

/** xargs' options, up to the command it starts. */
function scanXargs(args: string[]): { command?: string; parallel: boolean } {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) {
      return { parallel: false };
    }
    if (arg === "--") {
      return { command: args[index + 1], parallel: false };
    }
    if (!/^-./.test(arg)) {
      return { command: arg, parallel: false };
    }
    if (arg.startsWith("--")) {
      if (arg === "--max-procs" || arg.startsWith("--max-procs=")) {
        return { parallel: true };
      }
      if (XARGS_LONG_VALUE.has(arg)) {
        index++;
      }
      continue;
    }
    for (let at = 1; at < arg.length; at++) {
      const flag = arg.charAt(at);
      if (flag === "P") {
        return { parallel: true };
      }
      if ("adEILns".includes(flag)) {
        // The rest of the cluster is its value, or else the next argument.
        if (at === arg.length - 1) {
          index++;
        }
        break;
      }
      if ("eil".includes(flag)) {
        // An optional value, only ever the rest of the cluster.
        break;
      }
    }
  }
  return { parallel: false };
}

/**
 * Not here, so the builtin answers: `tr` (ties the builtin and runs in
 * loops), `mktemp` (ties the builtin, and on Windows uutils 0.12.0 drops the
 * `/` before the X's of `dir/XXXXXX`, creating `dirXXXXXX` in the working
 * folder), `diff`, `sed` and `awk` (the uutils ones fail cases the builtins
 * pass).
 */
const NATIVE_TEXT_ROUTES: readonly NativeTextRoute[] = [
  { binary: "coreutils", name: "sort", writes: sortOutput },
  { binary: "coreutils", name: "uniq" },
  { binary: "coreutils", name: "comm" },
  { binary: "coreutils", name: "join" },
  { binary: "coreutils", name: "cut" },
  { binary: "coreutils", name: "wc" },
  { binary: "coreutils", name: "head" },
  { binary: "coreutils", name: "tail" },
  { binary: "coreutils", name: "date" },
  { binary: "coreutils", name: "seq" },
  { binary: "coreutils", name: "od" },
  { binary: "coreutils", name: "sha256sum" },
  { binary: "coreutils", name: "md5sum" },
  { binary: "coreutils", name: "numfmt" },
  { binary: "coreutils", name: "realpath", printsPaths: true },
  { binary: "coreutils", name: "shuf" },
  {
    binary: "coreutils",
    name: "dd",
    writes: (args) =>
      args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3)),
  },
  // uutils builds `stat` for Unix only.
  { binary: "coreutils", name: "stat", platforms: UNIX },
  { binary: "coreutils", name: "sha1sum" },
  { binary: "coreutils", name: "base64" },
  { binary: "coreutils", name: "paste" },
  { binary: "coreutils", name: "nl" },
  { binary: "coreutils", name: "fold" },
  { binary: "coreutils", name: "tac" },
  { binary: "coreutils", name: "expand" },
  { binary: "coreutils", name: "unexpand" },
  {
    binary: "coreutils",
    name: "split",
    writes: (args) => [splitPrefix(args)],
  },
  { binary: "coreutils", name: "readlink", printsPaths: true },
  {
    binary: "coreutils",
    name: "basename",
    opensNothing: true,
    printsPaths: true,
  },
  {
    binary: "coreutils",
    name: "dirname",
    opensNothing: true,
    printsPaths: true,
  },
  // just-bash has no command by these names, so without uutils they fall to
  // the computer's PATH: the BSD ones on macOS, and on Windows usually none.
  // Only commands that print are here; the ones that change the system
  // (`shred`, `chown`, `mknod`, `kill`, ...) are left to the PATH.
  { binary: "coreutils", name: "arch" },
  { binary: "coreutils", name: "b2sum" },
  { binary: "coreutils", name: "base32" },
  { binary: "coreutils", name: "basenc" },
  { binary: "coreutils", name: "cksum" },
  { binary: "coreutils", name: "df" },
  { binary: "coreutils", name: "factor" },
  { binary: "coreutils", name: "fmt" },
  // uutils builds `id` for Unix only.
  { binary: "coreutils", name: "id", platforms: UNIX },
  { binary: "coreutils", name: "nproc" },
  { binary: "coreutils", name: "pr" },
  { binary: "coreutils", name: "sha224sum" },
  { binary: "coreutils", name: "sha384sum" },
  { binary: "coreutils", name: "sha512sum" },
  { binary: "coreutils", name: "tsort" },
  { binary: "coreutils", name: "uname" },
  { binary: "diffutils", name: "cmp" },
  // The computer's own diff (BSD on macOS, GNU on Linux) answers 9 of the
  // corpus's 11 diff cases on macOS, where the builtin answers 5 and uutils
  // diffutils 3. Windows has none, so the builtin keeps it there.
  {
    binary: "system",
    name: "diff",
    platforms: UNIX,
    system: { darwin: () => ["/usr/bin/diff"], linux: () => linuxBin("diff") },
  },
  // The computer's own file reads the magic numbers, where the builtin goes
  // by a few signatures and the extension: it calls random bytes UTF-8 text
  // and UTF-8 text ASCII, and names no image size or page count.
  {
    binary: "system",
    name: "file",
    platforms: UNIX,
    system: { darwin: () => ["/usr/bin/file"], linux: () => linuxBin("file") },
  },
  // `ps` and `top` are setuid root on macOS, which Seatbelt refuses to start;
  // inside bubblewrap's pid namespace on Linux they would see only the
  // command's own processes. Both run outside the sandbox with options that
  // only read (unsandboxed-process-list.ts).
  {
    binary: "system",
    name: "ps",
    outsideSandbox: listsProcesses("ps"),
    platforms: UNIX,
    system: { darwin: () => ["/bin/ps"], linux: () => linuxBin("ps") },
  },
  {
    binary: "system",
    name: "top",
    outsideSandbox: listsProcesses("top"),
    platforms: UNIX,
    system: { darwin: () => ["/usr/bin/top"], linux: () => linuxBin("top") },
  },
  // macOS `log` declines to run inside a sandbox, so the system log is read
  // outside it, with the verbs and options that only read
  // (unsandboxed-log.ts). Linux's journalctl runs sandboxed as it is.
  {
    binary: "system",
    name: "log",
    outsideSandbox: classifyLog,
    platforms: ["darwin"],
    system: { darwin: () => ["/usr/bin/log"] },
  },
  // Under MXC a program sees only the processes in its own container, so
  // `tasklist` runs outside it too, with options that only read. `taskkill`
  // stays a program on the PATH, held like any other.
  {
    binary: "system",
    name: "tasklist",
    outsideSandbox: listsProcesses("tasklist"),
    platforms: ["win32"],
    system: {
      win32: () => [
        nodePath.win32.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "tasklist.exe",
        ),
      ],
    },
  },
  // The builtin tar builds the whole archive in memory, refuses a file over
  // the shell's 256 MB read cap, and has no xz without a native module, and
  // every platform carries a tar that streams: bsdtar on macOS and in
  // Windows' System32 (since Windows 10), GNU tar on Linux. Windows' is
  // named by its full path, so another tar earlier on the PATH never runs.
  {
    binary: "system",
    // Keeps bsdtar on macOS from adding a `._` file of metadata beside each
    // file it archives.
    env: { COPYFILE_DISABLE: "1" },
    name: "tar",
    programArgs: tarProgramArgs,
    system: {
      darwin: () => ["/usr/bin/tar"],
      linux: () => linuxBin("tar"),
      win32: () => [
        nodePath.win32.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "tar.exe",
        ),
      ],
    },
    writes: tarWrites,
    writesData: tarWritesStdout,
  },
  // On Windows both join the paths they walk with `/`, as the shell spells
  // them, because they run with UUTILS_PATH_SEPARATOR (pathSeparatorEnv).
  { binary: "grep", name: "grep" },
  { binary: "find", name: "find" },
  // What xargs starts is a program on the PATH. Windows has no `echo` or
  // `printf` of its own, so there xargs' PATH starts with links to the
  // coreutils it carries (coreutilsLinks).
  {
    binary: "xargs",
    name: "xargs",
    builtinFor: {
      args: "`-P`, `--max-procs`, starting `kill`",
      matches: (args) => xargsRunsParallel(args) || xargsRunsKill(args),
    },
  },
];

/** find's own options before its start points. */
const FIND_LEADING = /^-(?:[HLP]|D|O\d?)$/;

/** A find command line split into its options, start points and expression. */
function splitFind(args: string[]): {
  expression: string[];
  options: string[];
  starts: string[];
} {
  let index = 0;
  const options: string[] = [];
  while (index < args.length && FIND_LEADING.test(args[index] ?? "")) {
    const option = args[index] ?? "";
    options.push(option);
    // -D takes a value of its own.
    if (option === "-D" && index + 1 < args.length) {
      options.push(args[index + 1] ?? "");
      index += 1;
    }
    index += 1;
  }
  const starts: string[] = [];
  while (index < args.length && !/^[-(!,]/.test(args[index] ?? "")) {
    starts.push(args[index] ?? "");
    index += 1;
  }
  return { expression: args.slice(index), options, starts };
}

/**
 * One argument quoted the way Windows' CommandLineToArgvW reads it back,
 * whatever it holds: backslashes before a quote and at the end doubled, the
 * quote escaped.
 */
export function quoteWindowsArgument(arg: string): string {
  return `"${arg.replaceAll(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * Utilities left out of the links xargs' programs find first, because
 * System32 has a program by the same name that Windows itself relies on.
 * `sort` is shadowed on purpose: what a model hands xargs is GNU's.
 */
const SYSTEM32_NAMES = new Set([
  "expand",
  "hostname",
  "more",
  "timeout",
  "whoami",
]);

let linksDir: string | null | undefined;

/**
 * A folder of hard links to the coreutils multicall binary, one per utility
 * (`echo.exe`, `printf.exe`, `basename.exe`), so a program xargs starts by
 * name finds one: Windows has no `echo.exe` of its own. Made once per
 * launch beside the app's bin folder, and only xargs' PATH has it. Null
 * where the links cannot be made (another volume), which leaves xargs to
 * the PATH it had.
 */
function coreutilsLinks(): string | null {
  if (linksDir !== undefined) {
    return linksDir;
  }
  linksDir = null;
  const coreutils = uutilsProgram("coreutils");
  if (coreutils === undefined) {
    return linksDir;
  }
  const dir = nodePath.join(
    runtimeLayout(getWorkspaceConfig().runtimeDir).bin,
    "uutils-links",
  );
  try {
    mkdirSync(dir, { recursive: true });
    const names = execFileSync(coreutils, ["--list"], { encoding: "utf8" })
      .split(/\s+/)
      .filter((name) => /^[\w-]+$/.test(name) && !SYSTEM32_NAMES.has(name));
    const size = statSync(coreutils).size;
    for (const name of names) {
      const link = nodePath.join(dir, `${name}.exe`);
      if (existsSync(link) && statSync(link).size === size) {
        continue;
      }
      rmSync(link, { force: true });
      linkSync(coreutils, link);
    }
    linksDir = dir;
  } catch {
    linksDir = null;
  }
  return linksDir;
}

/** xargs' environment, with the coreutils links first on its PATH. */
function xargsEnv(env: Record<string, string>): Record<string, string> {
  const dir = coreutilsLinks();
  if (dir === null) {
    return env;
  }
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const rest = key === undefined ? "" : (env[key] ?? "");
  return { ...env, [key ?? "Path"]: `${dir};${rest}` };
}

/**
 * The environment for `find` and `grep`. On Windows a walk joins what it
 * finds with `\`, so they would print `reports\b.md`, and a `-path` or
 * `-prune` pattern written with `/` would match nothing. The build Studio
 * ships (instrument-org/uutils-build) joins with `/` when
 * UUTILS_PATH_SEPARATOR is `slash`.
 */
function pathSeparatorEnv(env: Record<string, string>): Record<string, string> {
  return { ...env, UUTILS_PATH_SEPARATOR: "slash" };
}

/** How uutils' find reports a folder it was refused, and with which error. */
const FIND_REFUSED =
  /^Error: (?<path>.*): (?<why>Operation not permitted|Permission denied) \(os error \d+\)$/;

/**
 * find's stderr with each folder the rules close left out and counted in
 * one line instead: over the home folder that is a line per closed entry,
 * dozens of them, where the shell's own find passes them quietly. A folder
 * the rules allow that was refused anyway with "Operation not permitted" is
 * macOS's own refusal on a Mac, which the person did not choose, so it is
 * named rather than counted among theirs; "Permission denied" there is the
 * account's, which find's own line already says, and so is either one off
 * macOS.
 */
export function quietRefusedFolders(
  stderr: string,
  closed: (hostPath: string) => boolean,
  spell: (hostPath: string) => string,
  platform: NodeJS.Platform = process.platform,
): string {
  let left = 0;
  const macos: string[] = [];
  const kept = stderr.split("\n").filter((line) => {
    const refused = FIND_REFUSED.exec(line)?.groups;
    if (refused?.path === undefined) {
      return true;
    }
    if (closed(refused.path)) {
      left++;
      return false;
    }
    if (platform === "darwin" && refused.why === "Operation not permitted") {
      macos.push(spell(refused.path));
      return false;
    }
    return true;
  });
  if (left === 0 && macos.length === 0) {
    return stderr;
  }
  const rest = kept.join("\n");
  const notes = [
    ...macos.map((shown) => `find: ${macosRefusalNote(JSON.stringify(shown))}`),
    ...(left === 0
      ? []
      : [
          `find: left out ${left} ${left === 1 ? "folder" : "folders"} the person keeps closed`,
        ]),
  ];
  return `${rest}${rest === "" || rest.endsWith("\n") ? "" : "\n"}${notes.join("\n")}\n`;
}

/** Where each route's program comes from, as the generated table says it. */
const BINARY_PROJECTS: Record<NativeTextRoute["binary"], string> = {
  coreutils: "uutils coreutils",
  diffutils: "uutils diffutils",
  find: "uutils findutils",
  grep: "uutils grep",
  system: "system",
  xargs: "uutils findutils",
};

/**
 * The fixed table as Markdown, one row per command and a column per
 * platform: what docs/architecture/native-and-builtin-commands.md shows,
 * held equal to this file by native-text-doc.test.ts.
 */
export function nativeTextRoutesTable(): string {
  const builtins = new Set(getCommandNames());
  // Where the route does not answer, the builtin does, or else the PATH.
  const cell = (route: NativeTextRoute, platform: NodeJS.Platform) =>
    (route.platforms?.includes(platform) ?? true)
      ? route.binary === "system"
        ? "system"
        : "uutils"
      : builtins.has(route.name)
        ? "builtin"
        : "PATH";
  const rows = NATIVE_TEXT_ROUTES.toSorted((a, b) =>
    a.name.localeCompare(b.name),
  ).map(
    (route) =>
      `| \`${route.name}\` | ${cell(route, "darwin")} | ${cell(route, "linux")} | ${cell(route, "win32")} | ${BINARY_PROJECTS[route.binary]} | ${route.builtinFor?.args ?? ""} |`,
  );
  return [
    "| Command | macOS | Linux | Windows | From | Builtin with |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The bundled program for a route, when this build carries it. */
function uutilsProgram(binary: UutilsBinary): string | undefined {
  const dir = getWorkspaceConfig().uutilsDir;
  if (dir === undefined) {
    return undefined;
  }
  const file = nodePath.join(
    dir,
    process.platform === "win32" ? `${binary}.exe` : binary,
  );
  return existsSync(file) ? file : undefined;
}

/**
 * The program a route runs here: the bundled uutils one, or the computer's
 * own, when this build and this computer carry it.
 */
export function routeProgram(route: NativeTextRoute): string | undefined {
  return route.binary === "system"
    ? route.system?.[process.platform]?.().find((file) => existsSync(file))
    : uutilsProgram(route.binary);
}

/**
 * The commands the build's own uutils answer on every platform: the same
 * list wherever it runs, for a tool description that may not differ between
 * computers. A route only one platform has, or one the computer's own
 * program answers, is that computer's to tell.
 */
export function bundledTextRouteNames(): string[] {
  return NATIVE_TEXT_ROUTES.filter(
    (route) => route.binary !== "system" && route.platforms === undefined,
  ).map((route) => route.name);
}

/** The routes this platform and build answer natively. */
export function nativeTextRoutes(): NativeTextRoute[] {
  return NATIVE_TEXT_ROUTES.filter(
    (route) =>
      (route.platforms?.includes(process.platform) ?? true) &&
      routeProgram(route) !== undefined,
  );
}

/**
 * Why the command may not run with these operands, naming the exact path a
 * card asks for: each argument that names an existing path is held to the
 * rules for a read (or a write, for `writes`), the way the shell's own
 * commands hold the paths they open. Which arguments are paths would take
 * parsing every command's options, so every non-option is asked; a pattern
 * or a key names nothing on disk and passes. A folder the program walks past
 * is the native sandbox's to refuse, quietly.
 */
function operandRefusal(
  route: NativeTextRoute,
  args: string[],
  layout: WorkspaceFsLayout,
  resolvePath: (arg: string) => string,
): string | undefined {
  if (route.opensNothing === true) {
    return undefined;
  }
  const roots = [layout.chat, ...otherFolders(layout)].map(
    (folder) => folder.shellRoot,
  );
  const written = new Set(route.writes?.(args) ?? []);
  const hostCwd = hostPathOf(resolvePath("."));
  let operandsOnly = false;
  for (const arg of [...args, ...written]) {
    const isOperand = written.has(arg) || operandsOnly || !arg.startsWith("-");
    operandsOnly ||= arg === "--";
    if (!isOperand || arg === "" || arg === "-") {
      continue;
    }
    const op = written.has(arg) ? "write" : "read";
    // An operand spelled the way this computer spells a path names the same
    // file as its shell spelling, and meets the same rules.
    const resolved =
      shellPathOfHostSpelling(arg, { hostCwd }) ?? resolvePath(arg);
    const refusal = roots.some((root) => isAtOrUnder(root, resolved))
      ? mountedRefusal(layout, resolved, op)
      : outsideFolderRefusal(layout, resolved, op);
    if (refusal) {
      return `${route.name}: ${arg}: Permission denied\n${refusal}`;
    }
  }
  return undefined;
}

/** The rules' answer for a path inside a folder the chat reaches. */
function mountedRefusal(
  layout: WorkspaceFsLayout,
  path: string,
  op: "read" | "write",
): string | undefined {
  const resolved = resolveHostPath(layout, path);
  if (resolved === null) {
    return undefined;
  }
  if (op === "read" && !existsSync(resolved.hostPath)) {
    return undefined;
  }
  return ruleRefusal({
    hostPath: resolved.hostPath,
    op,
    rules: layout.rules,
    spell: shellPath,
  });
}

/** How a call runs outside the native sandbox, when it may. */
interface UnsandboxedRun {
  args: string[];
  /** The file the call named, open, for the program's stdin (tier B). */
  fd?: number;
  fixup?: TierBFixup;
  operand?: string;
}

/**
 * Whether this call of a bundled uutils program runs outside the native
 * sandbox, and with what: a call the reviewed rules allow
 * (`unsandboxed-uutils.ts`), of a binary that is the one they were
 * reviewed against, where the app asks for it. A tier B call also needs its
 * file to pass the shell's checks, and stdin free for it: a stage reading
 * the previous one's pipe keeps it, and wc, whose output gains the file's
 * name here, does not hand its stdout straight to the next program.
 */
function unsandboxedRun(
  route: NativeTextRoute,
  args: string[],
  program: string,
  ctx: Pick<CommandContext, "offerPipeHandoff" | "stdinHandoff">,
  layout: WorkspaceFsLayout,
  resolvePath: (arg: string) => string,
): UnsandboxedRun | undefined {
  if (route.outsideSandbox !== undefined) {
    return { args };
  }
  if (
    (route.binary !== "coreutils" && route.binary !== "grep") ||
    getWorkspaceConfig().uutilsOutsideSandbox !== true
  ) {
    return undefined;
  }
  const tier = classifyUnsandboxed(route.name, args);
  if (tier.tier === "sandbox" || !uutilsBinaryReviewed(program)) {
    return undefined;
  }
  if (tier.tier === "A") {
    return { args };
  }
  if (
    ctx.stdinHandoff !== undefined ||
    (tier.fixup === "wcAppendName" && ctx.offerPipeHandoff === true)
  ) {
    return undefined;
  }
  const fd = openOperandForStdin({
    layout,
    operand: tier.operand,
    resolvePath,
  });
  return fd === undefined
    ? undefined
    : { args: tier.argv, fd, fixup: tier.fixup, operand: tier.operand };
}

/**
 * wc's output for one count of a file it read on stdin, as it prints it for
 * the file by name: the count, a space, the name.
 */
function withWcName(stdout: string, name: string): string {
  return /^\d+\n$/.test(stdout) ? `${stdout.slice(0, -1)} ${name}\n` : stdout;
}

/**
 * The shell command for one route: the bundled uutils program in a native
 * sandbox, with the same working directory, environment, stdin and
 * cancellation every native command gets.
 */
export function createNativeTextCommand(
  route: NativeTextRoute,
  { chatId, layout }: { chatId: ChatId; layout: WorkspaceFsLayout },
): Command {
  const command = defineCommand(route.name, async (args, ctx) => {
    const program = routeProgram(route);
    if (program === undefined || route.builtinFor?.matches(args) === true) {
      recordBuiltinAnswered(
        program !== undefined
          ? "builtin-args"
          : route.binary === "system"
            ? "no-system-program"
            : "no-bundled-program",
      );
      return ctx.origCommand
        ? await ctx.origCommand(args)
        : {
            exitCode: 127,
            stderr: `bash: ${route.name}: command not found\n`,
            stdout: "",
          };
    }
    const resolvePath = (arg: string) => ctx.fs.resolvePath(ctx.cwd, arg);
    // find's arguments after its start points are an expression, patterns
    // rather than paths.
    const starts = route.name === "find" ? splitFind(args).starts : undefined;
    const listing = route.outsideSandbox?.(args);
    if (listing?.allowed === false) {
      return { exitCode: 2, stderr: `${listing.reason}\n`, stdout: "" };
    }
    if (listing !== undefined && !systemOwned(program)) {
      return {
        exitCode: 126,
        stderr: `${route.name}: ${program} is not the system's own program, so it does not run here.\n`,
        stdout: "",
      };
    }
    const refusal =
      listing === undefined
        ? operandRefusal(route, starts ?? args, layout, resolvePath)
        : undefined;
    if (refusal) {
      return { exitCode: 2, stderr: `${refusal}\n`, stdout: "" };
    }
    const outside = unsandboxedRun(
      route,
      args,
      program,
      ctx,
      layout,
      resolvePath,
    );
    // Nothing inside a chat's folder is masked on this layout, so a find
    // needs no pruning: what the app keeps closed is the workspace's own
    // folder, which no mount reaches.
    const programArgs = outside
      ? outside.args
      : (route.programArgs?.(args) ?? args);
    const context = resolveCommandContext(chatId, ctx);
    const { hostCwd } = context;
    const env = outside
      ? unsandboxedEnv({ ...inheritedEnv(), ...context.env })
      : { ...context.env, ...route.env };
    const stdin = subprocessStdin(ctx.stdin);
    // The name wc prints for the file, as the program would have been given
    // it.
    const wcName =
      outside?.fixup === "wcAppendName" && outside.operand !== undefined
        ? hostPathArgs([outside.operand])[0]
        : undefined;
    const multicall =
      route.binary === "coreutils" || route.binary === "diffutils";
    const argv = [
      ...(multicall ? [route.name] : []),
      ...hostPathArgs(programArgs),
    ];
    // A system program takes Node's own quoting; uutils needs its own.
    const windows = process.platform === "win32" && route.binary !== "system";
    try {
      return await runNative(
        ctx,
        program,
        // uutils on Windows expands `*`, `?` and `[...]` in any argument that
        // reached it unquoted, and Node quotes only those holding a space:
        // `cut -d '*'` would get file names. Every argument goes quoted.
        windows ? argv.map((arg) => quoteWindowsArgument(arg)) : argv,
        {
          cancelSignal: ctx.signal,
          cwd: hostCwd,
          env:
            outside || !windows
              ? env
              : route.name === "xargs"
                ? xargsEnv(env)
                : route.binary === "find" || route.binary === "grep"
                  ? pathSeparatorEnv(env)
                  : env,
          ...(windows ? { windowsVerbatimArguments: true } : {}),
          ...(outside
            ? { ownEnvOnly: true as const, unsandboxed: true as const }
            : {}),
          // `sort` with no file reads stdin, so an empty pipe has to reach it
          // as one, and no pipe as nothing to read. A tier B call reads its
          // file there instead.
          ...(outside?.fd !== undefined
            ? { stdin: "ignore" as const, stdinFd: outside.fd }
            : (stdin ?? ctx.stdinConnected)
              ? { input: stdin ?? Buffer.alloc(0) }
              : { stdin: "ignore" as const }),
        },
        (result) => {
          // Text tools print data rather than progress, so there is no
          // carriage return redraw to collapse; what they print is still
          // filtered for credentials like any native output.
          const named =
            wcName === undefined || result.exitCode !== 0
              ? result
              : { ...result, stdout: withWcName(result.stdout, wcName) };
          const streams = mapStreams(shimOutput(named, route.name), (text) =>
            filterShellOutput(text),
          );
          return {
            exitCode: result.exitCode ?? 1,
            stderr:
              route.name === "find"
                ? quietRefusedFolders(
                    streams.stderr,
                    (hostPath) =>
                      reachOf(layout.rules, hostPath, "list").level !== "allow",
                    shellPath,
                  )
                : streams.stderr,
            stdout:
              route.printsPaths && process.platform === "win32"
                ? streams.stdout.replaceAll("\\", "/")
                : streams.stdout,
            ...binaryStdout(result, { data: route.writesData?.(args) }),
          };
        },
      );
    } finally {
      // The program holds its own copy once it started.
      if (outside?.fd !== undefined) {
        closeSync(outside.fd);
      }
    }
  });
  return {
    ...command,
    // A program takes the previous native stage's stdout as its fd 0; the
    // arguments it hands to the builtin read the bytes instead.
    acceptsPipeHandoff: (args: string[]) =>
      routeProgram(route) !== undefined &&
      route.builtinFor?.matches(args) !== true,
  };
}
