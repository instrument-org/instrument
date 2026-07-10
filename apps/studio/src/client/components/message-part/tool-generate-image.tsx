import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import {
  ArrowsOutSimpleIcon,
  ChatIcon,
  CopyIcon,
  ImagesIcon,
  QuotesIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect, useState } from "react";

import { appendToPromptAtom } from "../../atoms/prompt-value";
import { copyFileToClipboard } from "../../lib/file-actions";
import { getAssetUrl } from "../../lib/get-asset-url";
import { filenameFromFilePath } from "../../lib/path-utils";
import { cn } from "../../lib/utils";
import { AIProviderIcon } from "../ai-provider-icon";
import { isActiveToolPart } from "../chat-stream-utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { FileIcon } from "../file-icon";
import { IconButton } from "../icon-button";
import { ImageWithFallback } from "../image-with-fallback";
import { useCurrentTaskFile } from "../task/current-task-files";
import { ToolCapabilityFailure } from "./tool-capability-failure";
import {
  ToolCard,
  ToolCardHeader,
  ToolCardSection,
  ToolChip,
} from "./tool-card";

type GenerateImagePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-generate_image" }
>;

export function SourceImagesChip({
  assetBaseUrl,
  isEmphasized,
  part,
}: {
  assetBaseUrl: string;
  isEmphasized: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  if (part.type !== "tool-generate_image") {
    return null;
  }

  // Once generation succeeds the output carries `modifiedAt` for cache-busting.
  // While streaming we only have the input paths, so render those (no version)
  // so the references show up on the right immediately.
  const sourceImages: { filePath: string; modifiedAt?: number }[] =
    part.state === "output-available" && part.output.state === "success"
      ? // `sourceImages` was added after initial release; old persisted outputs lack it
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        (part.output.sourceImages ?? [])
      : Array.isArray(part.input?.sourceImages)
        ? part.input.sourceImages.flatMap((p) =>
            typeof p === "string" && p.length > 0 ? [{ filePath: p }] : [],
          )
        : [];

  if (sourceImages.length === 0) {
    return null;
  }

  return (
    <ToolChip className="gap-0 px-1" isEmphasized={isEmphasized}>
      {sourceImages.slice(0, 3).map((file, index) => {
        const src = getAssetUrl({
          assetBase: assetBaseUrl,
          filePath: file.filePath,
          version: file.modifiedAt,
        });
        return (
          <ImageWithFallback
            alt="Reference"
            className="-ml-0.5 size-4 rounded-full border border-border/50 object-cover first:ml-0"
            fallback={
              <span className="-ml-0.5 flex size-4 items-center justify-center rounded-full border border-border/50 bg-muted first:ml-0">
                <ImagesIcon className="size-2.5 text-muted-foreground/50" />
              </span>
            }
            filename={filenameFromFilePath(file.filePath)}
            key={index}
            src={src}
          />
        );
      })}
      {sourceImages.length > 3 && (
        <span className="ml-1 text-xs text-foreground/40">
          +{sourceImages.length - 3}
        </span>
      )}
    </ToolChip>
  );
}

export function ToolGenerateImage({
  assetBaseUrl,
  id,
  onRetry,
  part,
}: {
  assetBaseUrl: string;
  id: TaskId;
  onRetry: (prompt: string) => void;
  part: GenerateImagePart;
}) {
  const navigate = useNavigate({ from: "/tasks/$id/" });

  if (!part.input) {
    return null;
  }

  const successOutput =
    part.state === "output-available" && part.output.state === "success"
      ? part.output
      : null;
  const failureOutput =
    part.state === "output-available" && part.output.state === "failure"
      ? part.output
      : null;
  const sourceImageFiles = successOutput?.sourceImages ?? [];

  const primaryFilePath =
    successOutput?.images[0]?.filePath ?? part.input.filePath;
  const primaryModifiedAt = successOutput?.images[0]?.modifiedAt;
  const filename = filenameFromFilePath(primaryFilePath ?? "");
  const prompt = typeof part.input.prompt === "string" ? part.input.prompt : "";

  // While the tool is still running (or yielding preliminary partial frames),
  // show a filling preview square instead of the final image render.
  const isGenerating = isActiveToolPart(part);
  const previewImage = successOutput?.images[0];
  // Prefer the parameters actually applied (unsupported ones dropped); fall back
  // to the requested input before the first output arrives or for old outputs.
  const parameterTags = extractParameterTags(
    successOutput?.appliedParameters ?? part.input.parameters,
  );
  const modelName = resolveImageModelName(successOutput?.modelId);
  const modelProviderType = successOutput?.provider.type;

  const openInPanel = ({
    filePath,
    modifiedAt,
  }: {
    filePath: string;
    modifiedAt: number;
  }) => {
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: { filePath, modifiedAt, type: "file" as const },
      }),
    });
  };

  return (
    <ToolCard>
      <ToolCardHeader className="flex items-center justify-between">
        {failureOutput ? (
          <p className="text-xs font-medium text-muted-foreground">
            Image generation unavailable
          </p>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <FileIcon
              className="size-3 shrink-0 text-muted-foreground"
              filename={filename}
            />
            <span className="truncate text-xs font-medium text-muted-foreground">
              {filename}
            </span>
          </div>
        )}

        {successOutput &&
          !isGenerating &&
          primaryFilePath &&
          primaryModifiedAt !== undefined && (
            <ImageActions
              filePath={primaryFilePath}
              id={id}
              modifiedAt={primaryModifiedAt}
            />
          )}
      </ToolCardHeader>

      {isGenerating ? (
        <StreamingImagePreview
          assetBaseUrl={assetBaseUrl}
          image={previewImage}
        />
      ) : (
        successOutput?.images.map((image, index) => (
          <GeneratedImage
            assetBaseUrl={assetBaseUrl}
            filePath={image.filePath}
            key={index}
            maxHeight="max-h-80"
            modifiedAt={image.modifiedAt}
            onOpen={openInPanel}
          />
        ))
      )}

      {!failureOutput && (
        <ToolCardSection maxHeight="max-h-32">
          {(modelName || parameterTags.length > 0) && (
            <div className="mb-2 flex flex-wrap gap-1">
              {modelName && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  {modelProviderType && (
                    <AIProviderIcon
                      className="size-3 shrink-0 opacity-70"
                      displayName={successOutput.provider.displayName}
                      showTooltip
                      type={modelProviderType}
                    />
                  )}
                  <span className="font-medium text-foreground/80">
                    {modelName}
                  </span>
                </span>
              )}
              {parameterTags.map(({ label, value }) => (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                  key={label}
                >
                  <span className="text-muted-foreground/60">{label}</span>
                  <span className="font-medium text-foreground/80">
                    {value}
                  </span>
                </span>
              ))}
            </div>
          )}
          {sourceImageFiles.length > 0 ? (
            <div className="flex items-start gap-3">
              <div className="shrink-0">
                <div
                  className={cn(
                    "grid gap-1",
                    sourceImageFiles.length > 1 ? "grid-cols-2" : "grid-cols-1",
                  )}
                >
                  {sourceImageFiles.slice(0, 4).map((file, index) => (
                    <GeneratedImage
                      assetBaseUrl={assetBaseUrl}
                      filePath={file.filePath}
                      key={index}
                      maxHeight="max-h-14"
                      modifiedAt={file.modifiedAt}
                      onOpen={openInPanel}
                      thumbnail
                    />
                  ))}
                </div>
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  Reference
                </p>
              </div>
              <PromptText prompt={prompt} />
            </div>
          ) : (
            <PromptText prompt={prompt} />
          )}
        </ToolCardSection>
      )}

      {failureOutput && (
        <ToolCapabilityFailure
          capabilityLabel="image generation"
          errorMessage={failureOutput.errorMessage}
          onRetry={onRetry}
          providerGuardDescription={
            failureOutput.errorType === "no-image-model"
              ? `Sign up for ${APP_NAME} or add an AI provider that supports image generation.`
              : undefined
          }
          responseBody={failureOutput.responseBody}
          retryMessage={`I added an image generation provider. Retry generating an image with "${prompt}"`}
        />
      )}
    </ToolCard>
  );
}

