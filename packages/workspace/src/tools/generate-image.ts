import { imageSize } from "image-size";
import mime from "mime-types";
import ms from "ms";
import { err, ok, Result } from "neverthrow";
import path from "node:path";
import { dedent } from "radashi";
import { z } from "zod";

import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { APP_NAME, PlanRefusalSchema } from "@instrument-org/shared";

import { TOOL_EXPLANATION_PARAM_NAME } from "../constants";
import { waitForSignIn } from "../lib/chat/sign-in-wake";
import { executeError } from "../lib/execute-error";
import { formatBytes } from "../lib/format-bytes";
import { generateImageStream } from "../lib/generate-images";
import { normalizePath } from "../lib/normalize-path";
import { prepareSourceImage } from "../lib/prepare-source-image";
import { isMissing, sessionToolFs } from "../lib/tool-fs";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { getWorkspaceServerURL } from "../logic/server/url";
import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { ProviderOutputSchema, UsageOutputSchema } from "./base";
import {
  CapabilityFailure,
  defineCapability,
} from "../lib/capabilities/define";
import { modelTool, recordedResult } from "../lib/capabilities/tool";

const INPUT_PARAMS = {
  filePath: "filePath",
  parameters: "parameters",
  prompt: "prompt",
  sourceImages: "sourceImages",
} as const;

const GeneratedImageFileSchema = z.object({
  // Relative to the chat's work folder, or the absolute path in a writable
  // folder, as the file tools name what they write.
  filePath: z.string(),
  modifiedAt: z.number(),
});

// Base64 image frames are large; coalesce progressive writes to at most one per
// interval. The final frame is always written regardless.
const PARTIAL_THROTTLE_MS = 400;

const SourceImageFileSchema = z.object({
  // Relative to the chat's folder, or an absolute path in another folder; those cannot be
  // served by the task asset server, so the UI falls back to a name-only chip
  // for them.
  filePath: z.string(),
  modifiedAt: z.number(),
});

