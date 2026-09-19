import { formatDistanceStrict } from "date-fns";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { MEMORY_COMMAND } from "./shell-commands/memory-command";
import { systemNote } from "./system-note";

/**
 * Tells the agent what it remembers about the user: each memory's name and
 * first line, the thread it came from, and how long ago. The name is what
 * `memory show` and `memory save` take and what a link to the memory
 * carries, so the note names each one rather than leaving the agent to list
 * them again to find it. Rendered only when it differs from the last note,
 * so a thread is told once and again only on a change.
 */
export function memoryModelNote(data: SessionMessageDataPart.MemoryDataPart) {
  if (data.memories.length === 0) {
    return systemNote`
      Memory is empty now: nothing you remembered about the user is left.
    `;
  }
  const rows = data.memories
    .map((memory) => {
      // Two stored instants a fixed distance apart, so the words come out the
      // same every time the transcript is rebuilt.
      const when = formatDistanceStrict(
        new Date(memory.at),
        new Date(data.sentAt),
        { addSuffix: true },
      );
      const from = memory.from ? `from "${memory.from}", ` : "";
      return `- ${memory.name}: ${memory.text} (${from}${when})`;
    })
    .join("\n");
  const more =
    data.more > 0
      ? `\n...and ${data.more} more; \`${MEMORY_COMMAND.name} list\` names them all.`
      : "";
  const count = data.memories.length + data.more;
  return systemNote`
    What you remember about the user, kept for every thread (${count}):
    ${rows}${more}
    Each is what was true when it was saved. When one disagrees with what the user says now or a task reports, the present wins, and \`${MEMORY_COMMAND.name} save\` under the same name corrects it.
  `;
}
