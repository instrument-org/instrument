import { publisher } from "../../rpc/publisher";
import { watchFolder } from "../folder-watch";
import { memoryDir } from "./store";

/**
 * Tells everyone watching when the memory folder changes under them.
 *
 * A memory is a file a person is invited to edit, and the folder is one click
 * away on the screen that lists them, so what is on screen has to follow what
 * is on disk. Our own writes publish for themselves; this is for the other
 * hand. Kept for as long as a caller holds it, since the only caller is a
 * live query that already has a lifetime.
 */
export async function startWatchingMemory(): Promise<() => void> {
  return watchFolder(memoryDir(), {
    depth: 0,
    onChange: () => {
      publisher.publish("memory.changed", null);
    },
  });
}