export const generateImageCapability = defineCapability({
  input: z.object({
    [INPUT_PARAMS.filePath]: z.string().meta({
      description: `Path with filename but WITHOUT extension, relative to your work folder (e.g. ./poster/image-name) or the full path in a folder you may write to; the extension is added automatically. An image already at that path is replaced. Generate after ${TOOL_EXPLANATION_PARAM_NAME}.`,
    }),
    [INPUT_PARAMS.parameters]: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .meta({
        description:
          "Optional model-specific image parameters (e.g. quality, aspect ratio). Your system information lists which parameters and values the selected image model supports, and a later note says when they change; unsupported entries are ignored.",
      }),
    [INPUT_PARAMS.prompt]: z.string().meta({
      description: "Detailed description of the image to generate",
    }),
    [INPUT_PARAMS.sourceImages]: z.array(z.string()).optional().meta({
      description: `Images the picture is made from, each a path relative to your work folder or the full path of an image in one of the user's folders: a picture to change, things to put in it, a style to follow.`,
    }),
  }),
  name: "images.generate",
  output: z.object({
    images: z.array(
      z.object({
        height: z.number().optional(),
        /** Relative to the work folder, or the full path in a folder of the user's. */
        path: z.string(),
        size_bytes: z.number(),
        width: z.number().optional(),
      }),
    ),
    model: z.string(),
  }),
  async run(input, ctx) {
    const last = await recordedResult(
      imageFrames({
        chatId: ctx.chatId,
        input,
        model: await ctx.callingModel(),
        sessionId: ctx.sessionId,
        signal: ctx.signal ?? new AbortController().signal,
      }),
    );
    if (last === undefined) {
      throw new CapabilityFailure("The image was cancelled.");
    }
    if (last.isErr()) {
      throw new CapabilityFailure(last.error.message);
    }
    const output = last.value;
    if (output.state === "failure") {
      throw new CapabilityFailure(failureForModel(output));
    }
    return {
      images: output.images.map(({ filePath, height, sizeBytes, width }) => ({
        ...(height === undefined ? {} : { height }),
        path: filePath,
        size_bytes: sizeBytes,
        ...(width === undefined ? {} : { width }),
      })),
      model: output.modelId,
    };
  },
  summary: "Makes an image with an AI image model and saves it.",
  surfaces: {
    script: { positional: [INPUT_PARAMS.prompt] },
    tool: {
      description: dedent`
    Makes or changes a picture with an AI image model. A call takes from tens of seconds to a few minutes.

    Use it for a picture that has to look like something: a photo, a scene, an illustration, art, a product shot, or a change to a photo the user has (things added to it or put inside it, another style, color or light). A request for a picture is enough, worded however the user words it; they do not have to say "AI".

    Draw with code when the result is exact, not pictured: a chart or plot from data, a diagram, a wireframe, a layout to given sizes, text set on an image, a resize, crop or format change, an SVG or HTML asset. A picture passed in comes back redrawn, never copied: its pixels, lines and lettering shift. When the result has to keep a picture exact (pixel art on its grid, a sprite's frames, a logo), change it with code.

    Pasting cut-outs onto a photo with code gives a flat collage. When the user wants things in a photo's scene (in, on, behind or spilling out of something there), use this tool. When they call a picture you drew with code flat, fake or pasted on, make the next one with this tool; do not refine the script.

    Pass every image the user gave for the picture in ${INPUT_PARAMS.sourceImages}: the photo to change, the logos or icons that go in it, a style to follow. Say in the ${INPUT_PARAMS.prompt} what each one is for, and do not describe an image you could pass.

    To change a picture the user has (another color, a different light, something added), pass it in ${INPUT_PARAMS.sourceImages} and write the result back to its own path: the reply keeps the earlier one, so the user can undo the change or go back to it. Save a new name only when they ask for another picture beside it.

    The ${INPUT_PARAMS.parameters} the selected image model takes (its size, quality and the like) are in your system information, or in the latest note that changed them.
  `,
      execute: ({ chatId, input, model, partId, sessionId, signal }) =>
        imageFrames({ chatId, input, model, partId, sessionId, signal }),
      readOnly: false,
      // Image generation (esp. high-quality gpt-image-2.5) can run for several
      // minutes; streaming previews keep the user informed while it works.
      timeoutMs: () => ms("5 minutes"),
      toModelOutput: ({ input, output }) => {
        if (output.state === "failure") {
          return {
            type: "error-text",
            value: failureForModel(output),
          };
        }

        const imageCount = output.images.length;

        if (imageCount === 0) {
          return {
            type: "error-text",
            value: "No images were generated",
          };
        }

        const imageList = output.images
          .map((image) => {
            const size = formatBytes(image.sizeBytes);
            const dimensions =
              image.width && image.height
                ? ` ${image.width}x${image.height}`
                : "";
            return `${image.filePath} ${size}${dimensions}`;
          })
          .join("\n");

        const summary =
          imageCount === 1
            ? `Successfully generated image and saved to ${imageList}`
            : `Successfully generated ${imageCount} images:\n${imageList}`;

        const droppedNote = unsupportedParametersNote(
          input.parameters,
          output.appliedParameters,
        );

        return {
          type: "text",
          value: droppedNote ? `${summary}\n\n${droppedNote}` : summary,
        };
      },
      name: "generate_image",
      output: z.discriminatedUnion("state", [
        z.object({
          // Parameters actually forwarded to the model (unsupported ones dropped).
          appliedParameters: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
            .optional(),
          images: z.array(
            GeneratedImageFileSchema.extend({
              height: z.number().optional(),
              sizeBytes: z.number(),
              width: z.number().optional(),
            }),
          ),
          modelId: z.string(),
          // Present only when the provider served a different model, which is what
          // our image alias does on every call.
          modelIdServed: z.string().optional(),
          // The quality the image was generated at, when it is known.
          quality: z.string().optional(),
          provider: ProviderOutputSchema,
          sourceImages: z.array(SourceImageFileSchema),
          state: z.literal("success"),
          usage: UsageOutputSchema,
        }),
        z.object({
          errorMessage: z.string(),
          // `no-image-model`: nothing connected makes images, and no Instrument
          // account is signed in. `refused`: Instrument's platform turned the
          // image away for the account's plan, as `refusal` says.
          errorType: z.enum([
            "api-call",
            "no-image-model",
            "provider-limitation",
            "refused",
          ]),
          refusal: PlanRefusalSchema.optional(),
          responseBody: z.string().optional(),
          state: z.literal("failure"),
        }),
      ]),
    },
  },
  text: ({ images }) => images.map((image) => image.path).join("\n"),
});

