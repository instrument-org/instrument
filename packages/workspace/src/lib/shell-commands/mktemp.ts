import { defineCommand, type IFileSystem } from "just-bash";
import { randomBytes } from "node:crypto";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";

export const MKTEMP_COMMAND = {
  description:
    "Create a uniquely named scratch file (or -d directory) under work/ and print its path.",
  name: "mktemp",
} as const;

/**
 * Where a template-less `mktemp` puts things.
 *
 * The same directory the subprocess hatches get as TMPDIR, so a path from here
 * means the same thing to the shell and to python, ffmpeg, or a script. `/tmp`
 * is not writable and never will be: it is outside every mount, so a file
 * written there would have nowhere to live once the call ended.
 */
const TMP_DIR = `${MOUNT.task}/${TASK_FOLDER_NAMES.work}/${TASK_FOLDER_NAMES.tmp}`;

/** GNU's default template, used whenever no operand is given. */
const DEFAULT_TEMPLATE = "tmp.XXXXXXXXXX";

/** The run of X's a template ends with, which is what gets randomized. */
const TRAILING_X = /X{3,}$/;

const RANDOM_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

interface MktempArgs {
  directory: boolean;
  dryRun: boolean;
  quiet: boolean;
  template: string;
}

/**
 * `mktemp`, against the virtual filesystem.
 *
 * just-bash has no implementation, and its absence is why the agent reaches
 * for `/tmp` -- the idiom it knows for "somewhere safe to put a scratch file"
 * is the one place the sandbox refuses. Making the standard spelling work is
 * cheaper than teaching every prompt around it.
 *
 * Creates the entry before printing it, as the real command does, with the
 * private modes the real one guarantees. `-u` opts out and is documented as
 * unsafe upstream too.
 *
 * A directory is created exclusively, because `mkdir` without `recursive`
 * refuses a path that exists. A file is not: `writeFile` has no exclusive mode
 * and truncates, so the check and the write are separate steps and the mode
 * lands after creation. Nothing in `IFileSystem` closes that today; the names
 * are unguessable so the window cannot be aimed at.
 */
export function createMktempCommand() {
  return defineCommand(MKTEMP_COMMAND.name, async (args, ctx) => {
    const parsed = parseMktempArgs(args);
    if ("error" in parsed) {
      return {
        exitCode: 1,
        stderr: `${MKTEMP_COMMAND.name}: ${parsed.error}\n`,
        stdout: "",
      };
    }
    const { directory, dryRun, quiet, template } = parsed;

    const virtualPath = ctx.fs.resolvePath(ctx.cwd, template);
    const parent = virtualPath.slice(0, virtualPath.lastIndexOf("/")) || "/";
    const name = virtualPath.slice(virtualPath.lastIndexOf("/") + 1);
    // A malformed template is a usage error rather than a creation failure, so
    // `-q` does not silence it, matching GNU.
    if (!TRAILING_X.test(name)) {
      return {
        exitCode: 1,
        stderr: `${MKTEMP_COMMAND.name}: too few X's in template '${template}'\n`,
        stdout: "",
      };
    }

    // The default location is created on demand; a caller-supplied template
    // pointing somewhere absent is left to fail on its own.
    if (parent === TMP_DIR) {
      await ctx.fs.mkdir(parent, { recursive: true });
    }

    let lastError = "";
    for (let attempt = 0; attempt < 32; attempt++) {
      const candidate = `${parent}/${name.replace(TRAILING_X, (run) => randomSuffix(run.length))}`;
      if (dryRun) {
        return { exitCode: 0, stderr: "", stdout: `${candidate}\n` };
      }
      try {
        await createEntry(ctx.fs, candidate, directory);
      } catch (error) {
        // A collision is the expected failure and the loop handles it; any
        // other error repeats, so it falls out and is reported once.
        lastError = String(error);
        continue;
      }
      return { exitCode: 0, stderr: "", stdout: `${candidate}\n` };
    }

    return {
      exitCode: 1,
      stderr: quiet
        ? ""
        : `${MKTEMP_COMMAND.name}: failed to create ${directory ? "directory" : "file"} via template '${template}': ${lastError}\n`,
      stdout: "",
    };
  });
}

/** The private modes mktemp guarantees for what it hands back. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

async function createEntry(
  fs: IFileSystem,
  path: string,
  directory: boolean,
): Promise<void> {
  if (directory) {
    await fs.mkdir(path, { recursive: false });
    await fs.chmod(path, DIR_MODE);
    return;
  }
  if (await fs.exists(path)) {
    throw new Error("file exists");
  }
  await fs.writeFile(path, "");
  await fs.chmod(path, FILE_MODE);
}

/**
 * Hand-rolled rather than parseArgs because `-p DIR` and `-t` interact with the
 * operand: `-p` replaces the directory of a bare template, `-t` treats the
 * operand as a bare name to place in the temp dir, and a template containing a
 * slash is used as written.
 */
function parseMktempArgs(args: string[]): MktempArgs | { error: string } {
  let directory = false;
  let dryRun = false;
  let quiet = false;
  let useTmpDir = false;
  let parent: string | undefined;
  const operands: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      operands.push(arg);
      continue;
    }
    if (arg.startsWith("--tmpdir=")) {
      parent = arg.slice("--tmpdir=".length);
      useTmpDir = true;
      continue;
    }
    // Long forms, then the short cluster (`-dq`, `-dp DIR`).
    switch (arg) {
      case "--directory": {
        directory = true;
        continue;
      }
      case "--dry-run": {
        dryRun = true;
        continue;
      }
      case "--quiet": {
        quiet = true;
        continue;
      }
      case "--tmpdir": {
        useTmpDir = true;
        continue;
      }
      default: {
        break;
      }
    }
    if (arg.startsWith("--")) {
      return { error: `unrecognized option '${arg}'` };
    }
    // `-p` takes a value and so ends the cluster, inline (`-pDIR`, `-dpDIR`) or
    // as the next argument (`-p DIR`). Everything before it is a bare flag.
    const valueAt = arg.indexOf("p");
    if (valueAt > 0) {
      parent = arg.slice(valueAt + 1) || args[++index];
      useTmpDir = true;
      if (parent === undefined) {
        return { error: "option requires an argument -- 'p'" };
      }
    }
    for (const flag of arg.slice(1, valueAt > 0 ? valueAt : undefined)) {
      switch (flag) {
        case "d": {
          directory = true;
          break;
        }
        case "q": {
          quiet = true;
          break;
        }
        case "t": {
          useTmpDir = true;
          break;
        }
        case "u": {
          dryRun = true;
          break;
        }
        default: {
          return { error: `invalid option -- '${flag}'` };
        }
      }
    }
  }

  if (operands.length > 1) {
    return { error: `too many templates` };
  }
  const operand = operands[0];
  if (operand === undefined) {
    return {
      directory,
      dryRun,
      quiet,
      template: `${parent ?? TMP_DIR}/${DEFAULT_TEMPLATE}`,
    };
  }
  // A template with a slash names its own directory, so -p/-t do not apply.
  const template = operand.includes("/")
    ? operand
    : `${useTmpDir || parent !== undefined ? (parent ?? TMP_DIR) : "."}/${operand}`;
  return { directory, dryRun, quiet, template };
}

function randomSuffix(length: number): string {
  return Array.from(
    randomBytes(length),
    (byte) => RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length],
  ).join("");
}
