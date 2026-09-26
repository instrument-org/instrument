import {
  loadEditablePage,
  stopEditingPage,
} from "@/electron-main/page-editor/sessions";
import { base } from "@/electron-main/rpc/base";
import path from "node:path";
import { z } from "zod";

const PageSchema = z.object({
  path: z.string().refine((value) => path.isAbsolute(value), {
    message: "Not a path on this computer",
  }),
  /** The page tab's guest. */
  webContentsId: z.number().int(),
});

/**
 * A page tab's file, switched between the page as it is and the page ready to
 * edit in place; see `page-editor/sessions.ts`.
 */
export const pageEditor = {
  /**
   * Shows the file ready to edit, from `text` when the editor holds text of
   * its own, with its `state` handed back to it. Answers the load's
   * generation, which `stop` names, or that the page is too large to edit.
   */
  load: base
    .input(
      PageSchema.extend({
        state: z.unknown().optional(),
        text: z.string().optional(),
      }),
    )
    .handler(({ input }) => loadEditablePage(input)),
  /** Shows the file at its own address again, when the load it names is still the guest's. */
  stop: base
    .input(PageSchema.extend({ generation: z.number().int() }))
    .handler(async ({ input }) => {
      await stopEditingPage(input);
    }),
};
