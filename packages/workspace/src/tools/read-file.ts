// Adapted from
// https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/read.ts
import { isBinaryFile } from "isbinaryfile";
import ms from "ms";
import { err, ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { dedent } from "radashi";
import { z } from "zod";

import { TASK_FOLDER_NAMES } from "../constants";
import { addLineNumbers } from "../lib/add-line-numbers";
import { executeError } from "../lib/execute-error";
import { redactTaskDir } from "../lib/filter-shell-output";
import { formatBytes } from "../lib/format-bytes";
import { getMimeType } from "../lib/get-mime-type";
import {
  cropRegion,
  describeImageSize,
  isReadableImage,
  previewImage,
  type RegionInput,
  RegionSchema,
  SUPPORTED_IMAGE_FORMATS,
} from "../lib/image-preview";
import { imageViewSize, PREVIEW_LIMITS } from "../lib/image-view-size";
import { listFiles } from "../lib/list-files";
import { pathExists } from "../lib/path-exists";
import {
  canDecodeMedia,
  isCompleteImage,
  isReadablePdf,
} from "../lib/probe-media";
import {
  exceedsDecodeBudget,
  MAX_DECODED_PIXELS,
  measureImage,
} from "../lib/render-image";
import {
  getSimilarPathSuggestions,
  resolveExistingFilePath,
} from "../lib/resolve-agent-path";
import { truncateWithoutSplitting } from "../lib/sanitize-model-text";
import { FFPROBE_COMMAND } from "../lib/shell-commands/ffprobe";
import { systemNote } from "../lib/system-note";
import { taskDir } from "../lib/task-dir-utils";
import { buildWorkspaceFsLayout } from "../lib/workspace-fs-layout";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const DEFAULT_READ_LIMIT = 2000;
const DIRECTORY_LISTING_LIMIT = 200;
const MAX_LINE_LENGTH = 2000;
const MAX_BYTES = 50 * 1024;

const INPUT_PARAMS = {
  filePath: "filePath",
  limit: "limit",
  offset: "offset",
  region: "region",
} as const;

type MediaFileState = "audio" | "image" | "pdf" | "video";

/**
 * Tell a region the model asked for from one it merely filled in.
 *
 * An all-zero rectangle is the shape of an object whose fields were populated
 * with defaults, not a place on the picture: it names no location and no area,
 * so there is nothing in it to honor or to correct. Measured across models, one
 * family sends it on the first read of every image, which cost a round trip and
 * an error that taught it nothing.
 *
 * Only all four corners at zero. Any other empty or out-of-bounds rectangle
 * still fails loudly, because that one does express a location -- the model
 * meant somewhere and got the coordinate space wrong, and the error naming the
 * space it should have used is what recovers it.
 */
function requestedRegion(region?: RegionInput) {
  if (
    region?.x1 === 0 &&
    region.x2 === 0 &&
    region.y1 === 0 &&
    region.y2 === 0
  ) {
    return;
  }
  return region;
}

const MEDIA_CONFIG: Record<MediaFileState, { label: string; maxSize: number }> =
  {
    audio: {
      label: "Audio",
      maxSize: 10 * 1024 * 1024,
    },
    image: {
      label: "Image",
      // Providers cap a single image around 5 MB encoded, but an image over
      // that no longer has to be refused: outgoing images are resized to the
      // provider's budget on the way out (`normalize-model-images.ts`), which
      // brings a large photo or scan under the cap on its own. So this bounds
      // only how much is read off disk and base64'd. What a decode would cost
      // is a separate question that bytes cannot answer -- see
      // `MAX_DECODED_PIXELS`.
      maxSize: 50 * 1024 * 1024,
    },
    pdf: {
      label: "PDF",
      maxSize: 10 * 1024 * 1024,
    },
    video: {
      label: "Video",
      maxSize: 10 * 1024 * 1024,
    },
  };

async function handleMediaFile({
  absolutePath,
  fixedPath,
  mimeType,
  region,
  signal,
  state,
}: {
  absolutePath: string;
  fixedPath: string;
  mimeType: string;
  region?: RegionInput;
  signal: AbortSignal;
  state: MediaFileState;
}) {
  const config = MEDIA_CONFIG[state];
  const stats = await fs.stat(absolutePath);

  if (state === "image" && !SUPPORTED_IMAGE_FORMATS.includes(mimeType)) {
    return ok({
      filePath: fixedPath,
      mimeType,
      modifiedAt: stats.mtimeMs,
      reason: "unsupported-image-format" as const,
      state: "unsupported-format" as const,
    });
  }

  if (stats.size > config.maxSize) {
    return executeError(
      [
        `${config.label} file too large: ${fixedPath}`,
        `(${formatBytes(stats.size)}, max ${formatBytes(config.maxSize)}).`,
        "You can use command-line tools or scripts to compress or convert the file to reduce its size.",
      ].join(" "),
    );
  }

  const fileData = await fs.readFile(absolutePath, { signal });

  if (state !== "image") {
    // Same reason images are checked: these go out as media with nothing but a
    // size cap between them and the provider, so a corrupt PDF or a half-
    // downloaded video ends the conversation the way a corrupt image used to.
    const decodable =
      state === "pdf"
        ? isReadablePdf(fileData)
        : await canDecodeMedia({ absolutePath, signal });

    if (!decodable) {
      return ok({
        filePath: fixedPath,
        mimeType,
        modifiedAt: stats.mtimeMs,
        reason:
          state === "pdf"
            ? ("undecodable-pdf" as const)
            : ("undecodable-media" as const),
        state: "unsupported-format" as const,
      });
    }

    return ok({
      base64Data: fileData.toString("base64"),
      filePath: fixedPath,
      mimeType,
      modifiedAt: stats.mtimeMs,
      state,
    });
  }

  const size = measureImage(fileData);
  const target = size && imageViewSize({ ...size, limits: PREVIEW_LIMITS });

  // Report what the bytes are, not what the name claims. `getMimeType` reads
  // the extension, and a downloaded `.jpg` that is really a PNG would otherwise
  // be announced as a JPEG -- a contradiction the provider rejects, on content
  // already written to disk and replayed every turn after.
  const sniffedMimeType = size?.mediaType ?? mimeType;

  if (!size || !target) {
    // Nothing could read these bytes as an image. Say so rather than handing
    // them on: the send would be rejected for content that is already saved and
    // replayed on every later turn.
    return ok({
      filePath: fixedPath,
      mimeType,
      modifiedAt: stats.mtimeMs,
      reason: "undecodable-image" as const,
      state: "unsupported-format" as const,
    });
  }

  if (exceedsDecodeBudget(size)) {
    // Ahead of the completeness check below, which a file this size would also
    // fail: what makes it dangerous is the dimensions it declares, and that is
    // what the message needs to name.
    //
    // Refused before it enters the transcript, not just before it is rendered:
    // once the part is saved, every later turn hands the same declared
    // dimensions to the resize pass and pays for the attempt again.
    return ok({
      filePath: fixedPath,
      mimeType: sniffedMimeType,
      modifiedAt: stats.mtimeMs,
      reason: "image-too-large" as const,
      state: "unsupported-format" as const,
    });
  }

  if (!isCompleteImage(fileData, size.mediaType)) {
    // The header parsed over data that stops early. This matters most for an
    // image inside the preview budget, which is passed through byte for byte
    // and so is never decoded anywhere else on the way out.
    return ok({
      filePath: fixedPath,
      mimeType: sniffedMimeType,
      modifiedAt: stats.mtimeMs,
      reason: "undecodable-image" as const,
      state: "unsupported-format" as const,
    });
  }

  // The preview is produced here, so the dimensions announced below are measured
  // from the bytes that go with them rather than predicted for bytes something
  // else will render later. Two things used to break that agreement: the send-time
  // resize ran against whichever model was active by then, and it could shrink
  // below its own target to fit the byte cap while the text still named the
  // target. Neither can happen to a size read off the result.
  const preview = await previewImage({ fileData, signal, size, target });
  if (preview.isErr()) {
    return err(preview.error);
  }
  const {
    bytes: previewBytes,
    mediaType: previewMediaType,
    view,
  } = preview.value;

  const dimensions = {
    height: size.height,
    viewHeight: view.height,
    viewWidth: view.width,
    width: size.width,
  };

  if (!region) {
    return ok({
      base64Data: previewBytes.toString("base64"),
      filePath: fixedPath,
      mimeType: previewMediaType,
      modifiedAt: stats.mtimeMs,
      state,
      ...dimensions,
    });
  }

  const cropped = await cropRegion({
    fileData,
    limits: PREVIEW_LIMITS,
    region,
    signal,
    size,
    view,
  });
  if (cropped.isErr()) {
    return err(cropped.error);
  }

  return ok({
    ...dimensions,
    base64Data: cropped.value.rendered.bytes.toString("base64"),
    filePath: fixedPath,
    mimeType: cropped.value.rendered.mediaType,
    modifiedAt: stats.mtimeMs,
    region: cropped.value.region,
    renderedHeight: cropped.value.rendered.height,
    renderedWidth: cropped.value.rendered.width,
    state,
  });
}

export const ReadFile = setupTool({
  inputSchema: BaseInputSchema.extend({
    [INPUT_PARAMS.filePath]: z.string().meta({
      description:
        "Relative path to the file to read, or a read-only attached-folder mount path (/mnt/<name>/...)",
    }),
    [INPUT_PARAMS.limit]: z
      .number()
      .optional()
      .meta({
        description: `The number of lines to read (defaults to ${DEFAULT_READ_LIMIT})`,
      }),
    [INPUT_PARAMS.offset]: z.number().optional().meta({
      description:
        "The line number to start reading from (1-based, defaults to 1)",
    }),
    [INPUT_PARAMS.region]: RegionSchema.optional().meta({
      description:
        "Images only. Two opposite corners of a rectangle, in the pixel space of the whole image as you were first shown it (origin at the top-left, x right, y down) -- not the pixel space of a magnified crop from an earlier read. Returns that region cropped from the full-resolution file and magnified.",
    }),
  }),
  name: "read_file",
  outputSchema: z.discriminatedUnion("state", [
    z.object({
      content: z.string(),
      displayedLines: z.number(),
      filePath: z.string(),
      hasMoreLines: z.boolean(),
      modifiedAt: z.number(),
      offset: z.number(),
      state: z.literal("exists"),
      totalLines: z.number(),
      truncatedByBytes: z.boolean().default(false),
    }),
    z.object({
      base64Data: z.string(),
      filePath: z.string(),
      // Absent when the image could not be measured.
      height: z.number().optional(),
      mimeType: z.string(),
      modifiedAt: z.number(),
      // Set when a region was requested: the rectangle as interpreted, after
      // clamping, in the view's pixel space.
      region: RegionSchema.optional(),
      renderedHeight: z.number().optional(),
      renderedWidth: z.number().optional(),
      state: z.literal("image"),
      // The size this model renders the image at, which is smaller than the
      // file whenever the file is over the provider's budget.
      viewHeight: z.number().optional(),
      viewWidth: z.number().optional(),
      width: z.number().optional(),
    }),
    z.object({
      base64Data: z.string(),
      filePath: z.string(),
      mimeType: z.string(),
      modifiedAt: z.number(),
      state: z.literal("pdf"),
    }),
    z.object({
      base64Data: z.string(),
      filePath: z.string(),
      mimeType: z.string(),
      modifiedAt: z.number(),
      state: z.literal("audio"),
    }),
    z.object({
      base64Data: z.string(),
      filePath: z.string(),
      mimeType: z.string(),
      modifiedAt: z.number(),
      state: z.literal("video"),
    }),
    z.object({
      filePath: z.string(),
      state: z.literal("does-not-exist"),
      suggestions: z.array(z.string()),
    }),
    z.object({
      filePath: z.string(),
      mimeType: z.string().optional(),
      modifiedAt: z.number(),
      reason: z.enum([
        "binary-file",
        "image-too-large",
        "undecodable-image",
        "undecodable-media",
        "undecodable-pdf",
        "unsupported-image-format",
      ]),
      state: z.literal("unsupported-format"),
    }),
    z.object({
      entries: z.array(z.string()),
      filePath: z.string(),
      state: z.literal("is-directory"),
      truncated: z.boolean(),
    }),
  ]),
}).create({
  description: dedent`
    Reads a file from the task, including read-only folders the user attached (mounted under /mnt/<name>/). You can access any file directly by using this tool.

    Usage:
    - The ${INPUT_PARAMS.filePath} parameter must be a relative path to a file in the task, or an attached folder's read-only mount path (/mnt/<name>/...). E.g. ./${TASK_FOLDER_NAMES.attachments}/upload.txt
    - By default, it reads up to ${DEFAULT_READ_LIMIT} lines starting from the beginning of the file, and at most ${formatBytes(MAX_BYTES)} of content -- whichever limit is reached first. A long file therefore often stops well before ${DEFAULT_READ_LIMIT} lines; the output says where it stopped and which limit applied.
    - You can optionally specify a line ${INPUT_PARAMS.offset} and ${INPUT_PARAMS.limit} (especially handy for long files), but it's recommended to read the whole file by not providing these parameters.
    - When using ${INPUT_PARAMS.limit}, avoid using too small of a limit (< 100), which can lead to tons of tokens being used.
    - Any lines longer than ${MAX_LINE_LENGTH} characters will be truncated.
    - Results are returned using cat -n format, with line numbers starting at the ${INPUT_PARAMS.offset} or 1.
    - You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
    - If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
    - You can read images, PDFs, audio files, and video files by using this tool.
    - Reading an image tells you its pixel dimensions, and the smaller size you are shown it at when it is too large to render whole.
    - To read a detail that is too small to make out -- a chart label, a value in a dense table, which of two lines sits higher, text in a screenshot -- read the image again with ${INPUT_PARAMS.region} set to the corners of the area in question. It comes back cropped from the full-resolution file and magnified, so what was a few pixels becomes legible. Coordinates are always pixels in the whole image as you were first shown it, never pixels in a magnified crop you got back. To narrow further, give a smaller rectangle in those same whole-image coordinates; each response repeats the rectangle it used, so subdivide that. Trust what you read magnified over your first impression of the whole image.
  `,
  execute: async ({ input, signal, taskId, taskState }) => {
    const region = requestedRegion(input.region);
    const layout = buildWorkspaceFsLayout({
      attachedFolders: taskState.attachedFolders,
      taskHostRoot: taskDir(taskId),
    });
    const pathResult = resolveExistingFilePath({
      inputPath: input.filePath,
      layout,
    });

    if (pathResult.isErr()) {
      return err(pathResult.error);
    }

    const { absolutePath, displayPath } = pathResult.value;
    const exists = await pathExists(absolutePath);

    if (!exists) {
      const suggestions = await getSimilarPathSuggestions({
        absolutePath,
        displayPath,
      });

      return ok({
        filePath: displayPath,
        state: "does-not-exist" as const,
        suggestions,
      });
    }

    const stats = await fs.stat(absolutePath);
    if (stats.isDirectory()) {
      const { files: entries, truncated: dirTruncated } = await listFiles(
        absolutePath,
        {
          // The private dir is masked from the shell too, so listing it here
          // would advertise a path every read of it rejects.
          exclude:
            path.resolve(absolutePath) === path.resolve(taskDir(taskId))
              ? [TASK_FOLDER_NAMES.private]
              : undefined,
          hidden: true,
          limit: DIRECTORY_LISTING_LIMIT,
        },
      );

      return ok({
        entries,
        filePath: displayPath,
        state: "is-directory" as const,
        truncated: dirTruncated,
      });
    }

    if (region && !isReadableImage(getMimeType(absolutePath))) {
      return executeError(
        `${INPUT_PARAMS.region} only applies to images, and ${displayPath} is not one.`,
      );
    }

    const isBinary = await isBinaryFile(absolutePath);
    if (!isBinary) {
      const content = await fs.readFile(absolutePath, {
        encoding: "utf8",
        signal,
      });

      const normalized = content.replaceAll("\r\n", "\n");
      const lines = normalized.split("\n");

      let limit = input.limit ?? DEFAULT_READ_LIMIT;
      if (limit <= 0) {
        limit = DEFAULT_READ_LIMIT;
      }

      const offset = Math.max(1, input.offset ?? 1);
      const clampedOffset = Math.min(offset, Math.max(1, lines.length));

      let selectedLines = lines.slice(
        clampedOffset - 1,
        clampedOffset - 1 + limit,
      );
      let hasMoreLines =
        lines.length > clampedOffset - 1 + selectedLines.length;
      let truncatedByBytes = false;

      const processedLines = selectedLines.map((line) =>
        line.length > MAX_LINE_LENGTH
          ? truncateWithoutSplitting(line, MAX_LINE_LENGTH) + "..."
          : line,
      );

      let rawContent = processedLines.join("\n");

      if (Buffer.byteLength(rawContent, "utf8") > MAX_BYTES) {
        let trimmed = [...processedLines];
        while (
          trimmed.length > 0 &&
          Buffer.byteLength(trimmed.join("\n"), "utf8") > MAX_BYTES
        ) {
          trimmed = trimmed.slice(0, -1);
        }
        selectedLines = trimmed;
        rawContent = trimmed.join("\n");
        hasMoreLines = true;
        truncatedByBytes = true;
      }

      return ok({
        // A script that resolved an absolute path may have written the task
        // dir into the file; keep it out of the model context and the persisted
        // tool result. Task-dir only: a home path in file contents can be
        // legitimate, so redacting it risks mangling a path the agent edits.
        content: redactTaskDir(rawContent, taskDir(taskId)),
        displayedLines: selectedLines.length,
        filePath: displayPath,
        hasMoreLines,
        modifiedAt: stats.mtimeMs,
        offset: clampedOffset,
        state: "exists" as const,
        totalLines: lines.length,
        truncatedByBytes,
      });
    }

    const mimeType = getMimeType(absolutePath);

    if (isReadableImage(mimeType)) {
      return handleMediaFile({
        absolutePath,
        fixedPath: displayPath,
        mimeType,
        region,
        signal,
        state: "image",
      });
    }

    if (mimeType === "application/pdf") {
      return handleMediaFile({
        absolutePath,
        fixedPath: displayPath,
        mimeType,
        signal,
        state: "pdf",
      });
    }

    if (mimeType.startsWith("audio/")) {
      return handleMediaFile({
        absolutePath,
        fixedPath: displayPath,
        mimeType,
        signal,
        state: "audio",
      });
    }

    if (mimeType.startsWith("video/")) {
      return handleMediaFile({
        absolutePath,
        fixedPath: displayPath,
        mimeType,
        signal,
        state: "video",
      });
    }

    return ok({
      filePath: displayPath,
      mimeType,
      modifiedAt: stats.mtimeMs,
      reason: "binary-file" as const,
      state: "unsupported-format" as const,
    });
  },
  readOnly: true,
  timeoutMs: ms("15 seconds"),
  toModelOutput: ({ output }) => {
    if (output.state === "does-not-exist") {
      const suggestionText =
        output.suggestions.length > 0
          ? `\n\nDid you mean one of these?\n${output.suggestions.join("\n")}`
          : "";

      return {
        type: "error-text",
        value: `File ${output.filePath} does not exist${suggestionText}`,
      };
    }

    if (output.state === "is-directory") {
      const listing =
        output.entries.length > 0 ? output.entries.join("\n") : "(empty)";
      const truncationNote = output.truncated
        ? `\n\n(Results truncated: showing first ${DIRECTORY_LISTING_LIMIT} entries)`
        : "";
      return {
        type: "text",
        value: `${output.filePath} is a directory, not a file. Here are its contents:\n\n${listing}${truncationNote}`,
      };
    }

    if (output.state === "unsupported-format") {
      if (output.reason === "undecodable-image") {
        return {
          type: "error-text",
          value: [
            `Cannot decode ${output.filePath} as an image.`,
            "The file may be truncated or incomplete, or it may not be the format its name says it is.",
            `Check what it really is with \`${FFPROBE_COMMAND.name} -v error -show_format -show_streams -of json ${output.filePath}\`,`,
            "and convert it before reading.",
          ].join(" "),
        };
      }

      if (output.reason === "image-too-large") {
        return {
          type: "error-text",
          value: [
            `${output.filePath} declares more than ${MAX_DECODED_PIXELS / 1_000_000} megapixels, too large to decode.`,
            "Downscale it first, then read the smaller copy.",
          ].join(" "),
        };
      }

      if (output.reason === "undecodable-media") {
        const mimeInfo = output.mimeType ? ` (${output.mimeType})` : "";
        return {
          type: "error-text",
          value: [
            `Cannot decode ${output.filePath}${mimeInfo}.`,
            "The file may be truncated or incomplete, or it may not be the format its name says it is.",
            `Check what it really is with \`${FFPROBE_COMMAND.name} -v error -show_format -show_streams -of json ${output.filePath}\`,`,
            "and convert it before reading.",
          ].join(" "),
        };
      }

      if (output.reason === "undecodable-pdf") {
        return {
          type: "error-text",
          value: [
            `Cannot read ${output.filePath} as a PDF.`,
            "Its header or its end marker is missing, so it is truncated, incomplete, or not a PDF at all.",
            "Fetch it again or convert it before reading.",
          ].join(" "),
        };
      }

      if (output.reason === "unsupported-image-format") {
        const supportedFormatsText = SUPPORTED_IMAGE_FORMATS.map(
          (format) => `'${format}'`,
        ).join(", ");
        const mimeInfo = output.mimeType ? ` (${output.mimeType})` : "";
        return {
          type: "error-text",
          value: [
            `Unsupported image format: ${output.filePath}${mimeInfo}.`,
            `Input should be ${supportedFormatsText}.`,
            "Please convert the image to a supported format before reading.",
          ].join(" "),
        };
      }

      const mimeTypeInfo = output.mimeType
        ? ` (${output.mimeType})`
        : " with unknown MIME type";
      return {
        type: "error-text",
        value: [
          `Cannot read binary file${mimeTypeInfo}: ${output.filePath}.`,
          "Consider using command-line tools or scripts to extract or convert the file contents if needed.",
        ].join(" "),
      };
    }

    switch (output.state) {
      case "audio":
      case "image":
      case "pdf":
      case "video": {
        const config = MEDIA_CONFIG[output.state];

        const size = output.state === "image" ? describeImageSize(output) : "";

        return {
          type: "content",
          value: [
            {
              text: `${config.label} file: ${output.filePath}${size}.`,
              type: "text",
            },
            {
              data: output.base64Data,
              mediaType: output.mimeType,
              type: "media",
            },
          ],
        };
      }
    }

    if (output.content === "") {
      // Without this an empty file renders as a single blank numbered line,
      // which is indistinguishable from a file holding one empty line.
      return {
        type: "text",
        value: systemNote`File ${output.filePath} exists but is empty.`.trim(),
      };
    }

    const offset = output.offset;
    const endLine = offset + output.displayedLines - 1;
    const remainingLines = output.totalLines - endLine;

    const numberedContent = addLineNumbers(output.content, offset - 1);

    const isPartial = offset > 1 || output.hasMoreLines;
    const header = isPartial
      ? `lines ${offset}-${endLine} (total ${output.totalLines} lines)`
      : "entire file";

    const hiddenBefore = offset - 1;

    let contentBody = "";
    if (hiddenBefore > 0) {
      contentBody += `... ${hiddenBefore} lines not shown ...\n`;
    }
    contentBody += numberedContent;
    if (output.truncatedByBytes && remainingLines > 0) {
      contentBody += `\n... ${remainingLines} lines not shown (output capped at 50KB) ...\n\n(Use ${INPUT_PARAMS.offset} parameter to read beyond line ${endLine})`;
    } else if (output.hasMoreLines && remainingLines > 0) {
      contentBody += `\n... ${remainingLines} lines not shown ...\n\n(Use ${INPUT_PARAMS.offset} parameter to read beyond line ${endLine + 1})`;
    }

    const result = `<path>${output.filePath}</path>\n<content${isPartial ? ` lines="${header}"` : ""}>\n${contentBody}\n</content>`;

    return {
      type: "text",
      value: result,
    };
  },
});
