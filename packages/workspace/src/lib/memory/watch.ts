import { publisher } from "../../rpc/publisher";
import { watchFolder } from "../folder-watch";
import { watchMemoryRecords } from "./memory-records";
import { memoryDir } from "./store";

/**
 * Tells everyone watching when the memory folder, or what the store says
 * about its memories, changes under them.
 *
 * A memory is a file a person is invited to edit, and the folder is one click
 * away on the screen that lists them, so what is on screen has to follow what
 * is on disk. Our own writes publish for themselves; this is for the other
 * hand. Kept for as long as a caller holds it, since the only caller is a
 * live query that already has a lifetime.
 */
export async function startWatchingMemory(): Promise<() => void> {
  const dir = memoryDir();
  const onChange = () => {
    publisher.publish("memory.changed", null);
  };
  const stopFolder = watchFolder(dir, { depth: 0, onChange });
  const stopRecords = watchMemoryRecords(dir, onChange);
  return () => {
    stopFolder();
    stopRecords();
  };
}