export const GenerateImage = modelTool(generateImageCapability);

/**
 * One generation as the tool records it, a frame at a time as the model
 * streams them, each written over the last: the images and what made them,
 * or why there are none.
 */
async function* imageFrames({
  chatId,
  input,
  model,
  partId,
  sessionId,
  signal,
}: {
  chatId: ChatId;
  input: {
    filePath: string;
    parameters?: Record<string, boolean | number | string>;
    prompt: string;
    sourceImages?: string[];
  };
  model: AIGatewayModel.Type;
  /** The tool call, where a call made it; a script's call has none. */
  partId?: StoreId.Part;
  sessionId: StoreId.Session;
  signal: AbortSignal;
}) {
  const files = await sessionToolFs({ chatId, partId, sessionId });
  const typed = files.resolve(input.filePath);
  if (typed.isErr()) {
    yield err(typed.error);
    return;
  }
  // Strip extension if mistakenly provided
  const parsedPath = path.posix.parse(typed.value);

  // A folder the rules keep closed refuses here, before the model is paid
  // for, with the note that says what to ask for.
  try {
    await files.fs.mkdir(parsedPath.dir, { recursive: true });
  } catch (error) {
    yield await files.failure(error, parsedPath.dir);
    return;
  }

  const pathWithoutExt = path.posix.join(parsedPath.dir, parsedPath.name);

  let sourceImageBuffers: Buffer[] | undefined;
  const sourceImages: z.output<typeof SourceImageFileSchema>[] = [];
  if (input.sourceImages && input.sourceImages.length > 0) {
    const resolvedSources = [];
    for (const inputPath of input.sourceImages) {
      // Sources are read like read_file reads, through the shell's
      // filesystem.
      const typedSource = files.resolve(inputPath);
      if (typedSource.isErr()) {
        yield err(typedSource.error);
        return;
      }
      const source = await files.existing(typedSource.value);
      const displayPath = files.shown(source);
      let bytes: Uint8Array;
      try {
        bytes = await files.fs.readFileBuffer(source);
      } catch (error) {
        yield isMissing(error)
          ? executeError(`Source image not found: ${displayPath}`)
          : await files.failure(error, source);
        return;
      }
      resolvedSources.push({ bytes: Buffer.from(bytes), displayPath });
      const stats = await files.fs.stat(source);
      sourceImages.push({
        filePath: displayPath,
        modifiedAt: stats.mtime.getTime(),
      });
    }
    // A file the model cannot decode is worth catching here rather than in
    // the provider's reply, which names the offending image by position and
    // arrives a whole request later.
    const prepared = Result.combine(
      await Promise.all(
        resolvedSources.map(({ bytes, displayPath }) =>
          prepareSourceImage({ bytes, displayPath, signal }),
        ),
      ),
    );
    if (prepared.isErr()) {
      yield executeError(prepared.error);
      return;
    }
    sourceImageBuffers = prepared.value;
  }

  // Each frame overwrites the same path so the UI preview fills in place.
  const writeFrame = (frameImages: { base64: string; mediaType: string }[]) =>
    Promise.all(
      frameImages.map(async (image, index) => {
        const mimeExt = mime.extension(image.mediaType);
        // Fall back to png because most image models default to it
        const ext = typeof mimeExt === "string" ? mimeExt : "png";

        // Create unique filename for multiple images
        const filename =
          frameImages.length > 1
            ? `${pathWithoutExt}-${index + 1}.${ext}`
            : `${pathWithoutExt}.${ext}`;

        const imageBuffer = Buffer.from(image.base64, "base64");

        await files.fs.writeFile(filename, imageBuffer);
        const stats = await files.fs.stat(filename);

        // Try to get image dimensions, but don't fail if it doesn't work
        let dimensions: { height?: number; width?: number } = {};
        try {
          const size = imageSize(imageBuffer);
          dimensions = {
            height: size.height,
            width: size.width,
          };
        } catch {
          // Ignore failed image size calculation
        }

        return {
          filePath: normalizePath(files.shown(filename)),
          ...dimensions,
          modifiedAt: stats.mtime.getTime(),
          sizeBytes: imageBuffer.length,
        };
      }),
    );

  let lastPartialWriteMs = 0;

  for await (const chunk of generateImageStream({
    callingModel: model,
    configs: getWorkspaceConfig().getAIProviderConfigs(),
    count: 1,
    parameters: input.parameters,
    prompt: input.prompt,
    sessionId,
    signal,
    sourceImages: sourceImageBuffers,
    chatId,
    workspaceConfig: getWorkspaceConfig(),
    workspaceServerURL: getWorkspaceServerURL(),
  })) {
    if (chunk.isErr()) {
      const generateError = chunk.error;

      switch (generateError.type) {
        case "workspace-no-image-provider-error": {
          waitForSignIn(chatId, sessionId);
          yield ok({
            errorMessage: `Making images needs a free ${APP_NAME} account.`,
            errorType: "no-image-model" as const,
            state: "failure" as const,
          });
          return;
        }
        case "workspace-image-refused-error": {
          const { refusal } = generateError;
          yield ok({
            errorMessage:
              refusal.code === "usage-limit-exceeded"
                ? `Your ${APP_NAME} usage has run out for now.`
                : `Your ${APP_NAME} account needs a plan to make images.`,
            errorType: "refused" as const,
            refusal,
            state: "failure" as const,
          });
          return;
        }
        case "workspace-api-call-error": {
          yield ok({
            errorMessage: generateError.message,
            errorType: "api-call" as const,
            responseBody: generateError.responseBody,
            state: "failure" as const,
          });
          return;
        }
        case "workspace-provider-limitation-error": {
          yield ok({
            errorMessage: generateError.message,
            errorType: "provider-limitation" as const,
            state: "failure" as const,
          });
          return;
        }
        default: {
          generateError satisfies never;
          yield executeError(JSON.stringify(generateError));
          return;
        }
      }
    }

    const {
      appliedParameters,
      config,
      images,
      kind,
      modelId,
      modelIdServed,
      quality,
      usage,
    } = chunk.value;

    if (kind === "partial") {
      const now = Date.now();
      if (now - lastPartialWriteMs < PARTIAL_THROTTLE_MS) {
        continue;
      }
      lastPartialWriteMs = now;
    }

    const writtenImages = await writeFrame(images);

    yield ok({
      appliedParameters,
      images: writtenImages,
      modelId,
      modelIdServed,
      ...(quality && { quality }),
      provider: {
        displayName: config.displayName,
        id: config.id,
        type: config.type,
      },
      sourceImages,
      state: "success" as const,
      usage: {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
      },
    });
  }
}

