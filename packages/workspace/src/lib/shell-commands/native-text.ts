import { type Command, defineCommand } from "just-bash";
import { existsSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { isAtOrUnder } from "../path-containment";
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
type UutilsBinary = "coreutils" | "diffutils" | "grep" | "xargs";

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
 * Whether one of the arguments is the home folder or a folder holding it.
 * On macOS a native program walking there opens Desktop, Documents and
 * Music, and macOS puts up its own privacy dialog for each, which the walk
 * waits on until someone answers; the builtin asks the rules before it opens
 * a folder and never opens one they keep for asking.
 */
export function reachesAboveHome(args: string[], home = os.homedir()): boolean {
  return args.some((arg) => {
    if (!nodePath.isAbsolute(arg)) {
      return false;
    }
    const dir = nodePath.resolve(arg);
    return dir === "/" || isAtOrUnder(dir, home);
  });
}

/**
 * Not here, so the builtin answers: `find` (findutils 0.10.0 parses no
 * `-newermt` date, prints backslashes on Windows, and walks into macOS's
 * privacy dialogs), `tr` (ties the builtin and runs in loops), and `diff`,
 * `sed` and `awk` (the uutils ones fail cases the builtins pass).
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
  // On Windows a recursive grep prints relative paths with backslashes,
  // which nothing respells for the shell.
  { binary: "grep", name: "grep", platforms: UNIX, walks: grepWalks },
  // What xargs starts is a program on the PATH, and Windows has none for
  // `echo`, `printf` or most of what models hand it.
  { binary: "xargs", name: "xargs", platforms: UNIX },
];

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
    // The one call that does not go to uutils: a walk from the home folder
    // on macOS, which would hang on the system's privacy dialogs.
    if (
      ctx.origCommand !== undefined &&
      walks &&
      process.platform === "darwin" &&
      reachesAboveHome(args)
    ) {
      return await ctx.origCommand(args);
    }
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
    const refusal = operandRefusal(route, args, layout, (arg) =>
      ctx.fs.resolvePath(ctx.cwd, arg),
    );
    if (refusal) {
      return { exitCode: 2, stderr: `${refusal}\n`, stdout: "" };
    }
    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const stdin = subprocessStdin(ctx.stdin);
    const multicall =
      route.binary === "coreutils" || route.binary === "diffutils";
    const result = await execShim(
      program,
      [...(multicall ? [route.name] : []), ...hostPathArgs(args)],
      {
        cancelSignal: ctx.signal,
        cwd: hostCwd,
        env,
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
      stderr: streams.stderr,
      stdout:
        route.printsPaths && process.platform === "win32"
          ? streams.stdout.replaceAll("\\", "/")
          : streams.stdout,
    };
  });
}
