import type { LogFile, LogMessage, NodeLogger } from "electron-log";

import { createRepeatLimiter } from "./repeat-limiter";

const REPEAT_INTERVAL_MS = 10_000;

/** How often one line, numbers aside, is written per interval. */
const REPEATS_PER_LINE = 20;

/** How many lines of any kind are written per interval. */
const LINES_PER_INTERVAL = 1000;

/** How long the log file rests after a write to it fails. */
const FILE_RETRY_MS = 60_000;

/**
 * Keep logging from feeding on itself.
 *
 * A failed write to the terminal arrives as an `error` event on stdout or
 * stderr, and with no listener Node promotes it to an uncaught exception,
 * which the crash diagnostics log, which writes to the terminal again. So
 * the streams get a listener, and the first failure there, thrown or emitted,
 * turns the console transport off for the rest of the session: a closed pipe
 * or terminal does not come back. A failed write to the log file (a full
 * disk) rests the file transport for a minute rather than failing once per
 * line.
 *
 * Every line also passes a repeat limit, numbers ignored so a timestamp or
 * an id does not make each repeat new, and a cap on lines of any kind, so a
 * loop nobody foresaw costs a bounded amount of disk and CPU. The first line
 * through after a quiet spell says how many were held back.
 */
export function guardLogger(
  logger: NodeLogger,
  {
    now = Date.now,
    streams = [process.stdout, process.stderr],
  }: {
    now?: () => number;
    streams?: readonly Pick<NodeJS.EventEmitter, "on">[];
  } = {},
) {
  const consoleTransport = logger.transports.console;
  let consoleStopped = false;
  const stopConsole = () => {
    consoleStopped = true;
    consoleTransport.level = false;
  };
  // electron-log also calls `writeFn` directly, below the level check, to
  // report its own failures (a file it cannot write, a transport that threw).
  const write = consoleTransport.writeFn.bind(consoleTransport);
  consoleTransport.writeFn = (options) => {
    if (consoleStopped) {
      return;
    }
    try {
      write(options);
    } catch {
      stopConsole();
    }
  };
  for (const stream of streams) {
    stream.on("error", stopConsole);
  }

  let fileRetryAt = 0;
  const watchedFiles = new WeakSet<LogFile>();
  const watchFile = (message: LogMessage) => {
    const file = logger.transports.file.getFile(message);
    if (watchedFiles.has(file)) {
      return;
    }
    watchedFiles.add(file);
    file.on("error", () => {
      fileRetryAt = now() + FILE_RETRY_MS;
    });
  };

  const sameLine = createRepeatLimiter({
    intervalMs: REPEAT_INTERVAL_MS,
    limit: REPEATS_PER_LINE,
  });
  const anyLine = createRepeatLimiter({
    intervalMs: REPEAT_INTERVAL_MS,
    limit: LINES_PER_INTERVAL,
  });
  // A hook runs once per transport with the same message, so the limit is
  // taken once per message and its answer reused.
  const decided = new WeakMap<LogMessage, LogMessage | false>();
  const decide = (message: LogMessage): LogMessage | false => {
    const at = now();
    const line = sameLine(lineKey(message), at);
    if (!line.allowed) {
      return false;
    }
    const all = anyLine("", at);
    if (!all.allowed) {
      return false;
    }
    const notes = [
      line.suppressed > 0 ? `(repeated ${line.suppressed} more times)` : "",
      all.suppressed > 0 ? `(${all.suppressed} other lines dropped)` : "",
    ].filter(Boolean);
    if (notes.length === 0) {
      return message;
    }
    const data: unknown[] = message.data;
    return { ...message, data: [...data, ...notes] };
  };

  logger.hooks.push((message, _transport, transportName) => {
    if (transportName === "file") {
      if (now() < fileRetryAt) {
        return false;
      }
      watchFile(message);
    }
    let decision = decided.get(message);
    if (decision === undefined) {
      decision = decide(message);
      decided.set(message, decision);
    }
    return decision;
  });

  return { stopConsole };
}

function lineKey(message: LogMessage): string {
  const first: unknown = message.data[0];
  const text =
    typeof first === "string"
      ? first
      : first instanceof Error
        ? `${first.name}: ${first.message}`
        : typeof first;
  return `${message.level}|${message.scope ?? ""}|${text.slice(0, 300).replaceAll(/\d+/g, "#")}`;
}
