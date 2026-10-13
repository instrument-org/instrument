import {
  type Command,
  defineCommand,
  type ExternalCommandResolver,
} from "just-bash";
import { constants } from "node:fs";
import { access, open, stat } from "node:fs/promises";
import nodePath from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import {
  commandLineToolsMissing,
  commandLineToolsRefusal,
  isCommandLineToolsStub,
  recheckCommandLineTools,
} from "../command-line-tools-env";
import { ffmpegSubprocessEnv } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { nodeToolsEnv } from "../tool-isolation";
import { uvSubprocessEnv } from "../uv";
import { getWorkspaceConfig } from "../workspace-config";
import { hostPathOf, shellPath } from "../workspace-fs-layout";
import {
  collapseProgress,
  execShim,
  mapStreams,
  shimOutput,
} from "./exec-shim";
import { hostPathArgs, resolveCommandContext, subprocessStdin } from "./utils";

type PathLookup = {
  /** The PATH to search, in the host's spelling. */
  path: string | undefined;
  /** Windows' PATHEXT; defaults to the one cmd.exe uses when unset. */
  pathExt?: string;
  platform?: NodeJS.Platform;
  /** Whether a host path is a program; defaults to asking the disk. */
  isProgram?: (hostPath: string, platform: NodeJS.Platform) => Promise<boolean>;
};

/** A variable of the app's environment, by its name without case, as Windows names them. */
function hostEnv(name: string) {
  return Object.entries(process.env).find(
    ([key]) => key.toUpperCase() === name,
  )?.[1];
}

/** PATHEXT's extensions, lowercased; cmd.exe's own when it is unset. */
function pathExtensions(pathExt = ".COM;.EXE;.BAT;.CMD") {
  return pathExt
    .split(";")
    .filter(Boolean)
    .map((ext) => ext.toLowerCase());
}

/**
 * Every program `name` names on a PATH, in PATH order, as host paths; the
 * first is the one a shell runs. On Windows a name with no extension PATHEXT
 * lists is tried with each one in turn, as cmd.exe does.
 */
export async function programsOnPath(
  name: string,
  {
    path,
    pathExt,
    platform = process.platform,
    isProgram = isProgramOnDisk,
  }: PathLookup,
): Promise<string[]> {
  if (
    !name ||
    name.includes("/") ||
    (platform === "win32" && name.includes("\\"))
  ) {
    return [];
  }
  const pathApi = platform === "win32" ? nodePath.win32 : nodePath.posix;
  const extensions = pathExtensions(pathExt);
  const names =
    platform === "win32" &&
    !extensions.includes(pathApi.extname(name).toLowerCase())
      ? extensions.map((ext) => `${name}${ext}`)
      : [name];
  const found: string[] = [];
  for (const dir of (path ?? "").split(pathApi.delimiter)) {
    // An empty entry means the working directory, which a lookup on the
    // agent's behalf never searches.
    if (!pathApi.isAbsolute(dir)) {
      continue;
    }
    for (const candidate of names) {
      const hostPath = pathApi.join(dir, candidate);
      if (!found.includes(hostPath) && (await isProgram(hostPath, platform))) {
        found.push(hostPath);
      }
    }
  }
  return found;
}

