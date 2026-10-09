import { type Memory } from "@instrument-org/workspace/client";

/** A run of memories one chat saved on one day, in the order the list gave them. */
export interface MemoryGroup {
  /** The chat they came from; none for memories saved outside a chat. */
  from: Memory["from"];
  key: string;
  memories: Memory[];
  /** When the group's newest memory was saved, which its heading shows. */
  newest: number;
}

/**
 * The list cut into runs of one chat and one local day, the way the chat's
 * own memory note groups them: a chat that saved thirty memories in a
 * sitting is named once over the thirty rather than on every row. Only
 * neighbors join, so the list keeps its order and a chat that saved again a
 * week later starts a group of its own.
 */
export function groupMemories(memories: Memory[]): MemoryGroup[] {
  const groups: MemoryGroup[] = [];
  let lastSource: string | undefined;
  for (const memory of memories) {
    const source = [
      memory.from?.sessionId ?? "",
      memory.from?.title ?? "",
      new Date(memory.at).toDateString(),
    ].join("\u0000");
    const group = groups.at(-1);
    if (group && source === lastSource) {
      group.memories.push(memory);
      group.newest = Math.max(group.newest, memory.at);
    } else {
      groups.push({
        from: memory.from,
        // The first memory's name, since a name is in one group only.
        key: memory.name,
        memories: [memory],
        newest: memory.at,
      });
    }
    lastSource = source;
  }
  return groups;
}

/** Whether a memory's name or text holds the search, ignoring case. */
export function memoryMatches(memory: Memory, query: string) {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    memory.text.toLowerCase().includes(needle) ||
    memory.name.toLowerCase().includes(needle)
  );
}

/**
 * The pick after a group's box is pressed: every memory in the group when
 * any of them was unpicked, and none of them when all of them were.
 */
export function toggleGroup(
  picked: ReadonlySet<string>,
  names: string[],
): ReadonlySet<string> {
  const next = new Set(picked);
  if (names.every((name) => picked.has(name))) {
    for (const name of names) {
      next.delete(name);
    }
  } else {
    for (const name of names) {
      next.add(name);
    }
  }
  return next;
}
