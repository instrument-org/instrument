import {
  copyCapture,
  currentBuild,
  hasOriginal,
  listCaptures,
  revertCapture,
  saveCaptureEdit,
  showCapture,
  takeCapture,
} from "@/electron-main/lib/captures";
import { devOnly } from "@/electron-main/rpc/base";
import { CaptureContextSchema } from "@/shared/captures";
import { webContents } from "electron";
import { z } from "zod";

const NameSchema = z.object({ name: z.string() });

/** The developer's captures of the window: taken, listed, edited and handed out. */
export const captures = {
  build: devOnly.handler(() => currentBuild()),
  copy: devOnly
    .input(NameSchema)
    .handler(({ input }) => copyCapture(input.name)),
  hasOriginal: devOnly
    .input(NameSchema)
    .handler(({ input }) => hasOriginal(input.name)),
  list: devOnly.handler(() => listCaptures()),
  revert: devOnly
    .input(NameSchema)
    .handler(({ input }) => revertCapture(input.name)),
  saveEdit: devOnly
    .input(z.object({ data: z.instanceof(Blob), name: z.string() }))
    .handler(async ({ input }) =>
      saveCaptureEdit(input.name, Buffer.from(await input.data.arrayBuffer())),
    ),
  show: devOnly
    .input(z.object({ name: z.string().optional() }))
    .handler(({ input }) => {
      showCapture(input.name);
    }),
  take: devOnly.input(CaptureContextSchema).handler(({ context, input }) => {
    const contents = webContents.fromId(context.webContentsId);
    if (!contents) {
      throw new Error("The window to capture is gone");
    }
    return takeCapture(contents, input);
  }),
};
