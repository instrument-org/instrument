import fs from "node:fs";
import path from "node:path";

// At runtime the compiled main bundle lives at out/main/*.js, so two levels
// up from import.meta.dirname lands at apps/studio/ — where we want .logs/.
const LOG_DIR = path.join(import.meta.dirname, "..", "..", ".logs");

const CURRENT_SYMLINK = path.join(LOG_DIR, "current.jsonl");

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

/** Opens the log file and updates the current.log symlink. Call once at boot. */
export function openDevLog() {
  if (logStream) {
    return;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });

  logFilePath = getLogFilePath();
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  // Symlinks are unreliable on Windows without Developer Mode or admin rights.
  if (process.platform !== "win32") {
    try {
      fs.unlinkSync(CURRENT_SYMLINK);
    } catch {
      // Ignore — didn't exist yet
    }
    fs.symlinkSync(logFilePath, CURRENT_SYMLINK);
  }
}

export function writeDevLogEntry(level: string, args: unknown[]) {
  if (!logStream) {
    return;
  }

  const cleaned = stripConsoleStyleArgs(args);
  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
  };

  if (cleaned.length === 1) {
    const [first] = cleaned;
    entry.msg = typeof first === "string" ? first : serializeArg(first);
  } else {
    entry.msg = cleaned.map(serializeArg);
  }

  logStream.write(JSON.stringify(entry) + "\n");
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

/**
 * Strips trailing CSS style arguments injected by console %c formatting.
 * e.g. ["%c[XState] foo", "color: #9e9e9e"] → ["%c[XState] foo"]
 * The %c prefix is preserved so the message text is still readable.
 */
function stripConsoleStyleArgs(args: unknown[]): unknown[] {
  if (
    args.length < 2 ||
    typeof args[0] !== "string" ||
    !args[0].includes("%c")
  ) {
    return args;
  }
  return args.filter((arg) => {
    if (typeof arg !== "string") {
      return true;
    }
    return !arg.startsWith("color:") && !arg.startsWith("background:");
  });
}
