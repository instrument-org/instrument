import { base } from "@/electron-main/rpc/base";
import {
  forgetHoverPictures,
  keepHoverPictures,
  keepOnlyHoverPictures,
  readHoverPictures,
  takeHoverPictures,
} from "@/electron-main/windows/hover-pictures";
import { webContents } from "electron";
import { z } from "zod";

const KeysSchema = z.object({ keys: z.array(z.string()) });

const RectSchema = z.object({
  height: z.number().int().positive(),
  width: z.number().int().positive(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

/** Small pictures of tabs and tab groups as they were last up, for hovering them. */
export const hoverPictures = {
  forget: base.input(KeysSchema).handler(async ({ input }) => {
    await forgetHoverPictures(input.keys);
  }),
  /** Keeps what `take` took, once the window says it showed the same throughout. */
  keep: base
    .input(z.object({ id: z.number() }))
    .handler(({ input }) => keepHoverPictures(input.id)),
  /** Every picture but those of the tabs there are, at startup. */
  keepOnly: base.input(KeysSchema).handler(async ({ input }) => {
    await keepOnlyHoverPictures(input.keys);
  }),
  read: base
    .input(
      z.object({
        wanted: z.array(
          z.object({
            have: z.number().optional(),
            key: z.string(),
            shows: z.string(),
          }),
        ),
      }),
    )
    .handler(({ input }) => readHoverPictures(input.wanted)),
  /** Pictures of parts of the window that asks. */
  take: base
    .input(
      z.object({
        parts: z.array(
          z.object({ key: z.string(), rect: RectSchema, shows: z.string() }),
        ),
      }),
    )
    .handler(async ({ context, input }) => {
      const contents = webContents.fromId(context.webContentsId);
      return contents ? takeHoverPictures(contents, input.parts) : null;
    }),
};
