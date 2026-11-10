import { forgetMemory, memoryDir, readMemory, saveMemory } from "./store";

/** A memory a turn saved or forgot, with its text on either side of the turn. */
export interface ChangedMemory {
  memory: { after: string | null; before: string | null };
  name: string;
}

/**
 * Puts back what a turn's `instrument memory` commands saved or forgot,
 * where the memory still says what the turn left: a memory the turn saved
 * is forgotten, one it changed or forgot gets its old text back. A memory
 * the person has changed since is theirs, and stays. Answers how many went
 * back and how many stayed.
 */
export async function undoMemoryChanges(
  changes: readonly ChangedMemory[],
): Promise<{ skipped: number; undone: number }> {
  const dir = memoryDir();
  let undone = 0;
  for (const { memory, name } of changes) {
    const now = (await readMemory(dir, name))?.text ?? null;
    if (now !== memory.after) {
      continue;
    }
    if (memory.before === null) {
      await forgetMemory(dir, name);
    } else {
      await saveMemory(dir, { name, text: memory.before });
    }
    undone += 1;
  }
  return { skipped: changes.length - undone, undone };
}
