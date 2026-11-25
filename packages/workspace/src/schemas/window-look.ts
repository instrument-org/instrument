import { z } from "zod";

import { LayoutTabSchema } from "./group-layout";

/** A part of a window, as fractions of its width and height. */
const WindowBoxSchema = z.object({
  height: z.number(),
  width: z.number(),
  x: z.number(),
  y: z.number(),
});

export type WindowBox = z.output<typeof WindowBoxSchema>;

/**
 * A side of the tab group on screen, by the tab up on it, and where its page
 * is drawn: everything of the tab's below the side's row of tabs.
 */
const WindowSideSchema = z.object({
  box: WindowBoxSchema,
  /** For a folder: the folder its view starts from, whose folders down to this one it may list. */
  root: z.string().optional(),
  tab: LayoutTabSchema,
});

export type WindowSide = z.output<typeof WindowSideSchema>;

/**
 * What a window draws where, for blanking a picture of it: the page of each
 * side on screen, and every picture drawn anywhere in it. Nothing is said to
 * be showable: what reads this decides that, and blanks only what it finds
 * the chat may not read.
 */
export const WindowLookSchema = z.object({
  /** Pictures, players and frames drawn in the window, outside a web page's own. */
  pictures: z.array(
    z.object({
      box: WindowBoxSchema,
      /** The file on this computer it draws, where it is one. */
      file: z.string().optional(),
      /** Too small to be more than an icon. */
      isIcon: z.boolean(),
      /** The side it is drawn in, by its place in `sides`; none for one outside every side's page. */
      side: z.number().int().min(0).optional(),
    }),
  ),
  sides: z.array(WindowSideSchema),
});

export type WindowLook = z.output<typeof WindowLookSchema>;
