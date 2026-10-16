import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import {
  draftDirOf,
  freeNameIn,
} from "@/electron-main/stores/workspace/drafts-folder";
import { pointDraftAtChat } from "@instrument-org/workspace/drafts";
import { ChatIdSchema } from "@instrument-org/workspace/electron";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { base } from "../base";

/** An id the client made, which one draft's file names it by. */
const IdSchema = z.string().regex(/^[\w-]+$/);

/** A file's own name, never a path: what the send checks the copy against. */
const NameSchema = z
  .string()
  .min(1)
  .refine(
    (name) => name === path.basename(name) && name !== "." && name !== "..",
  );

/**
 * Where each item already written went, by draft and item: the composer
 * hands an item over again when its window comes back up in the same run,
 * and that rewrites its file rather than adding a copy beside it.
 */
const written = new Map<string, string>();

/**
 * Points a draft at the chat it is about to be sent into, and waits for the
 * file. The first step of a send: the message that says a draft was sent is
 * in that chat's records, so until the draft names the chat, a launch after a
 * crash has nowhere to look and would leave the draft to be sent again.
 *
 * Its own call rather than a change to the draft the window writes, because
 * the window's writes are gathered on a timer: the send has to know the
 * draft names its chat before it appends anything.
 */
const claim = base
  .input(z.object({ chatId: ChatIdSchema, draftId: IdSchema }))
  .output(z.object({ claimed: z.boolean() }))
  .handler(({ input }) => ({
    claimed:
      pointDraftAtChat({
        chatId: input.chatId,
        draftId: input.draftId,
        rootDir: getWorkspaceFolder(),
      }) !== undefined,
  }));

/**
 * Writes bytes a draft was given with no file behind them (a pasted image,
 * long pasted words) into the draft's own folder, under their own name, so
 * the draft can keep them past a relaunch as a path and send them the way a
 * file from disk is sent. A second paste of the same name is numbered beside
 * the first, the way Finder numbers a copy.
 */
const stage = base
  .input(
    z.object({
      /** The bytes, base64. */
      content: z.string(),
      draftId: IdSchema,
      itemId: IdSchema,
      name: NameSchema,
    }),
  )
  .output(z.object({ path: z.string(), size: z.number() }))
  .handler(async ({ input }) => {
    const dir = draftDirOf(getWorkspaceFolder(), input.draftId);
    const item = `${input.draftId}/${input.itemId}`;
    // The one already written, where it is still in the folder the draft is
    // in now: a draft's folder can be taken away and made again, and a name
    // remembered from the one before it names nowhere.
    const was = written.get(item);
    const file =
      was !== undefined && path.dirname(was) === dir
        ? was
        : path.join(dir, freeNameIn(dir, input.name));
    written.set(item, file);
    const bytes = Buffer.from(input.content, "base64");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, bytes);
    return { path: file, size: bytes.byteLength };
  });

export const drafts = { claim, stage };