function extractParameterTags(
  parameters: unknown,
): { label: string; value: string }[] {
  if (
    parameters === null ||
    typeof parameters !== "object" ||
    Array.isArray(parameters)
  ) {
    return [];
  }
  return Object.entries(parameters).flatMap(([key, value]) =>
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? [{ label: humanizeParamKey(key), value: String(value) }]
      : [],
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function GeneratedImage({
  assetBaseUrl,
  filePath,
  maxHeight = "",
  modifiedAt,
  onOpen,
  thumbnail = false,
}: {
  assetBaseUrl: string;
  filePath: string;
  maxHeight?: string;
  modifiedAt: number;
  onOpen: (file: { filePath: string; modifiedAt: number }) => void;
  thumbnail?: boolean;
}) {
  const filename = filenameFromFilePath(filePath);
  const currentFile = useCurrentTaskFile(filePath);
  const src = getAssetUrl({
    assetBase: assetBaseUrl,
    filePath,
    version: currentFile?.modifiedAt ?? modifiedAt,
  });

  const handleClick = () => {
    onOpen({ filePath, modifiedAt });
  };

  return (
    <button
      className={cn(
        "relative cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        thumbnail ? "block rounded-md" : "block w-full",
      )}
      onClick={handleClick}
      type="button"
    >
      <ImageWithFallback
        alt={filename}
        className={cn(
          maxHeight,
          thumbnail ? "w-auto rounded-md" : "w-full",
          "object-contain",
        )}
        fallback={
          thumbnail ? (
            <div className="flex size-16 items-center justify-center rounded-md border border-border bg-muted">
              <ImagesIcon className="size-5 text-muted-foreground/50" />
            </div>
          ) : (
            <div className="flex h-32 w-full flex-col items-center justify-center gap-2 border-y border-border bg-muted">
              <ImagesIcon className="size-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Image not available
              </p>
            </div>
          )
        }
        filename={filename}
        src={src}
      />
    </button>
  );
}

function GeneratingPill() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);

  return (
    <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-medium ring-1 ring-border/50 backdrop-blur-sm">
      <span className="shiny-text">Generating</span>
      {/* Reassure the user it isn't frozen once it's been a few seconds. */}
      {elapsedMs >= 3000 && (
        <span className="text-[10px] text-muted-foreground/70 tabular-nums">
          {formatElapsed(elapsedMs)}
        </span>
      )}
    </span>
  );
}

