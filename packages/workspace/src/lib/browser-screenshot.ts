import { z } from "zod";

import { previewImage } from "./image-preview";
import { imageViewSize, PREVIEW_LIMITS } from "./image-view-size";
import { isCompleteImage } from "./probe-media";
import { exceedsDecodeBudget, measureImage } from "./render-image";
import { type ToolFs } from "./tool-fs";
import { shellPath } from "./workspace-fs-layout";

/**
 * A screenshot an `agent-browser` command took, as the model is shown it with
 * the result of the bash call that took it. The bytes are the same preview
 * `read_file` would make of the file, so the size it reports is the size the
 * model sees, and the image costs what one `read_file` of it would.
 */
export const BrowserScreenshotSchema = z.object({
  base64Data: z.string(),
  height: z.number(),
  mimeType: z.string(),
  viewHeight: z.number(),
  viewWidth: z.number(),
  width: z.number(),
});

export type BrowserScreenshot = z.output<typeof BrowserScreenshotSchema>;

/**
 * The preview of a screenshot on the host, or nothing for a file that is gone,
 * the rules refuse, or is not an image a model can be sent whole. Nothing is
 * an answer, not an error: the command already said where it saved the file,
 * and the model can still read it.
 *
 * The file is read through the session's {@link ToolFs}, as `read_file` reads
 * it, since the agent's programs can replace it with a link between the
 * command writing it and this read.
 */
export async function browserScreenshot({
  files,
  hostPath,
  signal,
}: {
  files: ToolFs;
  hostPath: string;
  signal: AbortSignal;
}): Promise<BrowserScreenshot | undefined> {
  const read = await files.fs
    .readFileBuffer(shellPath(hostPath))
    .catch(() => {});
  if (!read) {
    return undefined;
  }
  const fileData = Buffer.from(read.buffer, read.byteOffset, read.byteLength);
  const size = measureImage(fileData);
  const target = size && imageViewSize({ ...size, limits: PREVIEW_LIMITS });
  if (
    !size ||
    !target ||
    exceedsDecodeBudget(size) ||
    !isCompleteImage(fileData, size.mediaType)
  ) {
    return undefined;
  }
  const preview = await previewImage({ fileData, signal, size, target });
  if (preview.isErr()) {
    return undefined;
  }
  const { bytes, mediaType, view } = preview.value;
  return {
    base64Data: bytes.toString("base64"),
    height: size.height,
    mimeType: mediaType,
    viewHeight: view.height,
    viewWidth: view.width,
    width: size.width,
  };
}
