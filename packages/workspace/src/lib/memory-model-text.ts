import { formatDistanceStrict } from "date-fns";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { MEMORY_COMMAND } from "./shell-commands/memory-command";
import { systemNote } from "./system-note";

type MemoryRow = SessionMessageDataPart.MemoryDataPart["memories"][number];

/**
 * Tells the agent what it remembers about the user: the whole of memory the
 * first time, and after that what was saved, corrected, or forgotten since
 * it was last told. Each memory is its name and first line; the name is what
 * `memory show` and `memory save` take and what a link to the memory
 * carries, so the note names each one rather than leaving the agent to list
 * them again to find it.
 *
 * Rows are grouped under the thread they came from and the day, so a thread
 * that saved thirty memories in a sitting names itself once rather than on
 * every row. Rendered only when it differs from the last note, so a thread
 * is told once and again only on a change.
 */
export function memoryModelNote(data: SessionMessageDataPart.MemoryDataPart) {
  if (data.tells === "whole" && data.memories.length === 0) {
    return systemNote`
      Memory is empty now: nothing you remembered about the user is left.
    `;
  }
  const standing = `Each is what was true when it was saved. When one disagrees with what the user says now or a task reports, the present wins, and \`${MEMORY_COMMAND.name} save\` under the same name corrects it.`;
  if (data.tells === "changes") {
    const saved =
      data.memories.length > 0
        ? `\nSaved or corrected:\n${groupedRows(data.memories, data.sentAt)}`
        : "";
    const forgotten =
      data.forgotten.length > 0
        ? `\nForgotten: ${data.forgotten.join(", ")}.`
        : "";
    return systemNote`
      Memory changed since you were last told.${saved}${forgotten}
      ${standing}
    `;
  }
  const more =
    data.more > 0
      ? `\n...and ${data.more} more; \`${MEMORY_COMMAND.name} list\` names them all.`
      : "";
  const count = data.memories.length + data.more;
  return systemNote`
    What you remember about the user, kept for every thread (${count}):
    ${groupedRows(data.memories, data.sentAt)}${more}
    ${standing}
  `;
}

/**
 * The rows under a heading per source: the thread the run of memories came
 * from and how long ago, or that they came from no thread. A group holds one
 * thread's memories from one day, in the order given, and its "how long ago"
 * is its newest memory's.
 */
function groupedRows(memories: MemoryRow[], sentAt: number): string {
  const groups: { rows: MemoryRow[]; source: string }[] = [];
  for (const memory of memories) {
    const source = `${memory.from ?? ""}\n${day(memory.at)}`;
    const group = groups.at(-1);
    if (group && group.source === source) {
      group.rows.push(memory);
    } else {
      groups.push({ rows: [memory], source });
    }
  }
  return groups
    .map(({ rows }) => {
      const newest = rows.reduce((a, b) => (b.at > a.at ? b : a));
      // Two stored instants a fixed distance apart, so the words come out the
      // same every time the transcript is rebuilt.
      const when = formatDistanceStrict(new Date(newest.at), new Date(sentAt), {
        addSuffix: true,
      });
      const from = newest.from ? `From "${newest.from}"` : "From no thread";
      const lines = rows.map((row) => `- ${row.name}: ${row.text}`);
      return [`${from}, ${when}:`, ...lines].join("\n");
    })
    .join("\n");
}

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
