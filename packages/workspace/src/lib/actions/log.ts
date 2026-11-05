import fs from "node:fs";
import path from "node:path";

import { getWorkspaceConfig } from "../workspace-config";
import {
  type ActionInput,
  type LoggedAction,
  LoggedActionSchema,
} from "./schema";

/**
 * The action log: what the person did in the app, one JSON line per action,
 * in a file per local day in the workspace's machine folder
 * (`<machine>/actions/<YYYY-MM-DD>.jsonl`). It never travels with the
 * workspace, since what one computer's person did means nothing on another,
 * and the agent's shell cannot reach it: the agent reads it only through
 * `instrument activity`.
 *
 * Written as it happens, a line at a time with the day's file held open, so
 * the newest action is on disk before a message sent right after it is read.
 * Bounded so a capture point stuck in a loop cannot fill the disk: a repeat
 * of the line before within a minute is not written, a kind writes at most
 * `PER_KIND_PER_MINUTE` lines a minute, a day at most `MAX_DAY_BYTES`, and
 * the folder at most `MAX_TOTAL_BYTES`, the oldest days going first. Nothing
 * expires by age: a day stays until the folder is full or the person clears
 * it. What a cap leaves out is said in a `capped` line.
 */

const ACTIONS_FOLDER = "actions";
const DAY_FILE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

const MAX_DAY_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const PER_KIND_PER_MINUTE = 60;
const REPEAT_WINDOW_MS = 60_000;

export function actionsDir(machineDir: string): string {
  return path.join(machineDir, ACTIONS_FOLDER);
}

