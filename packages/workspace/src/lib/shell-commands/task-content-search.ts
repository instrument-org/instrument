import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { type TaskId } from "../../schemas/task-id";
import { sessionStorePath, taskDir } from "../task-dir-utils";

/** How much of the surrounding text a hit is shown in. */
const SNIPPET_LENGTH = 120;

/** Characters of lead-in kept before the hit, so it is not flush at the edge. */
const SNIPPET_LEAD = 40;

/**
 * How many databases are walked before the loop hands back the event loop.
 *
 * `node:sqlite` is synchronous, so a search of a long history is one long
 * block in the process that is also streaming the conversation. Yielding
 * every so often costs nothing measurable and keeps that stream moving.
 */
const YIELD_EVERY = 25;

/** What a task's conversation had to say about the term. */
export interface TaskContentHit {
  /** Text parts that matched, which is how strongly the task is about it. */
  count: number;
  snippet: string;
}

/**
 * The term as it appears inside a stored part.
 *
 * Bodies are written as JSON, so a term carrying a quote, a backslash, or a
 * newline is held in escaped form and a search for the raw characters matches
 * nothing at all. Escaping the term the same way is what makes the prefilter
 * agree with the bytes on disk; for an ordinary word the two are identical.
 */
export function jsonEscaped(term: string): string {
  return JSON.stringify(term).slice(1, -1);
}

/**
 * What a stored part actually said, or nothing when it did not say anything.
 *
 * Only the text a person or the agent wrote. A part's tool input and output
 * hold file paths, page bodies, and command lines, and matching those makes a
 * search for "wayfair" rank a skills reference above the conversation that was
 * about it: measured, the noise crowds out the answer.
 */
export function partText(blob: unknown): string | undefined {
  const raw =
    typeof blob === "string"
      ? blob
      : blob instanceof Uint8Array
        ? Buffer.from(blob).toString("utf8")
        : undefined;
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "json" in parsed) {
      const body = parsed.json;
      if (body && typeof body === "object" && "text" in body) {
        return typeof body.text === "string" ? body.text : undefined;
      }
    }
  } catch {
    // A body this build cannot read is not a match; the search moves on.
  }
  return undefined;
}

/**
 * What each task said about the term, over every task named.
 *
 * Opens each conversation read-only and closes it at once, rather than going
 * through `getSessionsStoreStorage`: that accessor keeps one storage instance
 * per task in a map nothing evicts, and its driver never closes the database,
 * so a search routed through it would leave every task open for the life of
 * the process and run the store migrations against each one on the way.
 *
 * The SQL is a prefilter and not the answer. It narrows to the rows whose
 * bytes contain the term anywhere, and each of those is then decoded and
 * checked against what was actually said, so a hit inside a tool's arguments
 * or a file path does not count.
 */
export async function searchTaskContent({
  taskIds,
  term,
}: {
  taskIds: TaskId[];
  term: string;
}): Promise<Map<TaskId, TaskContentHit>> {
  const hits = new Map<TaskId, TaskContentHit>();
  const pattern = `%${jsonEscaped(term)}%`;
  const wanted = term.toLowerCase();
  for (const [index, taskId] of taskIds.entries()) {
    if (index > 0 && index % YIELD_EVERY === 0) {
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }
    const hit = searchOneTask(taskId, pattern, wanted);
    if (hit) {
      hits.set(taskId, hit);
    }
  }
  return hits;
}

/**
 * The words either side of a hit, as one line.
 *
 * Enough lead-in that the match is read in context rather than at the very
 * start, and whitespace collapsed because a part body carries the newlines of
 * whatever was said and a listing has one line per hit.
 */
export function snippetAround(text: string, at: number): string {
  const from = Math.max(0, at - SNIPPET_LEAD);
  const body = text.slice(from, from + SNIPPET_LENGTH).replaceAll(/\s+/g, " ");
  return `${from > 0 ? "…" : ""}${body.trim()}${from + SNIPPET_LENGTH < text.length ? "…" : ""}`;
}

function searchOneTask(
  taskId: TaskId,
  pattern: string,
  wanted: string,
): TaskContentHit | undefined {
  const file = sessionStorePath(taskDir(taskId));
  if (!fs.existsSync(file)) {
    return undefined;
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(file, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT blob FROM sessions
         WHERE key LIKE 'parts:%'
           AND CAST(blob AS TEXT) LIKE ? COLLATE NOCASE`,
      )
      .all(pattern);
    let count = 0;
    let snippet: string | undefined;
    for (const row of rows) {
      const text = partText(row.blob);
      const at = text?.toLowerCase().indexOf(wanted) ?? -1;
      if (text === undefined || at === -1) {
        continue;
      }
      count++;
      snippet ??= snippetAround(text, at);
    }
    return count > 0 && snippet !== undefined ? { count, snippet } : undefined;
  } catch {
    // A conversation being written, or one this build cannot open, is skipped
    // rather than failing a search across every other one.
    return undefined;
  } finally {
    database?.close();
  }
}
