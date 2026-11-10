import { eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  listMemorySources,
  MemorySourceSchema,
} from "../../lib/memory/sources";
import {
  forgetMemories,
  listMemories,
  memoryDir,
  MemorySchema,
  readMemory,
} from "../../lib/memory/store";
import { ChangesCardSchema, markCardUndone } from "../../lib/chat/card-undone";
import { undoMemoryChanges } from "../../lib/memory/undo-memory-changes";
import { startWatchingMemory } from "../../lib/memory/watch";
import { base } from "../base";
import { liveRead } from "../live-read";
import { publisher } from "../publisher";

const MemoryFolderSchema = z.object({
  /** Where the files are, for a viewer that opens the folder. */
  dir: z.string(),
  memories: MemorySchema.array(),
});

/** What the conversation remembers about the user: the folder, and every memory in it newest first. */
async function readMemoryFolder() {
  const dir = memoryDir();
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
      yield* liveRead({ changes: [changes], read: readMemoryFolder });
    } finally {
      stopWatching();
    }
  });

/** The coding agents on this computer whose memory is there to import. */
const listMemorySourcesRoute = base
  .output(MemorySourceSchema.array())
  .handler(() => listMemorySources());

/** The file a memory is in, by its name, or null when no memory has that name. */
const locateMemoryRoute = base
  .input(z.object({ name: z.string() }))
  .output(z.string().nullable())
  .handler(
    async ({ input }) =>
      (await readMemory(memoryDir(), input.name))?.path ?? null,
  );

/** Drops one memory by name. Nothing happens when there is none by it. */
const forgetMemoryRoute = base
  .input(z.object({ names: z.array(z.string()).min(1) }))
  .handler(async ({ input }) => {
    await forgetMemories(memoryDir(), input.names);
  });

/**
 * Puts back what a turn's `instrument memory` commands saved or forgot,
 * where each memory still says what the turn left, and marks the card
 * undone.
 */
const undoMemoryChangesRoute = base
  .input(
    z.object({
      /** The card the Undo is on, which is marked undone. */
      card: ChangesCardSchema.optional(),
      changes: z.array(
        z.object({
          memory: z.object({
            after: z.string().nullable(),
            before: z.string().nullable(),
          }),
          name: z.string(),
        }),
      ),
    }),
  )
  .output(z.object({ skipped: z.number(), undone: z.number() }))
  .handler(async ({ input }) => {
    const outcome = await undoMemoryChanges(input.changes);
    if (input.card) {
      await markCardUndone(input.card, outcome, { cardOf: "memory" });
    }
    return outcome;
  });

export const memory = {
  forget: forgetMemoryRoute,
  live: { list: liveListMemoryRoute },
  locate: locateMemoryRoute,
  sources: listMemorySourcesRoute,
  undoChanges: undoMemoryChangesRoute,
};
