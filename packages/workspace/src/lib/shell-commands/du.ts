import { defineCommand } from "just-bash";
import { Worker } from "node:worker_threads";

import { TASK_FOLDER_NAMES } from "../../constants";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type TaskId } from "../../schemas/task-id";
import { relativeWithin } from "../path-containment";
import { taskDir } from "../task-dir-utils";
import {
  buildWorkspaceFsLayout,
  nonTaskMounts,
  resolveHostPath,
  resolveReadOnlyHostPath,
  type WorkspaceFsLayout,
  type WorkspaceFsMount,
} from "../workspace-fs-layout";

export const DU_COMMAND = {
  description:
    "Estimate disk usage of files and directories (-s, -h, -a, -c, -d N, -k, -m, -b, --apparent-size). Runs off the app's main thread, so it is safe over a large folder.",
  name: "du",
} as const;

/** One operand: a path inside a mount, or a virtual directory holding mounts. */
type DuOperand =
  | (DuRoot & { kind: "path" })
  | { children: DuRoot[]; display: string; kind: "mounts" }
  | { display: string; kind: "missing"; };

interface DuOptions {
  all: boolean;
  apparent: boolean;
  grandTotal: boolean;
  human: boolean;
  maxDepth: number;
  unit: number;
}

/**
 * What a walk needs to know about one root: how to print it, where it is on
 * disk, and which of its entries is the mount's private dir.
 */
interface DuRoot {
  display: string;
  hostPath: string;
  /** Set on a mount root whose private dir the walk must not enter or count. */
  privateDirName: null | string;
}

/**
 * `du`, walked in a worker thread against the real directories behind the
 * sandbox's mounts.
 *
 * just-bash's own `du` walks the virtual filesystem on the Electron main thread,
 * where every entry is a blocking `realpathSync` and `lstatSync` in front of
 * the read: over an attached home folder it spends the whole traversal budget
 * in about half a minute and prints nothing. A folder's size is a question the
 * agent is asked in plain words and has no other command for, so a slow `du`
 * is a question it cannot answer.
 *
 * Here the walk runs in a worker with synchronous filesystem calls, so the main
 * thread only receives the finished text, and no traversal budget applies: a
 * long walk costs time rather than the window, and outlives `yieldMs` the way
 * any long command does. Output follows GNU `du`: disk usage in 1024-byte units
 * unless `--apparent-size` or `-b` asks for bytes, children before parents,
 * `-h` rounding up. Windows reports no block counts, so there each file's size
 * is rounded up to a 4 KiB cluster.
 *
 * Paths are printed as the agent typed them, never as host paths. The walk
 * does not follow symlinks, counts a hard-linked file once, and skips the
 * private dir at the root of a mount that masks one, as the sandbox's own view
 * does. Anything it does not implement -- another flag, an operand outside
 * every mount -- goes to just-bash's `du` unchanged.
 */
export function createDuCommand({
  attachedFolders,
  extraMounts,
  projectFolderName,
  taskId,
}: {
  attachedFolders?: Record<string, FolderAttachment.Type>;
  extraMounts?: WorkspaceFsMount[];
  projectFolderName?: string;
  taskId: TaskId;
}) {
  return defineCommand(DU_COMMAND.name, async (args, ctx) => {
    const fallback = async () => {
      if (ctx.origCommand === undefined) {
        return {
          exitCode: 1,
          stderr: `${DU_COMMAND.name}: unsupported arguments\n`,
          stdout: "",
        };
      }
      return await ctx.origCommand(args);
    };

    const parsed = parseDuArgs(args);
    if (parsed === null) {
      return await fallback();
    }

    const layout = buildWorkspaceFsLayout({
      attachedFolders,
      extraMounts,
      projectFolderName,
      taskHostRoot: taskDir(taskId),
    });

    const operands: DuOperand[] = [];
    for (const operand of parsed.operands.length > 0
      ? parsed.operands
      : ["."]) {
      const resolved = resolveOperand(
        layout,
        operand,
        ctx.fs.resolvePath(ctx.cwd, operand),
      );
      if (resolved === null) {
        return await fallback();
      }
      operands.push(resolved);
    }

    return await runInWorker(
      {
        maxOutput: ctx.limits.maxOutputSize,
        operands,
        options: parsed.options,
      },
      ctx.signal,
    );
  });
}

/**
 * The GNU spellings agents write, or null for anything else, which leaves the
 * command to just-bash's `du`.
 */
