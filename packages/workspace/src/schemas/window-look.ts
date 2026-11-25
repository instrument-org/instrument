import { z } from "zod";

import { LayoutTabSchema } from "./group-layout";

/** A part of a window, as fractions of its width and height. */
export const WindowBoxSchema = z.object({
  height: z.number(),
  width: z.number(),
  x: z.number(),
  y: z.number(),
});

export type WindowBox = z.output<typeof WindowBoxSchema>;

/**
 * What draws a point of a window, as far as the window can say: its own
 * frame (the sidebar, the tabs, the ground between), a web page by its tab,
 * or a side by the tab up on it.
 */
const WindowOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("frame") }),
  z.object({ kind: z.literal("page"), tabId: z.string() }),
  z.object({
    kind: z.literal("side"),
    /** For a folder: the folder its view starts from, whose folders down to this one it may list. */
    root: z.string().optional(),
    tab: LayoutTabSchema,
  }),
]);

export type WindowOwner = z.output<typeof WindowOwnerSchema>;

/**
 * What a window draws where, for blanking a picture of it: `points` is a
 * grid over the window, `columns` + 1 by `rows` + 1, each the place in
 * `owners` of what is on top there, or -1 for anything the window cannot
 * name (a menu, a dialog, a toast). Nothing is said to be showable: what
 * reads this decides that.
 */
export const WindowLookSchema = z.object({
  columns: z.number().int().min(1).max(400),
  /** What stands over the sides and is never in a picture. */
  covers: z.array(WindowBoxSchema),
  owners: z.array(WindowOwnerSchema),
  /** Pictures, players and frames drawn inside a side. */
  pictures: z.array(
    z.object({
      box: WindowBoxSchema,
      /** The file on this computer it draws, where it is one. */
      file: z.string().optional(),
      /** Too small to be more than an icon. */
      isIcon: z.boolean(),
      /** Its side's place in `owners`. */
      owner: z.number().int().min(0),
    }),
  ),
  points: z.array(z.number().int().min(-1)),
  rows: z.number().int().min(1).max(400),
});

export type WindowLook = z.output<typeof WindowLookSchema>;
