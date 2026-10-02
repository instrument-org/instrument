import { eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  listMemorySources,
  MemorySourceSchema,
} from "../../lib/memory/sources";
import {
  ensureMemoryDir,
  forgetMemories,
  listMemories,
  memoryDir,
  MemorySchema,
} from "../../lib/memory/store";
import { startWatchingMemory } from "../../lib/memory/watch";
import { base } from "../base";
import { publisher } from "../publisher";

const MemoryFolderSchema = z.object({
  /** Where the files are, for a viewer that opens the folder. */
  dir: z.string(),
  memories: MemorySchema.array(),
});

/** What the conversation remembers about the user: the folder, and every memory in it newest first. */
async function readMemoryFolder() {
  const dir = memoryDir();
  await ensureMemoryDir(dir);
  return { dir, memories: await listMemories(dir) };
}

/** The memory folder, re-read whenever a memory is saved, corrected, or forgotten. */
const liveListMemoryRoute = base
  .output(eventIterator(MemoryFolderSchema))
  .handler(async function* ({ signal }) {
    const changes = publisher.subscribe("memory.changed", { signal });
    // Held for the life of the subscription, so a file edited in the folder
    // reaches the screen listing it.
    const stopWatching = await startWatchingMemory();
    try {
      yield await readMemoryFolder();
      for await (const _change of changes) {
        yield await readMemoryFolder();
      }
    } finally {
      stopWatching();
    }
  });

/** The coding agents on this computer whose memory is there to import. */
const listMemorySourcesRoute = base
  .output(MemorySourceSchema.array())
  .handler(() => listMemorySources());

/** Drops one memory by name. Nothing happens when there is none by it. */
const forgetMemoryRoute = base
  .input(z.object({ names: z.array(z.string()).min(1) }))
  .handler(async ({ input }) => {
    await forgetMemories(memoryDir(), input.names);
  });

export const memory = {
  forget: forgetMemoryRoute,
  live: { list: liveListMemoryRoute },
  sources: listMemorySourcesRoute,
};
