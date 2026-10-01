import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// At runtime the compiled main bundle lives at out/main/*.js, so two levels
// up from import.meta.dirname lands at apps/studio/ — where we want .logs/.
const LOG_DIR = path.join(import.meta.dirname, "..", "..", ".logs");

const CURRENT_SYMLINK = path.join(LOG_DIR, "current.jsonl");

// Earlier boots kept on disk beside the current one. Each boot is one file, and
// a dev session relaunches on every main-process save, so an unpruned directory
// grows by thousands.
const KEPT_LOG_FILES = 50;

function getLogFilePath() {
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z");
  return path.join(LOG_DIR, `${stamp}.jsonl`);
}

let logFilePath: string | undefined;
let logStream: fs.WriteStream | undefined;

export function getDevLogFilePath() {
  return logFilePath;
}

/** Opens the log file and updates the current.jsonl symlink. Call once at boot. */
export function openDevLog() {
  if (logStream) {
    return;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  pruneOldLogs();

  logFilePath = getLogFilePath();
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  // Symlinks are unreliable on Windows without Developer Mode or admin rights.
  if (process.platform !== "win32") {
    const temporarySymlink = path.join(LOG_DIR, `.${randomUUID()}.jsonl`);
    fs.symlinkSync(logFilePath, temporarySymlink);
    fs.renameSync(temporarySymlink, CURRENT_SYMLINK);
  }
}

/** Deletes all but the newest {@link KEPT_LOG_FILES} earlier boot files. */
function pruneOldLogs() {
  // Boot files are named by their start time, so name order is age order.
  const bootFiles = fs
    .readdirSync(LOG_DIR)
    .filter((name) => /^\d{4}-.*\.jsonl$/.test(name))
    .toSorted();
  for (const name of bootFiles.slice(0, -KEPT_LOG_FILES)) {
    fs.rmSync(path.join(LOG_DIR, name), { force: true });
  }
}

export function writeDevLogEntry(
  level: string,
  args: unknown[],
  { scope, source }: { scope?: string; source?: string } = {},
) {
  if (!logStream) {
    return;
  }

  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
  };

  if (source) {
    entry.source = source;
  }

  if (scope) {
    entry.scope = scope;
  }

  if (args.length === 1) {
    const [first] = args;
    entry.msg = typeof first === "string" ? first : serializeArg(first);
  } else {
    entry.msg = args.map(serializeArg);
  }

  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch (error) {
    // Guard against non-serializable payloads (bigint, circular refs) so a
    // single bad log arg can't throw out of the logging path.
    const detail = error instanceof Error ? error.message : "unknown error";
    line = JSON.stringify({
      level,
      msg: `[dev-log serialization failed: ${detail}]`,
      time: entry.time,
      ...(source ? { source } : {}),
      ...(scope ? { scope } : {}),
    });
  }
  logStream.write(line + "\n");
}

function serializeArg(arg: unknown): unknown {
  if (!(arg instanceof Error)) {
    return arg;
  }
  return {
    cause:
      arg.cause instanceof Error
        ? arg.cause.message
        : arg.cause === undefined
          ? undefined
          : JSON.stringify(arg.cause),
    message: arg.message,
    name: arg.name,
    stack: arg.stack,
  };
}
