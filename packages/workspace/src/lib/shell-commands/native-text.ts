import { type Command, defineCommand } from "just-bash";
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, rmSync, statSync } from "node:fs";
import nodePath from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { CHAT_FOLDER_NAMES } from "../../constants";
import { isAtOrUnder, relativeWithin } from "../path-containment";
import { ruleRefusal } from "../permissions/rules-fs";
import { getWorkspaceConfig } from "../workspace-config";
import {
  classifyShellPath,
  otherFolders,
  outsideFolderRefusal,
  resolveHostPath,
  shellPath,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { hostPathArgs, resolveCommandContext, subprocessStdin } from "./utils";

/** The bundled uutils binaries, by their base name. */
type UutilsBinary = "coreutils" | "diffutils" | "find" | "grep" | "xargs";

/**
 * A GNU text command the bundled uutils answer, every time it runs on the
 * platforms it lists. Which commands are here is a fixed table rather than a
 * decision made per call, so a command answers the same way in a loop as on
 * its own.
 */
interface NativeTextRoute {
  binary: UutilsBinary;
  name: string;
  /** Where the uutils program answers it; elsewhere the builtin keeps it. */
  platforms?: NodeJS.Platform[];
  /** Operands it writes rather than reads (`sort -o out`, `dd of=out`). */
  writes?: (args: string[]) => string[];
  /**
   * Prints nothing but paths, so on Windows every backslash it prints is a
   * separator the shell spells as a slash.
   */
  printsPaths?: boolean;
  /** Walks the folders it is given, which the sandbox may refuse on the way. */
  walks?: (args: string[]) => boolean;
}

const UNIX: NodeJS.Platform[] = ["darwin", "linux"];

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

/** A recursive search. */
export function grepWalks(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--recursive" ||
      arg === "--dereference-recursive" ||
      /^-[a-zA-Z]*[rR]/.test(arg),
  );
}

/**
 * Not here, so the builtin answers: `tr` (ties the builtin and runs in
 * loops), `diff`, `sed` and `awk` (the uutils ones fail cases the builtins
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
  { binary: "diffutils", name: "cmp" },
  // On Windows both join the paths they walk with `/`, as the shell spells
  // them, because they run with UUTILS_PATH_SEPARATOR (pathSeparatorEnv).
  { binary: "grep", name: "grep", walks: grepWalks },
  { binary: "find", name: "find", walks: () => true },
  // What xargs starts is a program on the PATH. Windows has no `echo` or
  // `printf` of its own, so there xargs' PATH starts with links to the
  // coreutils it carries (coreutilsLinks).
  { binary: "xargs", name: "xargs" },
];

/** find's own options before its start points. */
const FIND_LEADING = /^-(?:[HLP]|D|O\d?)$/;