/**
 * What the agent is told of a failure. Where the person has something to do
 * (sign in, or deal with their plan), a note above their message box shows
 * them, so the agent says one line and leaves the image for now.
 */
function failureForModel(output: {
  errorMessage: string;
  errorType: "api-call" | "no-image-model" | "provider-limitation" | "refused";
  refusal?: { code: string };
}) {
  switch (output.errorType) {
    case "no-image-model": {
      return `Nothing connected here makes images. The person sees a note above their message box offering a free ${APP_NAME} account, which makes images in any chat. Say so in one plain sentence and leave the image for now: when they sign in, you are woken to make it.`;
    }
    case "refused": {
      const why =
        output.refusal?.code === "usage-limit-exceeded"
          ? `their ${APP_NAME} usage has run out for now`
          : `their ${APP_NAME} account has no plan that covers it`;
      return `${APP_NAME} turned the image away: ${why}. The person sees a note above their message box with what they can do. Say so in one plain sentence and leave the image for now.`;
    }
    default: {
      return output.errorMessage;
    }
  }
}

// Tells the agent which requested parameters the selected model ignored, so it
// can adjust (e.g. steer dimensions through the prompt) on a retry.
function unsupportedParametersNote(
  requested: Record<string, boolean | number | string> | undefined,
  applied: Record<string, boolean | number | string> | undefined,
): string | undefined {
  if (!requested) {
    return undefined;
  }
  const appliedKeys = new Set(Object.keys(applied ?? {}));
  const dropped = Object.keys(requested).filter((key) => !appliedKeys.has(key));
  if (dropped.length === 0) {
    return undefined;
  }
  return `Note: these requested parameters were not applied by the selected model (unsupported or invalid value) and had no effect: ${dropped.join(", ")}. Describe those aspects in the prompt if they matter.`;
}
