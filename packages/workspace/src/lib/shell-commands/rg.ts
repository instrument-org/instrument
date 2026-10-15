import { defineCommand } from "just-bash";
import { readdirSync, realpathSync } from "node:fs";
import nodePath from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import {
  filterShellOutput,
  shellSpelledSlashedPaths,
} from "../filter-shell-output";
import { hostPathWithin, realHostPath } from "../host-path";
import { nativeCommandsSandboxed } from "../native-sandbox";
import { isAtOrUnder } from "../path-containment";
import { RG_DISK_PATH } from "../ripgrep";
import {
  appDataBounds,
  operandRefusal,
  otherFolders,
  outsideFolderRefusal,
  resolveReadOnlyHostPath,
  shellPathOfHostSpelling,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { mapStreams, shimOutput } from "./exec-shim";
import { runNative } from "./pipe-stage";
import { resolveCommandContext, subprocessStdin } from "./utils";

export const RG_COMMAND = {
  description:
    "Search file contents and list files with ripgrep. Pipe and redirect its output like any other command (e.g. `rg -l TODO | head`).",
  name: "rg",
} as const;

/**
 * The most stdout `rg` may write before it is stopped, in characters.
 *
 * Every byte of it is collected, rewritten, and filtered on the main thread,
 * then handed whole to the next pipeline stage, since just-bash pipelines do not
 * stream (vercel-labs/just-bash#415). `rg --files` over a few large attached
 * folders prints about 50 MB of paths, and piping that into `rg -i` or `head`
 * froze the window for eight seconds and grew the heap by 2 GB; the same search
 * filtered inside ripgrep with `--iglob` took 26 ms. A later stage cannot stop
 * the producer, so the cap is on the producer.
 */
const RG_MAX_STDOUT = 8 * 1024 * 1024;

const RG_MAX_STDOUT_ERROR = `${RG_COMMAND.name}: stopped after ${RG_MAX_STDOUT / 1024 / 1024} MB of output, which the app collects in full when it ends the command or goes to a shell builtin (awk, sed, jq, a loop). Piped into a native command (head, sort, grep, wc) it streams with no limit. Otherwise narrow it inside rg: \`--iglob '*name*'\` (case-insensitive) or \`-g '*.ext'\` to filter paths, a narrower folder, or \`-l\` / \`-m N\` to shorten a content search.\n`;

/**
 * Flags that make ripgrep run another program: `--pre`/`--pre-glob` hand every
 * candidate file to a command of the agent's choosing, `--hostname-bin` runs
 * one outright, and `-z`/`--search-zip` decompresses through external tools.
 * They are what would turn a read-only binary into an execution vector, which
 * is the assumption `resolveReadOnlyHostPath` is documented to rely on, so they
 * are refused rather than sanitized.
 *
 * The denylist only sees argv, but ripgrep also reads these same flags from the
 * file named by `RIPGREP_CONFIG_PATH`, which the agent can set in its own bash
 * env. `--no-config` on the exec argv (below) is what keeps that path from
 * reintroducing a `--pre` the denylist never inspected.
 */
const DENIED_LONG_FLAGS = new Set([
  "--hostname-bin",
  "--pre",
  "--pre-glob",
  "--search-zip",
]);

/** Short flag with the same effect as `--search-zip`, including when bundled. */
const DENIED_SHORT_FLAG = "z";

/**
 * Short flags whose value can be attached to the cluster that introduces them.
 *
 * Where a scan for a bundled `-z` has to stop: everything after one of these
 * letters is that flag's value rather than more flags, so `-ez` is `-e z`, a
 * search for the pattern `z`, and reading it as `-e -z` refuses a legitimate
 * search. Taken from `rg --help` for the build we bundle. A value-taking flag
 * missing from this set costs a refusal that should have been allowed; only a
 * letter wrongly *in* it would let `-z` through, so it grows by checking the
 * help rather than by guessing.
 */
const VALUE_SHORT_FLAGS = new Set("ABCEMTdefgjmrt");

/**
 * Where a flag's value starts inside the argument that carries it, as the
 * index of the character before it, or -1 for a flag that carries none: after
 * the `=` of a long flag, and after the letter of a short one whose value can
 * be attached to its cluster. `-rn` is `-r n` by the same reading, which is
 * why only the letters `rg --help` lists as value-taking are read this way.
 */
function attachedValueAt(arg: string): number {
  if (arg.startsWith("--")) {
    return arg.indexOf("=");
  }
  for (let at = 1; at < arg.length; at++) {
    const letter = arg[at] ?? "";
    if (!VALUE_SHORT_FLAGS.has(letter)) {
      continue;
    }
    // The value is what follows, and nothing follows a letter at the end:
    // there the value is the next argument, which arrives as an operand.
    return at + 1 < arg.length ? at : -1;
  }
  return -1;
}

/** Glob metacharacters, each matched literally inside a one-member class. */
const GLOB_METACHARACTERS = /[*?[{}\\]/g;

/** Whether names differing only in case are one file here. */
const FOLDS_CASE =
  process.platform === "darwin" || process.platform === "win32";

export function createRgCommand({
  layout,
  chatId,
}: {
  /** The shell's own layout, so rg reaches exactly the folders the shell has. */
  layout: WorkspaceFsLayout;
  chatId: ChatId;
}) {
  const command = defineCommand(RG_COMMAND.name, async (args, ctx) => {
    const denied = args.map((arg) => deniedFlag(arg)).find(Boolean);
    if (denied) {
      return {
        exitCode: 2,
        stderr: `${RG_COMMAND.name}: ${denied} is not available in this environment because it runs another program.\n`,
        stdout: "",
      };
    }

    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const bridged = bridgePathArgs(args, layout, {
      hostCwd,
      resolvePath: (arg) => ctx.fs.resolvePath(ctx.cwd, arg),
    });
    if ("error" in bridged) {
      return { exitCode: 2, stderr: `${bridged.error}\n`, stdout: "" };
    }

    const searched = withAppDataLeftOut(bridged.args, layout, hostCwd, {
      sandboxed: nativeCommandsSandboxed(),
    });
    if ("error" in searched) {
      return { exitCode: 2, stderr: `${searched.error}\n`, stdout: "" };
    }
    const stdin = subprocessStdin(ctx.stdin);

    return runNative(
      ctx,
      RG_DISK_PATH,
      ["--no-config", "--path-separator=/", ...searched.args],
      {
        cancelSignal: ctx.signal,
        cwd: hostCwd,
        env,
        maxBuffer: { stdout: RG_MAX_STDOUT },
        // What it named was checked above; a folder its walk is refused is
        // skipped without asking, the way the shell's own walks skip one.
        walks: true,
        // ripgrep picks between reading stdin and walking the working directory
        // by stat'ing fd 0, so the piped bytes have to reach it as a real pipe.
        // Handing it an ignored stdin instead makes `cmd | rg PATTERN` search
        // the chat's folder and report those matches as if they came from the
        // pipe. With no pipe, an ignored stdin is what selects the walk.
        //
        // The pipe has to be there even when it carried nothing: `false | rg
        // PATTERN` reads an empty pipe and matches nothing, the same as on a
        // host. The bytes alone cannot say whether a pipe existed, which is
        // what `stdinConnected` (a local patch on just-bash) is for.
        ...((stdin ?? ctx.stdinConnected)
          ? { input: stdin ?? Buffer.alloc(0) }
          : { stdin: "ignore" as const }),
      },
      (result) => {
        if (result.isMaxBuffer) {
          // The prefix it wrote is dropped rather than returned: piped onward
          // it reads as a complete listing, and a filter over it silently
          // misses everything past the cut.
          return { exitCode: 2, stderr: RG_MAX_STDOUT_ERROR, stdout: "" };
        }
        const streams = mapStreams(
          shimOutput(result, RG_COMMAND.name),
          (text) =>
            filterShellOutput(
              // `--path-separator=/` makes ripgrep print its paths with `/`,
              // so only the drive on them is left to respell. The separator
              // rewrite would take the backslashes inside a matched line and
              // a `--json` escape with it.
              shellSpelledSlashedPaths(text),
              { rewriteSeparators: false },
            ),
        );
        return { exitCode: result.exitCode ?? 1, ...streams };
      },
    );
  });
  return { ...command, acceptsPipeHandoff: true };
}

/**
 * Resolve the shell's spelling of a path to the host path ripgrep has to
 * receive (the same path on macOS and Linux, drive-lettered on Windows).
 *
 * Only arguments that name a folder the chat reaches are resolved. Anything
 * else starting with `/` is left alone: it is far more likely to be a regex
 * (`rg '/api/'`) than a path, and a real absolute path is no wider a
 * capability than the `python` and `node` hatches already documented in the
 * agent sandbox. A path the rules keep from the agent, or one that leads out
 * of its folder through a symlink, is refused. Everything after `--` is an
 * operand, a leading dash included.
 *
 * An argument spelled the way this computer spells a path
 * ({@link shellPathOfHostSpelling}) is resolved to the file it names and held
 * to the rules that spelling's own file meets, since ripgrep opens it either
 * way. A flag's attached value is read as a path too, for the flags that name
 * a file of patterns to search for or to ignore.
 */
function bridgePathArgs(
  args: string[],
  layout: WorkspaceFsLayout,
  {
    hostCwd,
    resolvePath,
  }: { hostCwd: string; resolvePath: (arg: string) => string },
): { args: string[] } | { error: string } {
  const roots = [layout.chat, ...otherFolders(layout)].map(
    (folder) => folder.shellRoot,
  );

  const bridged: string[] = [];
  let operandsOnly = false;
  for (const arg of args) {
    const isOperand = operandsOnly || !arg.startsWith("-");
    operandsOnly ||= arg === "--";
    // The part of the argument that names a path: an operand whole, the value
    // a long flag carries after its `=`, or the value attached to the short
    // flag that introduces it, since `-fC:\\pats.txt` is `-f C:\\pats.txt`.
    const equals = isOperand ? -1 : attachedValueAt(arg);
    const prefix = arg.slice(0, equals + 1);
    const hostSpelled = shellPathOfHostSpelling(arg.slice(equals + 1), {
      hostCwd,
    });
    const named = hostSpelled ?? (isOperand ? arg : undefined);
    if (named === undefined) {
      bridged.push(arg);
      continue;
    }
    const owner = roots.find((root) => isAtOrUnder(root, named));
    if (!owner) {
      // A path outside every folder the chat reaches is refused here the
      // way the shell's own commands refuse it, and asked for the same way,
      // rather than read by the real binary the rules hold to less.
      const resolved = resolvePath(named);
      const refusal = roots.some((root) => isAtOrUnder(root, resolved))
        ? operandRefusal(layout, resolved)
        : outsideFolderRefusal(layout, resolved, "read");
      if (refusal) {
        return {
          error: `${RG_COMMAND.name}: ${arg}: Permission denied\n${refusal}`,
        };
      }
      bridged.push(arg);
      continue;
    }
    const refusal = operandRefusal(layout, named);
    if (refusal) {
      return {
        error: `${RG_COMMAND.name}: ${arg}: Permission denied\n${refusal}`,
      };
    }
    const hostPath = resolveReadOnlyHostPath(layout, named);
    if (hostPath === null) {
      return {
        error: `${RG_COMMAND.name}: ${arg}: path is not accessible`,
      };
    }
    bridged.push(`${prefix}${hostPath}`);
  }
  return { args: bridged };
}

function deniedFlag(arg: string): null | string {
  if (arg.startsWith("--")) {
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    return DENIED_LONG_FLAGS.has(name) ? name : null;
  }
  if (!arg.startsWith("-")) {
    return null;
  }
  // A single dash introduces one or more bundled short flags (`-uz`), so the
  // whole cluster has to be inspected rather than compared -- up to the first
  // flag that takes a value, since the rest of the cluster is that value.
  for (const letter of arg.slice(1)) {
    if (letter === DENIED_SHORT_FLAG) {
      return `-${DENIED_SHORT_FLAG}`;
    }
    if (VALUE_SHORT_FLAGS.has(letter)) {
      return null;
    }
  }
  return null;
}

/**
 * The agent's arguments with globs after them that leave the app's own data
 * out of ripgrep's walk ({@link appDataBounds}): what is closed is left out,
 * and the way on to what the rules open there (the work folder, what the
 * chat was sent, the skills and apps) is kept. On macOS and Linux the native
 * sandbox refuses that data to the walk as well; Windows has none, so there
 * these are what keep a search of the output folder out of other chats'
 * records. They keep an ordinary search out, not a program set on getting
 * in: on Windows a `python` script reads the same files.
 *
 * ripgrep anchors a glob at its working directory and matches it against
 * each path as printed, so a folder holding the data needs the globs under
 * each spelling the search may print it with: the working directory's own
 * (none), and that of each argument naming such a folder (which argument is
 * the pattern would take parsing every flag this wrapper hands through, so
 * each is asked). One spelled with `.` or empty segments, which the printed
 * path does not match literally, is respelled normalized, or refused where
 * that would lead elsewhere.
 *
 * They are `--iglob`s, after every other argument: ripgrep adds each
 * `--iglob` after each `--glob`, and the last glob matching a path decides,
 * so no glob of the agent's brings back what they leave out. They go ahead
 * of a `--`, since everything past it is a path.
 *
 * Where the native sandbox holds ripgrep, a folder it closes can be passed
 * through but not listed, so a walk could never take the way on to what
 * opens inside it, and listing it would fail the whole search with exit 2.
 * There each closed folder a walk reaches is left out whole. What opens in
 * it is still searched by naming it (`rg x .instrument/skills`).
 */
export function withAppDataLeftOut(
  args: readonly string[],
  layout: WorkspaceFsLayout,
  hostCwd: string,
  { sandboxed = false }: { sandboxed?: boolean } = {},
): { args: string[] } | { error: string } {
  const { closed, open } = appDataBounds(layout);
  // A closed folder inside another is left out with it, unless something
  // between them opens.
  const outermost = closed.filter(
    (folder) =>
      !closed.some(
        (other) =>
          other !== folder &&
          hostPathWithin(other, folder) !== null &&
          !open.some(
            (opened) =>
              hostPathWithin(other, opened) !== null &&
              hostPathWithin(opened, folder) !== null,
          ),
      ),
  );
  const below = new Map(
    outermost.map((folder) => [
      folder,
      sandboxed ? [""] : leftOutBelow(folder, open),
    ]),
  );
  // What to leave out of a walk from `reached`, relative to it: the left-out
  // folders it holds, and where it starts inside one (a `cd` passes through
  // a closed folder on the way to one that opens), everything there but the
  // way on.
  const leftOutOfWalk = (reached: string): string[] =>
    [...below].flatMap(([folder, patterns]) => {
      const rest = remainderWithin(reached, folder);
      if (rest) {
        return patterns.map((pattern) =>
          joinPrinted(escapeGlob(rest), pattern),
        );
      }
      if (
        remainderWithin(folder, reached) === null ||
        open.some((opened) => hostPathWithin(opened, reached) !== null)
      ) {
        return [];
      }
      return leftOutBelow(reached, open).map((pattern) => pattern || "*");
    });
  const globs = new Set<string>();
  const leaveOutUnder = (spelling: string, patterns: readonly string[]) => {
    for (const pattern of patterns) {
      globs.add(`!/${joinPrinted(escapeGlob(spelling), pattern)}`);
    }
  };

  leaveOutUnder("", leftOutOfWalk(whereItIs(hostCwd) ?? hostCwd));
  const respelled: string[] = [];
  let operandsOnly = false;
  for (const arg of args) {
    const isOperand = operandsOnly || !arg.startsWith("-");
    operandsOnly ||= arg === "--";
    // An empty argument names no path: it is the pattern that matches
    // every line.
    const reached =
      isOperand && arg !== "" ? whereItIs(hostOperand(hostCwd, arg)) : null;
    const patterns = reached === null ? [] : leftOutOfWalk(reached);
    if (patterns.length === 0) {
      respelled.push(arg);
      continue;
    }
    const spelling = printedSpelling(arg);
    if (spelling !== null) {
      leaveOutUnder(spelling, patterns);
      respelled.push(arg);
      continue;
    }
    const normalized = nodePath.normalize(arg);
    const normalizedSpelling = printedSpelling(normalized);
    if (
      normalizedSpelling === null ||
      whereItIs(hostOperand(hostCwd, normalized)) !== reached
    ) {
      return {
        error: `${RG_COMMAND.name}: ${arg}: path is not accessible; spell it without \`.\` or empty segments`,
      };
    }
    leaveOutUnder(normalizedSpelling, patterns);
    respelled.push(normalized);
  }

  const globArgs = [...globs].flatMap((glob) => ["--iglob", glob]);
  const operandsFrom = respelled.indexOf("--");
  return {
    args:
      operandsFrom === -1
        ? [...respelled, ...globArgs]
        : [
            ...respelled.slice(0, operandsFrom),
            ...globArgs,
            ...respelled.slice(operandsFrom),
          ],
  };
}

/**
 * Globs, relative to `folder`, for everything in it but the way on to what
 * opens there: the folder itself (an empty glob) where nothing does. A
 * folder with one name to keep is not listed: its other names are matched
 * by pattern, two per letter of the kept name, however many it holds (one
 * chat's folder among every chat's). Any other is listed.
 */
function leftOutBelow(folder: string, open: readonly string[]): string[] {
  const below = open.flatMap((opened) => {
    const rest = hostPathWithin(folder, opened);
    return rest === null ? [] : [{ opened, rest }];
  });
  if (below.length === 0) {
    return [""];
  }
  if (below.some(({ rest }) => rest === "/")) {
    return [];
  }
  const kept = new Map<string, string[]>();
  for (const { opened, rest } of below) {
    const name = rest.split("/")[1] ?? "";
    kept.set(name, [...(kept.get(name) ?? []), opened]);
  }
  const [only, ...others] = kept.keys();
  const here =
    only !== undefined && others.length === 0 && /^[\w.-]+$/.test(only)
      ? everyNameBut(only)
      : listedBut(folder, [...kept.keys()]);
  return [
    ...here,
    ...[...kept].flatMap(([name, opened]) =>
      leftOutBelow(nodePath.join(folder, name), opened).map((pattern) =>
        joinPrinted(escapeGlob(name), pattern),
      ),
    ),
  ];
}

/**
 * Globs matching every name but `kept`: one that turns off it at some
 * letter, one that stops short of it, and one that runs on past it.
 */
function everyNameBut(kept: string): string[] {
  const globs: string[] = [];
  for (let at = 0; at < kept.length; at++) {
    const before = kept.slice(0, at);
    if (before !== "") {
      globs.push(before);
    }
    globs.push(`${before}[!${kept.charAt(at)}]*`);
  }
  globs.push(`${kept}?*`);
  return globs;
}

/** Globs for each entry of `folder` but the `kept` ones. */
function listedBut(folder: string, kept: readonly string[]): string[] {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    // Nothing a walk could list there either.
    return [];
  }
  const fold = (name: string) => (FOLDS_CASE ? name.toLowerCase() : name);
  const keep = new Set(kept.map(fold));
  return names.filter((name) => !keep.has(fold(name))).map(escapeGlob);
}

/** Where a path really is, as the rules compare it, or null where nothing is. */
function whereItIs(hostPath: string): null | string {
  try {
    realpathSync(hostPath);
  } catch {
    return null;
  }
  return realHostPath(hostPath);
}

function escapeGlob(literal: string): string {
  return literal.replaceAll(GLOB_METACHARACTERS, (character) =>
    character === "\\" && nodePath.sep === "\\" ? "/" : `[${character}]`,
  );
}

/**
 * Where ripgrep finds an operand: joined to its working directory as typed
 * rather than normalized, so `..` after a symlink resolves the way the
 * operating system resolves it.
 */
function hostOperand(hostCwd: string, arg: string): string {
  return nodePath.isAbsolute(arg) ? arg : `${hostCwd}${nodePath.sep}${arg}`;
}

/** Two parts of a printed path, joined the way ripgrep joins them. */
function joinPrinted(parent: string, child: string): string {
  if (parent === "" || child === "") {
    return parent || child;
  }
  return parent.endsWith("/") ? `${parent}${child}` : `${parent}/${child}`;
}

/**
 * What of an operand ripgrep's glob matcher sees in front of each path under
 * it, or null for a spelling it would not match literally. `.` contributes
 * nothing, since ripgrep drops the leading `./` it prints under it.
 */
function printedSpelling(arg: string): null | string {
  const posix = nodePath.sep === "\\" ? arg.replaceAll("\\", "/") : arg;
  if (posix === "." || posix === "./") {
    return "";
  }
  if (posix === "/") {
    return posix;
  }
  const unprefixed = posix.startsWith("./") ? posix.slice(2) : posix;
  const spelling =
    unprefixed.length > 1 && unprefixed.endsWith("/")
      ? unprefixed.slice(0, -1)
      : unprefixed;
  const segments = spelling.split("/");
  const plain = segments.every(
    (segment, index) =>
      segment !== "." &&
      (segment !== "" || (index === 0 && segments.length > 1)),
  );
  return plain ? spelling : null;
}

/**
 * The part of `hostPath` under `parent` as ripgrep prints it below the
 * parent's spelling: "" for the parent itself, or null for a path outside it.
 */
function remainderWithin(parent: string, hostPath: string): null | string {
  return hostPathWithin(parent, hostPath)?.slice(1) ?? null;
}
