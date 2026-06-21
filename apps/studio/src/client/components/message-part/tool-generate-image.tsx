import { APP_NAME } from "@instrument-org/shared";
import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import {
  ArrowsOutSimpleIcon,
  ChatIcon,
  CopyIcon,
  ImagesIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import { appendToPromptAtom } from "../../atoms/prompt-value";
import { copyFileToClipboard } from "../../lib/file-actions";
import { getAssetUrl } from "../../lib/get-asset-url";
import { filenameFromFilePath } from "../../lib/path-utils";
import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { FileIcon } from "../file-icon";
import { IconButton } from "../icon-button";
import { ImageWithFallback } from "../image-with-fallback";
import { useCurrentProjectFile } from "../project/current-project-files";
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

  const sourceImages =
    part.state === "output-available" && part.output.state === "success"
      ? // `sourceImages` was added after initial release; old persisted outputs lack it
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        (part.output.sourceImages ?? [])
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
          <img
            alt="Reference"
            className="-ml-0.5 size-4 rounded-full border border-border/50 object-cover first:ml-0"
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
  onRetry,
  part,
  subdomain,
}: {
  assetBaseUrl: string;
  onRetry: (prompt: string) => void;
  part: GenerateImagePart;
  subdomain: TaskId;
}) {
  const navigate = useNavigate({ from: "/tasks/$id" });

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
          primaryFilePath &&
          primaryModifiedAt !== undefined && (
            <ImageActions
              filePath={primaryFilePath}
              modifiedAt={primaryModifiedAt}
              subdomain={subdomain}
            />
          )}
      </ToolCardHeader>

      {successOutput?.images.map((image, index) => (
        <GeneratedImage
          assetBaseUrl={assetBaseUrl}
          filePath={image.filePath}
          key={index}
          modifiedAt={image.modifiedAt}
          onOpen={openInPanel}
        />
      ))}

      {!failureOutput && (
        <ToolCardSection maxHeight="max-h-32">
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
              <p className="text-sm text-muted-foreground">{prompt}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{prompt}</p>
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
  const currentFile = useCurrentProjectFile(filePath);
  const isStale =
    currentFile !== undefined && currentFile.modifiedAt !== modifiedAt;
  const src = getAssetUrl({
    assetBase: assetBaseUrl,
    filePath,
    version: modifiedAt,
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
      {isStale && (
        <span className="absolute right-2 bottom-2 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-sm">
          Updated since this message
        </span>
      )}
    </button>
  );
}

function ImageActions({
  filePath,
  modifiedAt,
  subdomain,
}: {
  filePath: string;
  modifiedAt: number;
  subdomain: TaskId;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const navigate = useNavigate({ from: "/tasks/$id" });

  const handleAddToChat = () => {
    appendToPrompt({ key: subdomain, update: filePath });
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
    await copyFileToClipboard({ filePath, isImage: true, subdomain });
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