export function parseDuArgs(
  args: readonly string[],
): null | { operands: string[]; options: DuOptions } {
  const options: DuOptions = {
    all: false,
    apparent: false,
    grandTotal: false,
    human: false,
    maxDepth: Number.POSITIVE_INFINITY,
    unit: 1024,
  };
  let summarize = false;
  const operands: string[] = [];

  const setDepth = (value: string | undefined) => {
    if (value === undefined || !/^\d+$/.test(value)) {
      return false;
    }
    options.maxDepth = Number(value);
    return true;
  };

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
    if (arg.startsWith("--")) {
      const [name, inline] = arg.split("=", 2);
      switch (name) {
        case "--all": {
          options.all = true;
          break;
        }
        case "--apparent-size": {
          options.apparent = true;
          break;
        }
        case "--bytes": {
          options.apparent = true;
          options.unit = 1;
          break;
        }
        case "--human-readable": {
          options.human = true;
          break;
        }
        case "--max-depth": {
          const value = inline ?? args[++index];
          if (!setDepth(value)) {
            return null;
          }
          break;
        }
        case "--one-file-system": {
          break;
        }
        case "--summarize": {
          summarize = true;
          break;
        }
        case "--total": {
          options.grandTotal = true;
          break;
        }
        default: {
          return null;
        }
      }
      continue;
    }

    const cluster = arg.slice(1);
    for (let position = 0; position < cluster.length; position++) {
      const flag = cluster[position];
      switch (flag) {
        case "a": {
          options.all = true;
          break;
        }
        case "b": {
          options.apparent = true;
          options.unit = 1;
          break;
        }
        case "c": {
          options.grandTotal = true;
          break;
        }
        case "d": {
          // The value is the rest of the cluster (`-d1`) or the next argument.
          const rest = cluster.slice(position + 1);
          if (!setDepth(rest === "" ? args[++index] : rest)) {
            return null;
          }
          position = cluster.length;
          break;
        }
        case "h": {
          options.human = true;
          break;
        }
        case "k": {
          options.unit = 1024;
          break;
        }
        case "m": {
          options.unit = 1024 * 1024;
          break;
        }
        case "s": {
          summarize = true;
          break;
        }
        case "x": {
          break;
        }
        default: {
          return null;
        }
      }
    }
  }

  if (summarize) {
    options.maxDepth = 0;
  }
  return { operands, options };
}

/**
 * Map one operand onto the disk, or null when it is something only the
 * virtual filesystem can answer.
 */
function resolveOperand(
  layout: WorkspaceFsLayout,
  display: string,
  virtualPath: string,
): DuOperand | null {
  const owner = resolveHostPath(layout, virtualPath);
  if (owner !== null) {
    const hostPath = resolveReadOnlyHostPath(layout, virtualPath);
    // The private dir, and a symlink out of its mount, read as absent here as
    // they do everywhere else in the shell. The spelling check covers a
    // case-insensitive disk, where `.INSTRUMENT` is the same directory.
    const relative = relativeWithin(owner.mount.mountPoint, virtualPath);
    const namesPrivateDir =
      owner.mount.masksPrivateDir &&
      relative?.split("/")[1]?.toLowerCase() ===
        TASK_FOLDER_NAMES.private.toLowerCase();
    if (hostPath === null || namesPrivateDir) {
      return { display, kind: "missing" };
    }
    return {
      display,
      hostPath,
      kind: "path",
      privateDirName:
        owner.mount.masksPrivateDir && relative === "/"
          ? TASK_FOLDER_NAMES.private
          : null,
    };
  }

  // A virtual directory such as `/mnt` holds mounts but no files of its own.
  // Its mounts are listed as its children when they sit directly inside it;
  // anything deeper is left to just-bash, which knows the whole tree.
  const inside = [layout.task, ...nonTaskMounts(layout)].filter(
    (mount) => relativeWithin(virtualPath, mount.mountPoint) !== null,
  );
  const direct = inside.filter((mount) => {
    const relative = relativeWithin(virtualPath, mount.mountPoint);
    return relative !== null && /^\/[^/]+$/.test(relative);
  });
  if (direct.length === 0 || direct.length !== inside.length) {
    return null;
  }
  const base = display.replace(/\/+$/, "");
  return {
    children: direct
      .map((mount) => {
        const name = mount.mountPoint.slice(
          mount.mountPoint.lastIndexOf("/") + 1,
        );
        return {
          display: `${base}/${name}`,
          hostPath: mount.hostRoot,
          privateDirName: mount.masksPrivateDir
            ? TASK_FOLDER_NAMES.private
            : null,
        };
      })
      .toSorted((a, b) => (a.display < b.display ? -1 : 1)),
    display,
    kind: "mounts",
  };
}

/**
 * The walk itself, as source for an `eval` worker so it needs no file of its
 * own in the packaged app. Synchronous calls are the point: they block only
 * this thread.
 */
const DU_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");

const { maxOutput, operands, options, windows } = workerData;
const lines = [];
const errors = [];
const seenLinks = new Set();
let outputBytes = 0;
let exitCode = 0;

class OutputLimit extends Error {}

