import { imageParametersDescription } from "@instrument-org/ai-gateway";
import { imageSize } from "image-size";
import mime from "mime-types";
import ms from "ms";
import { err, ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { dedent } from "radashi";
import { z } from "zod";

import { TASK_FOLDER_NAMES, TOOL_EXPLANATION_PARAM_NAME } from "../constants";
import { absolutePathJoin } from "../lib/absolute-path-join";
import { executeError } from "../lib/execute-error";
import { findAvailableName } from "../lib/find-available-name";
import { formatBytes } from "../lib/format-bytes";
import { generateImageStream } from "../lib/generate-images";
import { normalizePath } from "../lib/normalize-path";
import { pathExists } from "../lib/path-exists";
import {
  resolveExistingFilePath,
  resolveWritableToolPath,
} from "../lib/resolve-agent-path";
import { taskDir } from "../lib/task-dir-utils";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { buildWorkspaceFsLayout } from "../lib/workspace-fs-layout";
import { writeFileWithDir } from "../lib/write-file-with-dir";
import { getWorkspaceServerURL } from "../logic/server/url";
import { RelativePathSchema } from "../schemas/paths";
import {
  BaseInputSchema,
  ProviderOutputSchema,
  UsageOutputSchema,
} from "./base";
import { setupTool } from "./create-tool";

const INPUT_PARAMS = {
  allowOverwrite: "allowOverwrite",
  filePath: "filePath",
  parameters: "parameters",
  prompt: "prompt",
  sourceImages: "sourceImages",
} as const;

const GeneratedImageFileSchema = z.object({
  filePath: RelativePathSchema,
  modifiedAt: z.number(),
});

// Base64 image frames are large; coalesce progressive writes to at most one per
// interval. The final frame is always written regardless.
const PARTIAL_THROTTLE_MS = 400;

const SourceImageFileSchema = z.object({
  // Task-relative, or an attached folder's mount path (/mnt/<name>/...); mount
  // paths cannot be served by the task asset server, so the UI falls back to a
  // name-only chip for them.
  filePath: z.string(),
  modifiedAt: z.number(),
});

export const GenerateImage = setupTool({
  inputSchema: BaseInputSchema.extend({
    [INPUT_PARAMS.allowOverwrite]: z
      .boolean()
      .optional()
      .meta({
        description: `Replace an existing file at ${INPUT_PARAMS.filePath} instead of saving under a new name. Only set when the user clearly wants to replace the earlier image in place.`,
      }),
    [INPUT_PARAMS.filePath]: z.string().meta({
      description: `Relative path with filename but WITHOUT extension (e.g. ./output/image-name); the extension is added automatically. For a revised or alternative image, prefer a fresh descriptive name; reusing an existing path saves under a new name (image-name-2) so earlier versions are kept. Generate after ${TOOL_EXPLANATION_PARAM_NAME}.`,
    }),
    [INPUT_PARAMS.parameters]: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .meta({
        description:
          "Optional model-specific image parameters (e.g. quality, aspect ratio). The tool description lists which parameters and values the currently selected image model supports; unsupported entries are ignored.",
      }),
    [INPUT_PARAMS.prompt]: z.string().meta({
      description: "Detailed description of the image to generate",
    }),
    [INPUT_PARAMS.sourceImages]: z.array(z.string()).optional().meta({
      description:
        "Paths to images used for image-to-image (img2img) conditioning: task-relative, or an attached folder's mount path (/mnt/<name>/...). Use when the user wants to edit, transform, or use an existing image as a visual reference or style source.",
    }),
  }),
  name: "generate_image",
  outputSchema: z.discriminatedUnion("state", [
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
      provider: ProviderOutputSchema,
      // The requested path was taken, so the image was saved under a new name.
      renamedToAvoidOverwrite: z.boolean(),
      sourceImages: z.array(SourceImageFileSchema),
      state: z.literal("success"),
      usage: UsageOutputSchema,
    }),
    z.object({
      errorMessage: z.string(),
      errorType: z.enum(["api-call", "no-image-model", "provider-limitation"]),
      responseBody: z.string().optional(),
      state: z.literal("failure"),
    }),
  ]),
}).create({
  // cspell:ignore img2img, inpainting
  description: ({ model }) => dedent`
    AI image synthesis and semantic image editing. This is not the general tool for creating image files.

    Calls a metered, nondeterministic external AI image model and can take tens of seconds to several minutes.

    Good for:
    - AI-generated illustrations, icons, concept art, and stylistic visuals
    - AI image editing: style transfer, inpainting, compositing, scene integration
    - Placing or integrating visual elements into a scene when it requires semantic image understanding (e.g., locating objects, natural blending)

    Bad for:
    - Data visualizations (charts, plots, dashboards) that can be generated by a script
    - Deterministic graphics, diagrams, wireframes, layouts, text overlays, and SVG/Canvas/HTML assets that can be generated or edited with code

    Only use when the user explicitly requests AI image generation/editing, or when the desired result depends on learned visual synthesis or semantic image understanding. Do not treat a request for a visual file, asset, icon, diagram, mockup, or image output as implicit permission to use this tool. If unsure, confirm first or default to deterministic file generation.

    IMPORTANT: When the user asks to create new images "based on", "using", or "from" existing images, always pass those images as ${INPUT_PARAMS.sourceImages} for img2img conditioning. Do not re-describe them from scratch in the ${INPUT_PARAMS.prompt} alone.

    ${imageParametersDescription({
      callingModel: model,
      configs: getWorkspaceConfig().getAIProviderConfigs(),
    })}
  `,
  async *execute({ input, model, signal, taskId, taskState }) {
    const layout = buildWorkspaceFsLayout({
      attachedFolders: taskState.attachedFolders,
      taskHostRoot: taskDir(taskId),
    });
    const filePathResult = resolveWritableToolPath({
      inputPath: input.filePath,
      layout,
    });
    if (filePathResult.isErr()) {
      yield err(filePathResult.error);
      return;
    }
    // Everything below resolves against the task directory and the tool's
    // output contract is a task-relative path, so a mount path would land in a
    // shadow tree inside the task rather than in the user's folder. Generate
    // into the task and move the result instead.
    if (filePathResult.value.mount) {
      yield executeError(
        `Images cannot be generated directly into "${filePathResult.value.displayPath}". ` +
          `Generate into the task (e.g. ${TASK_FOLDER_NAMES.output}/image.png), then move it there with the bash tool if it belongs in the folder.`,
      );
      return;
    }
    const { displayPath: fixedPath } = filePathResult.value;

    // Strip extension if mistakenly provided
    const parsedPath = path.parse(fixedPath);

    // Auto-version the path unless allowOverwrite is set, so iterating on the
    // same filePath doesn't clobber an earlier image. Resolved once before
    // streaming so this call's partial frames don't bump its own final frame.
    let pathWithoutExt = normalizePath(
      path.join(parsedPath.dir, parsedPath.name),
    );
    let renamedToAvoidOverwrite = false;
    if (!input.allowOverwrite) {
      const dirAbsolute = absolutePathJoin(taskDir(taskId), parsedPath.dir);
      // Match on name without extension: the output extension is model-derived,
      // so a prior foo.jpg must block a new foo.png.
      const existingNames = await readExistingBaseNames(dirAbsolute);
      const { name, renamed } = await findAvailableName({
        isTaken: (candidate) => existingNames.has(candidate),
        name: parsedPath.name,
      });
      renamedToAvoidOverwrite = renamed;
      pathWithoutExt = normalizePath(path.join(parsedPath.dir, name));
    }

    let sourceImageBuffers: Buffer[] | undefined;
    const sourceImages: z.output<typeof SourceImageFileSchema>[] = [];
    if (input.sourceImages && input.sourceImages.length > 0) {
      const resolvedSourcePaths = [];
      for (const inputPath of input.sourceImages) {
        // Sources are reads in our own process (not a native subprocess), so
        // they resolve like read_file: task paths or attached mounts, with
        // the same symlink containment.
        const pathResult = resolveExistingFilePath({ inputPath, layout });
        if (pathResult.isErr()) {
          yield err(pathResult.error);
          return;
        }
        const { absolutePath, displayPath } = pathResult.value;
        if (!(await pathExists(absolutePath))) {
          yield executeError(`Source image not found: ${displayPath}`);
          return;
        }
        resolvedSourcePaths.push(absolutePath);
        const stats = await fs.stat(absolutePath);
        sourceImages.push({
          filePath: displayPath,
          modifiedAt: stats.mtimeMs,
        });
      }
      sourceImageBuffers = await Promise.all(
        resolvedSourcePaths.map((p) => fs.readFile(p)),
      );
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

          const absolutePath = absolutePathJoin(taskDir(taskId), filename);
          const imageBuffer = Buffer.from(image.base64, "base64");

          await writeFileWithDir(absolutePath, imageBuffer, { signal });
          const stats = await fs.stat(absolutePath);

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
            filePath: RelativePathSchema.parse(filename),
            ...dimensions,
            modifiedAt: stats.mtimeMs,
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
      signal,
      sourceImages: sourceImageBuffers,
      workspaceConfig: getWorkspaceConfig(),
      workspaceServerURL: getWorkspaceServerURL(),
    })) {
      if (chunk.isErr()) {
        const generateError = chunk.error;

        switch (generateError.type) {
          case "gateway-not-found-error": {
            yield ok({
              errorMessage:
                "No AI provider with image generation capability is available.",
              errorType: "no-image-model" as const,
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

      const { appliedParameters, config, images, kind, modelId, usage } =
        chunk.value;

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
        provider: {
          displayName: config.displayName,
          id: config.id,
          type: config.type,
        },
        renamedToAvoidOverwrite,
        sourceImages,
        state: "success" as const,
        usage: {
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          totalTokens: usage?.totalTokens,
        },
      });
    }
  },
  readOnly: false,
  // Image generation (esp. high-quality gpt-image-2) can run for several
  // minutes; streaming previews keep the user informed while it works.
  timeoutMs: ms("5 minutes"),
  toModelOutput: ({ input, output }) => {
    if (output.state === "failure") {
      return {
        type: "error-text",
        value: output.errorMessage,
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
          image.width && image.height ? ` ${image.width}x${image.height}` : "";
        return `${image.filePath} ${size}${dimensions}`;
      })
      .join("\n");

    // State the outcome factually and terminally. Deliberately no "use
    // allowOverwrite to replace" call-to-action: that baited agents into a
    // retry loop trying to overwrite a path that was intentionally versioned.
    const keptEarlier = output.renamedToAvoidOverwrite
      ? ` (${input.filePath} already existed and was kept)`
      : "";
    const summary =
      imageCount === 1
        ? `Successfully generated image and saved to ${imageList}${keptEarlier}`
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
});

// Extension-less names of a directory's entries, for collision checks before
// the model-derived output extension is known. Empty if the dir is absent.
async function readExistingBaseNames(dir: string): Promise<Set<string>> {
  try {
    const entries = await fs.readdir(dir);
    return new Set(entries.map((entry) => path.parse(entry).name));
  } catch {
    return new Set();
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