function humanizeParamKey(key: string): string {
  const spaced = key
    .replaceAll("_", " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced.length > 0
    ? spaced.charAt(0).toUpperCase() + spaced.slice(1)
    : key;
}

function ImageActions({
  filePath,
  id,
  modifiedAt,
}: {
  filePath: string;
  id: TaskId;
  modifiedAt: number;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const navigate = useNavigate({ from: "/tasks/$id/" });

  const handleAddToChat = () => {
    appendToPrompt({ key: { scope: "task", taskId: id }, update: filePath });
  };

  const handleExpand = () => {
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: { filePath, modifiedAt, type: "file" as const },
      }),
    });
  };

  const handleCopy = async () => {
    await copyFileToClipboard({ filePath, id, isImage: true });
  };

  return (
    <div className="flex shrink-0 items-center gap-3">
      <IconButton
        className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
        icon={ChatIcon}
        onClick={handleAddToChat}
        tooltip="Add to chat"
        variant="ghost"
      />
      <IconButton
        className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
        icon={ArrowsOutSimpleIcon}
        onClick={handleExpand}
        tooltip="Open in panel"
        variant="ghost"
      />
      <ConfirmedIconButton
        className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
        icon={CopyIcon}
        onClick={handleCopy}
        successTooltip="Copied!"
        tooltip="Copy image"
        variant="ghost"
      />
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex size-full animate-pulse items-center justify-center bg-muted">
      <ImagesIcon className="size-6 text-muted-foreground/40" />
    </div>
  );
}

// A quiet quote glyph marks the text as the generation prompt without a
// technical label.
function PromptText({ prompt }: { prompt: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <QuotesIcon
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40"
        weight="fill"
      />
      <p className="text-sm text-muted-foreground">{prompt}</p>
    </div>
  );
}

// Our auto model persists its raw id; show its friendly name. Other providers'
// ids are already meaningful once the provider prefix is dropped.
function resolveImageModelName(
  modelId: string | undefined,
): string | undefined {
  if (!modelId) {
    return undefined;
  }
  if (modelId === OUR_MODELS.image.id) {
    return OUR_MODELS.image.name;
  }
  return modelId.split("/").at(-1) ?? modelId;
}

function StreamingImagePreview({
  assetBaseUrl,
  image,
}: {
  assetBaseUrl: string;
  image?: { filePath: string; modifiedAt: number };
}) {
  return (
    // Fixed height reserved for the whole stream so a frame landing over the
    // skeleton doesn't shift the card; matches the finalized image's max height.
    <div className="relative h-80 w-full overflow-hidden">
      {image ? (
        <ImageWithFallback
          alt="Generating preview"
          className="size-full object-contain"
          fallback={<PreviewSkeleton />}
          filename={filenameFromFilePath(image.filePath)}
          src={getAssetUrl({
            assetBase: assetBaseUrl,
            filePath: image.filePath,
            version: image.modifiedAt,
          })}
        />
      ) : (
        <PreviewSkeleton />
      )}

      {/* Faint edge glow that breathes to signal generation is still active,
          without motion competing with the streaming preview itself. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 animate-pulse"
        style={{
          boxShadow:
            "inset 0 0 26px -4px color-mix(in srgb, var(--ring) 60%, transparent)",
        }}
      />

      <GeneratingPill />
    </div>
  );
}