/** A regular file this user may execute; on Windows, any regular file. */
async function isProgramOnDisk(hostPath: string, platform: NodeJS.Platform) {
  try {
    if (!(await stat(hostPath)).isFile()) {
      return false;
    }
    if (platform !== "win32") {
      await access(hostPath, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a file named by path runs as a program of its own: a script that
 * names its interpreter (`#!`), or a Mach-O, ELF or PE binary. A file with
 * neither is a shell script with no interpreter line, which a shell runs
 * itself rather than handing to the system, and so does this one.
 */
async function runsNatively(hostPath: string): Promise<boolean> {
  if (!(await isProgramOnDisk(hostPath, process.platform))) {
    return false;
  }
  if (process.platform === "win32") {
    // Windows runs a file by its extension rather than its contents.
    return pathExtensions(hostEnv("PATHEXT")).includes(
      nodePath.win32.extname(hostPath).toLowerCase(),
    );
  }
  const file = await open(hostPath, "r");
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(4), 0, 4, 0);
    const magic = buffer.subarray(0, bytesRead);
    return (
      magic.subarray(0, 2).toString("latin1") === "#!" ||
      magic.toString("latin1") === "\u007fELF" ||
      ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(
        magic.toString("hex"),
      )
    );
  } finally {
    await file.close();
  }
}

/**
 * The PATH a program is looked up on: the app's own, with this chat's
 * virtualenv and the bundled uv ahead of it, the same PATH a native command
 * and the scripts it starts run with.
 */
function programPath(chatId: ChatId) {
  return uvSubprocessEnv({ chatId }).PATH;
}

/**
 * Finds a program on the computer's PATH for a name the shell has no command
 * for, and a program a path names (`./build`, `/usr/bin/sips`), and runs it
 * as a native command. just-bash asks only once its builtins and our own
 * commands have passed on the name, so those keep it.
 */
export function createPathProgramResolver(
  chatId: ChatId,
): ExternalCommandResolver {
  return async (name, { cwd }) => {
    if (name.includes("/")) {
      const hostPath = hostPathOf(nodePath.posix.resolve(cwd, name));
      return (await runsNatively(hostPath))
        ? {
            command: await programCommand(chatId, name, hostPath),
            path: shellPath(hostPath),
          }
        : undefined;
    }
    const [hostPath] = await programsOnPath(name, {
      path: programPath(chatId),
      pathExt: hostEnv("PATHEXT"),
    });
    return hostPath === undefined
      ? undefined
      : {
          command: await programCommand(chatId, name, hostPath),
          path: shellPath(hostPath),
        };
  };
}

/**
 * Whether the program at `hostPath` is a macOS developer tool stub on a Mac
 * without the tools, which would ask to install them rather than run.
 */
export async function isMissingDeveloperTool(hostPath: string) {
  return (
    process.platform === "darwin" &&
    commandLineToolsMissing() &&
    (await isCommandLineToolsStub(hostPath))
  );
}

/**
 * The command a found program runs as. A developer tool stub on a Mac without
 * the tools is refused with what the agent should do instead, since running it
 * could only fail; once the person has installed the tools it runs.
 */
async function programCommand(
  chatId: ChatId,
  name: string,
  hostPath: string,
): Promise<Command> {
  const program = createPathProgramCommand(chatId, name, hostPath);
  if (!(await isMissingDeveloperTool(hostPath))) {
    return program;
  }
  return defineCommand(name, async (args, ctx) =>
    (await recheckCommandLineTools())
      ? {
          exitCode: 127,
          stderr: commandLineToolsRefusal(name),
          stdout: "",
        }
      : program.execute(args, ctx),
  );
}

/** Every program a name names on the PATH programs are looked up on. */
export async function pathProgramsNamed(chatId: ChatId, name: string) {
  const found = await programsOnPath(name, {
    path: programPath(chatId),
    pathExt: hostEnv("PATHEXT"),
  });
  return found.map((hostPath) => shellPath(hostPath));
}

/**
 * The program at `hostPath` as a native command: in the shell's working
 * directory, with the environment and sandbox every native command gets.
 */
function createPathProgramCommand(
  chatId: ChatId,
  name: string,
  hostPath: string,
): Command {
  return defineCommand(name, async (args, ctx) => {
    const { env, taskCwd } = resolveCommandContext(chatId, ctx);
    const stdin = subprocessStdin(ctx.stdin);
    // cmd.exe runs a batch file; CreateProcess cannot.
    const [file, fileArgs] = /\.(?:bat|cmd)$/i.test(hostPath)
      ? [
          hostEnv("COMSPEC") ?? "cmd.exe",
          ["/d", "/s", "/c", hostPath, ...hostPathArgs(args)],
        ]
      : [hostPath, hostPathArgs(args)];
    const result = await execShim(file, fileArgs, {
      cancelSignal: ctx.signal,
      cwd: taskCwd,
      env: {
        ...getWorkspaceConfig().nodeExecEnv,
        ...env,
        // A program that builds or installs packages uses the app's own npm
        // config, store and node-gyp headers, never the person's.
        ...nodeToolsEnv(),
        // After ...env so the bundled ffmpeg dirs win over the shell's PATH.
        ...ffmpegSubprocessEnv(env.PATH),
      },
      ...(stdin ? { input: stdin } : { stdin: "ignore" }),
    });
    return {
      exitCode: result.exitCode ?? 1,
      ...mapStreams(shimOutput(result, name), (text) =>
        filterShellOutput(collapseProgress(text)),
      ),
    };
  });
}