/** The actions that stop find adding its own -print. */
const FIND_ACTIONS = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-ls",
  "-ok",
  "-okdir",
  "-print",
  "-print0",
  "-printf",
  "-quit",
]);

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
 * find's arguments with the entries the app hides pruned before the
 * caller's expression runs: every `.instrument` folder by name, and each
 * `pathsToPrune` (the chat's `tasks/` as each start point spells it). The
 * shell's own find never lists them, and the native sandbox does not hide
 * them. An expression with no action of its own gets an explicit -print, so
 * the pruned folder is not printed by the one find would add.
 */
export function findWithHiddenEntriesPruned(
  args: string[],
  pathsToPrune: string[],
): string[] {
  const { expression, options, starts } = splitFind(args);
  const pruned = [
    "-name",
    ".instrument",
    ...pathsToPrune.flatMap((each) => ["-o", "-path", each]),
  ];
  const acts = expression.some((arg) => FIND_ACTIONS.has(arg));
  return [
    ...options,
    ...starts,
    "(",
    ...pruned,
    ")",
    "-prune",
    "-o",
    "(",
    ...(expression.length > 0 ? expression : ["-true"]),
    ")",
    ...(acts ? [] : ["-print"]),
  ];
}

/**
 * The chat's hidden entries other than `.instrument` (which is pruned by
 * name) that a walk from each start point reaches, spelled as find prints
 * them from that start: `./tasks` from the chat's folder.
 */
function maskedUnder(
  starts: string[],
  layout: WorkspaceFsLayout,
  resolvePath: (arg: string) => string,
): string[] {
  return starts.flatMap((start) => {
    const resolved = resolvePath(start);
    const spelled = start.replace(/\/+$/, "");
    return layout.chat.maskedEntries
      .filter((entry) => entry !== CHAT_FOLDER_NAMES.private)
      .flatMap((entry) => {
        const rest = relativeWithin(
          resolved,
          `${layout.chat.shellRoot}/${entry}`,
        );
        return rest === null || rest === "/" ? [] : [`${spelled}${rest}`];
      });
  });
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
  const { toolBinDir } = getWorkspaceConfig();
  const coreutils = uutilsProgram("coreutils");
  if (toolBinDir === undefined || coreutils === undefined) {
    return linksDir;
  }
  const dir = nodePath.join(nodePath.dirname(toolBinDir), "uutils-links");
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

/** How uutils' find reports a folder the native sandbox refused. */
const FIND_REFUSED =
  /^Error: .*: (?:Operation not permitted|Permission denied) \(os error \d+\)$/;

/**
 * find's stderr with each folder the sandbox refused on the way left out
 * and counted in one line instead: over the home folder that is a line per
 * closed entry, dozens of them, where the shell's own find passes them
 * quietly.
 */
export function quietRefusedFolders(stderr: string): string {
  const lines = stderr.split("\n");
  const kept = lines.filter((line) => !FIND_REFUSED.test(line));
  const left = lines.length - kept.length;
  if (left === 0) {
    return stderr;
  }
  const rest = kept.join("\n");
  return `${rest}${rest === "" || rest.endsWith("\n") ? "" : "\n"}find: left out ${left} ${left === 1 ? "folder" : "folders"} the person keeps closed\n`;
}

/** Each archive a route's binary comes from. */
const BINARY_PROJECTS: Record<UutilsBinary, string> = {
  coreutils: "coreutils",
  diffutils: "diffutils",
  find: "findutils",
  grep: "grep",
  xargs: "findutils",
};

/**
 * The fixed table as Markdown, one row per command and a column per
 * platform: what docs/architecture/native-and-builtin-commands.md shows,
 * held equal to this file by native-text-doc.test.ts.
 */
export function nativeTextRoutesTable(): string {
  const cell = (route: NativeTextRoute, platform: NodeJS.Platform) =>
    (route.platforms?.includes(platform) ?? true) ? "uutils" : "builtin";
  const rows = NATIVE_TEXT_ROUTES.toSorted((a, b) =>
    a.name.localeCompare(b.name),
  ).map(
    (route) =>
      `| \`${route.name}\` | ${cell(route, "darwin")} | ${cell(route, "linux")} | ${cell(route, "win32")} | uutils ${BINARY_PROJECTS[route.binary]} |`,
  );
  return [
    "| Command | macOS | Linux | Windows | From |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The bundled program for a route, when this build carries it. */
export function uutilsProgram(binary: UutilsBinary): string | undefined {
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

/** The routes this platform and build answer natively. */
export function nativeTextRoutes(): NativeTextRoute[] {
  return NATIVE_TEXT_ROUTES.filter(
    (route) =>
      (route.platforms?.includes(process.platform) ?? true) &&
      uutilsProgram(route.binary) !== undefined,
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
  const roots = [layout.chat, ...otherFolders(layout)].map(
    (folder) => folder.shellRoot,
  );
  const written = new Set(route.writes?.(args) ?? []);
  let operandsOnly = false;
  for (const arg of [...args, ...written]) {
    const isOperand = written.has(arg) || operandsOnly || !arg.startsWith("-");
    operandsOnly ||= arg === "--";
    if (!isOperand || arg === "" || arg === "-") {
      continue;
    }
    const op = written.has(arg) ? "write" : "read";
    const resolved = resolvePath(arg);
    if (classifyShellPath(layout, resolved)?.masked !== undefined) {
      return `${route.name}: ${arg}: No such file or directory`;
    }
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

/**
 * The shell command for one route: the bundled uutils program in a native
 * sandbox, with the same working directory, environment, stdin and
 * cancellation every native command gets.
 */
export function createNativeTextCommand(
  route: NativeTextRoute,
  { chatId, layout }: { chatId: ChatId; layout: WorkspaceFsLayout },
): Command {
  return defineCommand(route.name, async (args, ctx) => {
    const walks = route.walks?.(args) ?? false;
    const program = uutilsProgram(route.binary);
    if (program === undefined) {
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
    const refusal = operandRefusal(route, starts ?? args, layout, resolvePath);
    if (refusal) {
      return { exitCode: 2, stderr: `${refusal}\n`, stdout: "" };
    }
    const programArgs = starts
      ? findWithHiddenEntriesPruned(
          args,
          maskedUnder(starts.length > 0 ? starts : ["."], layout, resolvePath),
        )
      : args;
    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const stdin = subprocessStdin(ctx.stdin);
    const multicall =
      route.binary === "coreutils" || route.binary === "diffutils";
    const argv = [
      ...(multicall ? [route.name] : []),
      ...hostPathArgs(programArgs),
    ];
    const windows = process.platform === "win32";
    const result = await execShim(
      program,
      // uutils on Windows expands `*`, `?` and `[...]` in any argument that
      // reached it unquoted, and Node quotes only those holding a space:
      // `cut -d '*'` would get file names. Every argument goes quoted.
      windows ? argv.map((arg) => quoteWindowsArgument(arg)) : argv,
      {
        cancelSignal: ctx.signal,
        cwd: hostCwd,
        env: !windows
          ? env
          : route.name === "xargs"
            ? xargsEnv(env)
            : route.binary === "find" || route.binary === "grep"
              ? pathSeparatorEnv(env)
              : env,
        ...(windows ? { windowsVerbatimArguments: true } : {}),
        // A walk was checked where it starts; a folder it passes that the
        // sandbox refuses is skipped without a card, as the shell's own
        // walks skip one.
        ...(walks ? { walks: true as const } : {}),
        // `sort` with no file reads stdin, so an empty pipe has to reach it
        // as one, and no pipe as nothing to read.
        ...((stdin ?? ctx.stdinConnected)
          ? { input: stdin ?? Buffer.alloc(0) }
          : { stdin: "ignore" as const }),
      },
    );
    // Text tools print data rather than progress, so there is no carriage
    // return redraw to collapse; what they print is still filtered for
    // credentials like any native output.
    const streams = mapStreams(shimOutput(result, route.name), (text) =>
      filterShellOutput(text),
    );
    return {
      exitCode: result.exitCode ?? 1,
      stderr:
        route.name === "find"
          ? quietRefusedFolders(streams.stderr)
          : streams.stderr,
      stdout:
        route.printsPaths && process.platform === "win32"
          ? streams.stdout.replaceAll("\\", "/")
          : streams.stdout,
    };
  });
}