function reason(error) {
  switch (error && error.code) {
    case "EACCES":
    case "EPERM":
      return "Permission denied";
    case "ENOENT":
      return "No such file or directory";
    case "ENOTDIR":
      return "Not a directory";
    case "ELOOP":
      return "Too many levels of symbolic links";
    default:
      return (error && error.code) || "unreadable";
  }
}

function usage(stat) {
  if (!stat.isDirectory() && stat.nlink > 1) {
    const key = stat.dev + ":" + stat.ino;
    if (seenLinks.has(key)) return 0;
    seenLinks.add(key);
  }
  if (options.apparent) return stat.size;
  if (windows || typeof stat.blocks !== "number") {
    // No block counts to read: round to an NTFS cluster, except a link, whose
    // target is stored in the file table rather than in a cluster.
    if (stat.isSymbolicLink()) return 0;
    return Math.ceil(stat.size / 4096) * 4096;
  }
  return stat.blocks * 512;
}

function human(bytes) {
  if (bytes < 1024) return String(bytes);
  const units = ["K", "M", "G", "T", "P", "E"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  if (value < 10) {
    const rounded = Math.ceil(value * 10) / 10;
    if (rounded < 10) return rounded.toFixed(1) + units[unit];
    value = rounded;
  }
  const whole = Math.ceil(value);
  if (whole >= 1024 && unit < units.length - 1) return "1.0" + units[unit + 1];
  return whole + units[unit];
}

function format(bytes) {
  return options.human ? human(bytes) : String(Math.ceil(bytes / options.unit));
}

function emit(bytes, display) {
  const line = format(bytes) + "\t" + display + "\n";
  outputBytes += Buffer.byteLength(line);
  if (outputBytes > maxOutput) throw new OutputLimit();
  lines.push(line);
}

function child(display, name) {
  return display === "/" ? "/" + name : display.replace(/\/+$/, "") + "/" + name;
}

function walk(hostPath, display, privateDirName, depth) {
  let stat;
  try {
    stat = fs.lstatSync(hostPath);
  } catch (error) {
    errors.push("du: cannot access '" + display + "': " + reason(error) + "\n");
    exitCode = 1;
    return 0;
  }
  let total = usage(stat);
  if (stat.isDirectory()) {
    let names = [];
    try {
      names = fs.readdirSync(hostPath);
    } catch (error) {
      errors.push("du: cannot read directory '" + display + "': " + reason(error) + "\n");
      exitCode = 1;
    }
    names.sort();
    for (const name of names) {
      if (privateDirName !== null && name.toLowerCase() === privateDirName.toLowerCase()) {
        continue;
      }
      total += walk(path.join(hostPath, name), child(display, name), null, depth + 1);
    }
    if (depth <= options.maxDepth) emit(total, display);
  } else if (depth === 0 || (options.all && depth <= options.maxDepth)) {
    emit(total, display);
  }
  return total;
}

let grand = 0;
try {
  for (const operand of operands) {
    if (operand.kind === "missing") {
      errors.push("du: cannot access '" + operand.display + "': No such file or directory\n");
      exitCode = 1;
    } else if (operand.kind === "path") {
      grand += walk(operand.hostPath, operand.display, operand.privateDirName, 0);
    } else {
      let total = 0;
      for (const root of operand.children) {
        total += walk(root.hostPath, root.display, root.privateDirName, 1);
      }
      if (options.maxDepth >= 0) emit(total, operand.display);
      grand += total;
    }
  }
  if (options.grandTotal) emit(grand, "total");
  parentPort.postMessage({ exitCode, stderr: errors.join(""), stdout: lines.join("") });
} catch (error) {
  if (!(error instanceof OutputLimit)) throw error;
  parentPort.postMessage({
    exitCode: 126,
    stderr: "du: output size limit exceeded (" + maxOutput + " bytes)\n",
    stdout: "",
  });
}
`;

async function runInWorker(
  input: { maxOutput: number; operands: DuOperand[]; options: DuOptions },
  signal: AbortSignal | undefined,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const worker = new Worker(DU_WORKER_SOURCE, {
    eval: true,
    workerData: {
      ...input,
      windows: process.platform === "win32",
    },
  });

  return await new Promise((resolve) => {
    function finish(result: {
      exitCode: number;
      stderr: string;
      stdout: string;
    }) {
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    }
    function onAbort() {
      void worker.terminate();
      finish({ exitCode: 130, stderr: "", stdout: "" });
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once(
      "message",
      (result: { exitCode: number; stderr: string; stdout: string }) => {
        finish(result);
      },
    );
    worker.once("error", () => {
      finish({
        exitCode: 1,
        stderr: `${DU_COMMAND.name}: the walk stopped unexpectedly\n`,
        stdout: "",
      });
    });
  });
}
