import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import {
  DRAFTS_DIR_NAME,
  draftDirOf,
  freeNameIn,
} from "@/electron-main/stores/workspace/drafts-folder";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { base } from "../base";

/** An id the client made, used as one folder's name. */
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
    const dir = draftDirOf(
      path.join(getWorkspaceFolder(), DRAFTS_DIR_NAME),
      input.draftId,
    );
    const item = `${input.draftId}/${input.itemId}`;
    const file =
      written.get(item) ?? path.join(dir, freeNameIn(dir, input.name));
    written.set(item, file);
    const bytes = Buffer.from(input.content, "base64");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, bytes);
    return { path: file, size: bytes.byteLength };
  });

export const drafts = { stage };