/** The local day a time falls on, as its file is named. */
function dayOf(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The start of the local day a file is named for, or undefined for another file. */
function dayStartOf(name: string): number | undefined {
  const match = DAY_FILE.exec(name);
  if (!match) {
    return undefined;
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getTime();
}

/** The day files in `dir`, oldest first. */
function dayFiles(dir: string): { file: string; start: number }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .flatMap((name) => {
      const start = dayStartOf(name);
      return start === undefined ? [] : [{ file: path.join(dir, name), start }];
    })
    .toSorted((a, b) => a.start - b.start);
}

/** An action as its line, without its time, for telling a repeat from a new one. */
function sameness(input: ActionInput): string {
  return JSON.stringify(input);
}

export class ActionLog {
  readonly #dir: string;
  readonly #now: () => number;
  #day: string | undefined;
  #fd: number | undefined;
  #dayBytes = 0;
  #dayCapped = false;
  #last: { at: number; key: string } | undefined;
  #minute = -1;
  #perKind = new Map<string, number>();
  #dropped = new Map<string, number>();
  #onError: (error: unknown) => void;
  #reported = false;
  readonly #maxTotalBytes: number;

  constructor(
    dir: string,
    {
      maxTotalBytes = MAX_TOTAL_BYTES,
      now = Date.now,
      onError = () => {},
    }: {
      maxTotalBytes?: number;
      now?: () => number;
      onError?: (error: unknown) => void;
    } = {},
  ) {
    this.#dir = dir;
    this.#maxTotalBytes = maxTotalBytes;
    this.#now = now;
    this.#onError = onError;
  }

  /** Writes one action, stamped now. Never throws: a failure is reported once and the action is lost. */
  record(input: ActionInput): void {
    try {
      const now = this.#now();
      this.#rollMinute(now);
      const key = sameness(input);
      if (
        this.#last &&
        this.#last.key === key &&
        now - this.#last.at < REPEAT_WINDOW_MS
      ) {
        return;
      }
      const count = this.#perKind.get(input.kind) ?? 0;
      if (count >= PER_KIND_PER_MINUTE) {
        this.#dropped.set(input.kind, (this.#dropped.get(input.kind) ?? 0) + 1);
        return;
      }
      this.#perKind.set(input.kind, count + 1);
      if (this.#write({ ...input, at: new Date(now).toISOString() }, now)) {
        this.#last = { at: now, key };
      }
    } catch (error) {
      this.#report(error);
    }
  }

  /** Every action from `since` to `until` (now when absent), oldest first; a line that will not parse is skipped. */
  async read({
    since,
    until,
  }: {
    since: number;
    until?: number;
  }): Promise<LoggedAction[]> {
    const end = until ?? this.#now();
    const firstDay = new Date(since);
    firstDay.setHours(0, 0, 0, 0);
    const files = dayFiles(this.#dir).filter(
      (each) => each.start >= firstDay.getTime() && each.start <= end,
    );
    const actions: LoggedAction[] = [];
    for (const { file } of files) {
      let text: string;
      try {
        text = await fs.promises.readFile(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        const action = actionOf(line);
        if (!action) {
          continue;
        }
        const at = Date.parse(action.at);
        if (at >= since && at <= end) {
          actions.push(action);
        }
      }
    }
    return actions.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  /**
   * A page of the actions from `since` to `until`, newest first: `limit` of
   * them after the first `skip`, and whether older ones are left. Day files
   * are read from the newest back until the page is full, so a page costs
   * the days it covers rather than the whole folder.
   */
  async newestFirst({
    limit,
    since,
    skip,
    until,
  }: {
    limit: number;
    since: number;
    skip: number;
    until: number;
  }): Promise<{ actions: LoggedAction[]; more: boolean }> {
    const firstDay = new Date(since);
    firstDay.setHours(0, 0, 0, 0);
    const files = dayFiles(this.#dir)
      .filter((each) => each.start >= firstDay.getTime() && each.start <= until)
      .toReversed();
    const found: LoggedAction[] = [];
    for (const { file } of files) {
      let text: string;
      try {
        text = await fs.promises.readFile(file, "utf8");
      } catch {
        continue;
      }
      const day = text.split("\n").flatMap((line) => {
        const action = actionOf(line);
        if (!action) {
          return [];
        }
        const at = Date.parse(action.at);
        return at >= since && at <= until ? [action] : [];
      });
      found.push(
        ...day.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at)),
      );
      if (found.length > skip + limit) {
        break;
      }
    }
    return {
      actions: found.slice(skip, skip + limit),
      more: found.length > skip + limit,
    };
  }

  /** Deletes every day's file; the log starts again with the next action. */
  async clear(): Promise<void> {
    this.close();
    await Promise.all(
      dayFiles(this.#dir).map(({ file }) =>
        fs.promises.rm(file, { force: true }),
      ),
    );
    this.#last = undefined;
  }

  /** Writes what the caps left out and lets go of the day's file. */
  close(): void {
    try {
      this.#flushDropped(this.#now());
    } catch (error) {
      this.#report(error);
    }
    if (this.#fd !== undefined) {
      try {
        fs.closeSync(this.#fd);
      } catch {
        // Already gone; nothing to keep.
      }
    }
    this.#fd = undefined;
    this.#day = undefined;
  }

  /** Starts a new minute's counts, first writing what the last one dropped. */
  #rollMinute(now: number) {
    const minute = Math.floor(now / 60_000);
    if (minute === this.#minute) {
      return;
    }
    this.#flushDropped(now);
    this.#minute = minute;
    this.#perKind.clear();
  }

  #flushDropped(now: number) {
    for (const [of, dropped] of this.#dropped) {
      this.#write(
        { at: new Date(now).toISOString(), dropped, kind: "capped", of },
        now,
      );
    }
    this.#dropped.clear();
  }

  /** Appends one line to its day's file; false when the day's cap kept it out. */
  #write(action: LoggedAction, now: number): boolean {
    this.#openDay(now);
    if (this.#fd === undefined || this.#dayCapped) {
      return false;
    }
    const line = `${JSON.stringify(action)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.#dayBytes + bytes > MAX_DAY_BYTES) {
      this.#dayCapped = true;
      const marker = `${JSON.stringify({ at: new Date(now).toISOString(), dropped: 1, kind: "capped", of: "day" } satisfies LoggedAction)}\n`;
      fs.writeSync(this.#fd, marker);
      return false;
    }
    fs.writeSync(this.#fd, line);
    this.#dayBytes += bytes;
    return true;
  }

  /** Holds today's file open, opening it (and sweeping old ones) when the day changes. */
  #openDay(now: number) {
    const day = dayOf(now);
    if (day === this.#day && this.#fd !== undefined) {
      return;
    }
    if (this.#fd !== undefined) {
      fs.closeSync(this.#fd);
      this.#fd = undefined;
    }
    fs.mkdirSync(this.#dir, { recursive: true });
    const file = path.join(this.#dir, `${day}.jsonl`);
    // oxlint-disable-next-line studio/no-sync-content-read -- opens for append in the machine folder, which is never synced, and reads nothing
    this.#fd = fs.openSync(file, "a");
    this.#day = day;
    this.#dayBytes = fs.fstatSync(this.#fd).size;
    this.#dayCapped = this.#dayBytes >= MAX_DAY_BYTES;
    this.#sweep(file);
  }

  /** Removes the oldest days until the folder fits its cap; never today's. */
  #sweep(today: string) {
    const kept = dayFiles(this.#dir)
      .filter(({ file }) => file !== today)
      .map(({ file }) => ({ file, size: fs.statSync(file).size }));
    let total = kept.reduce((sum, each) => sum + each.size, this.#dayBytes);
    for (const { file, size } of kept) {
      if (total <= this.#maxTotalBytes) {
        break;
      }
      fs.rmSync(file, { force: true });
      total -= size;
    }
  }

  #report(error: unknown) {
    if (this.#reported) {
      return;
    }
    this.#reported = true;
    this.#onError(error);
  }
}

/** A line read back as the action it was, or nothing for one that will not parse. */
function actionOf(line: string): LoggedAction | undefined {
  if (!line.trim()) {
    return undefined;
  }
  try {
    const parsed = LoggedActionSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

let shared: ActionLog | undefined;

/** The running workspace's log, in its machine folder. */
export function actionLog(): ActionLog {
  const config = getWorkspaceConfig();
  shared ??= new ActionLog(actionsDir(config.workspaceMachineDir), {
    onError: (error) =>
      config.captureException(
        new Error("The action log could not be written", { cause: error }),
      ),
  });
  return shared;
}

/** Records what the person did, for a capture point in the app; nothing happens before a workspace runs. */
export function recordAction(input: ActionInput): void {
  let log: ActionLog;
  try {
    log = actionLog();
  } catch {
    return;
  }
  log.record(input);
}
