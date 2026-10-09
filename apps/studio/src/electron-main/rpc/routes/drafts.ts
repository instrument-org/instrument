import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { workspacePrivateDir } from "@/electron-main/lib/workspaces";
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
 * Where a draft keeps what its composer was given with no file behind it (a
 * pasted image, long pasted words), in the workspace's own folder beside its
 * settings. One folder per item, so two pastes both named `image.png` stay
 * two files under their own names.
 */
function draftDir(draftId: string) {
  return path.join(
    workspacePrivateDir(getWorkspaceFolder()),
    "drafts",
    draftId,
  );
}

/**
 * Writes bytes a draft was given to a file of its own, so the draft can keep
 * them past a relaunch as a path and send them the way a file from disk is
 * sent. Writing the same item again replaces it.
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
    const dir = path.join(draftDir(input.draftId), input.itemId);
    const file = path.join(dir, input.name);
    const bytes = Buffer.from(input.content, "base64");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, bytes);
    return { path: file, size: bytes.byteLength };
  });

/** Lets go of everything a draft kept on disk, for a draft sent or thrown away. */
const clear = base
  .input(z.object({ draftId: IdSchema }))
  .handler(async ({ input }) => {
    await fs.rm(draftDir(input.draftId), { force: true, recursive: true });
  });

/**
 * Lets go of what drafts no longer here kept on disk: one thrown away while
 * its clear never ran, say, because the app quit first.
 */
const prune = base
  .input(z.object({ keep: z.array(IdSchema) }))
  .handler(async ({ input }) => {
    const root = path.join(workspacePrivateDir(getWorkspaceFolder()), "drafts");
    const keep = new Set(input.keep);
    const entries = await fs.readdir(root).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => !keep.has(entry))
        .map((entry) =>
          fs.rm(path.join(root, entry), { force: true, recursive: true }),
        ),
    );
  });

export const drafts = { clear, prune, stage };
