import { type Command, defineCommand, type ExecResult } from "just-bash";
import { existsSync } from "node:fs";
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
type UutilsBinary = "coreutils" | "diffutils" | "find" | "grep" | "xargs";

/**
 * A GNU text command the bundled uutils answer.
 *
 * `native` runs the uutils program every time: the shell's own either does
 * not exist or answers differently from GNU on ordinary input (`sort -n` reads
 * `1e3` as a thousand, `uniq -c` pads to four columns, `find` walks on the
 * thread the shell runs on).
 *
 * `fallback` runs the shell's own first, which costs nothing to start, and
 * the uutils program only when the call needs what the builtin lacks:
 * when `wantsNative` says so before running, or when the builtin refuses an
 * option (`grep -H`, `head -q`, `xargs -I{}`). These are the commands models
 * run inside loops, where a native start per iteration adds up.
 */
interface NativeTextRoute {
  binary: UutilsBinary;
  mode: "fallback" | "native";
  name: string;
  /** Where the uutils program answers it; elsewhere the builtin keeps it. */
  platforms?: NodeJS.Platform[];
  /** A fallback command's calls the builtin answers wrongly without saying so. */
  wantsNative?: (args: string[]) => boolean;
  /** A native command's calls uutils cannot answer and the builtin can. */
  wantsBuiltin?: (args: string[]) => boolean;
  /** Operands it writes rather than reads (`sort -o out`, `dd of=out`). */
  writes?: (args: string[]) => string[];
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

/** A relative date, a `-r FILE` reference, or a GNU `%-d` padding flag. */
function dateWantsNative(args: string[]): boolean {
  return args.some(
    (arg) =>
      /%[-_0^#]/.test(arg) ||
      /^(?:-r|--reference|-I|--iso-8601|-R|--rfc)/.test(arg) ||
      /\b(?:ago|next|last|yesterday|tomorrow|now|days?|weeks?|months?|years?|hours?|minutes?)\b/i.test(
        arg,
      ),
  );
}

/** A recursive search, which the builtin walks on the shell's thread. */
function grepWantsNative(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--recursive" ||
      arg === "--dereference-recursive" ||
      /^-[a-zA-Z]*[rR]/.test(arg),
  );
}

const NATIVE_TEXT_ROUTES: readonly NativeTextRoute[] = [
  { binary: "coreutils", mode: "native", name: "sort", writes: sortOutput },
  { binary: "coreutils", mode: "native", name: "uniq" },
  { binary: "coreutils", mode: "native", name: "comm" },
  { binary: "coreutils", mode: "native", name: "join" },
  { binary: "coreutils", mode: "native", name: "realpath" },
  { binary: "coreutils", mode: "native", name: "shuf" },
  { binary: "coreutils", mode: "native", name: "numfmt" },
  { binary: "coreutils", mode: "native", name: "od" },
  {
    binary: "coreutils",
    mode: "native",
    name: "dd",
    writes: (args) =>
      args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3)),
  },
  { binary: "diffutils", mode: "native", name: "cmp" },
  // On Windows uutils' find joins what it prints with backslashes, so a
  // `-path '*/.*'` or `-prune` pattern written with slashes matches nothing.
  // Its -newermt reads no date at all in 0.10.0, which the builtin does.
  {
    binary: "find",
    mode: "native",
    name: "find",
    platforms: UNIX,
    wantsBuiltin: (args) => args.some((arg) => /^-newer[a-zB]t$/.test(arg)),
  },
  {
    binary: "grep",
    mode: "fallback",
    name: "grep",
    wantsNative: grepWantsNative,
  },
  {
    binary: "coreutils",
    mode: "fallback",
    name: "date",
    wantsNative: dateWantsNative,
  },
  { binary: "coreutils", mode: "fallback", name: "cut" },
  { binary: "coreutils", mode: "fallback", name: "wc" },
  { binary: "coreutils", mode: "fallback", name: "head" },
  { binary: "coreutils", mode: "fallback", name: "tail" },
  { binary: "coreutils", mode: "fallback", name: "seq" },
  { binary: "coreutils", mode: "fallback", name: "sha256sum" },
  { binary: "coreutils", mode: "fallback", name: "md5sum" },
  // uutils builds `stat` for Unix only.
  { binary: "coreutils", mode: "fallback", name: "stat", platforms: UNIX },
  { binary: "xargs", mode: "fallback", name: "xargs" },
];

/** What the shell's builtins print when they refuse an option. */
const REJECTED_OPTION =
  /^[\w.-]+: (?:invalid option|unrecognized option|unknown option|illegal option|invalid argument|unknown predicate|unknown primary|option requires an argument|missing argument)/m;

/**
 * Whether the builtin turned the call down for an option it does not know,
 * as opposed to failing at the work: it printed nothing and said so.
 */
export function rejectedOption(result: ExecResult): boolean {
  return (
    result.exitCode !== 0 &&
    result.stdout === "" &&
    REJECTED_OPTION.test(result.stderr)
  );
}

/** How uutils' find reports a folder the native sandbox refused. */
const FIND_REFUSED =
  /^Error: .*: (?:Operation not permitted|Permission denied) \(os error \d+\)$/;

/**
 * find's stderr with each folder the sandbox refused on the way left out
 * and counted in one line instead: over the home folder that is one line per
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
    if (ctx.origCommand !== undefined && route.wantsBuiltin?.(args)) {
      return await ctx.origCommand(args);
    }
    if (
      route.mode === "fallback" &&
      ctx.origCommand !== undefined &&
      !route.wantsNative?.(args)
    ) {
      const builtin = await ctx.origCommand(args);
      if (!rejectedOption(builtin)) {
        return builtin;
      }
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
        ...(route.name === "find" ? { walks: true as const } : {}),
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
      stdout: streams.stdout,
    };
  });
}
