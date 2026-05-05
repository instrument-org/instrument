import {
  type ProjectSubdomain,
  type SessionMessagePart,
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
import { getAssetUrl } from "../../lib/get-asset-url";
import { filenameFromFilePath } from "../../lib/path-utils";
import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { FileIcon } from "../file-icon";
import { ImageWithFallback } from "../image-with-fallback";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type GenerateImagePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-generate_image" }
>;

export function ToolGenerateImage({
  assetBaseUrl,
  part,
  subdomain,
}: {
  assetBaseUrl: string;
  part: GenerateImagePart;
  subdomain: ProjectSubdomain;
}) {
  const navigate = useNavigate({ from: "/projects/$subdomain" });

  if (!part.input) {
    return null;
  }

  const successOutput =
    part.state === "output-available" && part.output.state === "success"
      ? part.output
      : null;
  const sourceImages = (part.input.sourceImages ?? []).filter(
    Boolean,
  ) as string[];

  const primaryFilePath =
    successOutput?.images[0]?.filePath ?? part.input.filePath;
  const filename = filenameFromFilePath(primaryFilePath ?? "");

  const openInPanel = (filePath: string) => {
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: { filePath, type: "file" as const },
      }),
    });
  };

  return (
    <ToolCard>
      <ToolCardHeader className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon
            className="size-3 shrink-0 text-muted-foreground"
            filename={filename}
          />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {filename}
          </span>
        </div>

        {successOutput && primaryFilePath && (
          <ImageActions
            assetBaseUrl={assetBaseUrl}
            filePath={primaryFilePath}
            subdomain={subdomain}
          />
        )}
      </ToolCardHeader>

      <ToolCardSection maxHeight="max-h-[32rem]">
        {successOutput?.images.map((image, index) => (
          <div className="mb-3 flex items-center justify-center" key={index}>
            <GeneratedImage
              assetBaseUrl={assetBaseUrl}
              filePath={image.filePath}
              onOpen={openInPanel}
            />
          </div>
        ))}

        {sourceImages.length > 0 ? (
          <div className="mb-3 flex items-start gap-3">
            <div className="shrink-0">
              <div
                className={cn(
                  "grid gap-1",
                  sourceImages.length > 1 ? "grid-cols-2" : "grid-cols-1",
                )}
              >
                {sourceImages.slice(0, 4).map((filePath, index) => (
                  <GeneratedImage
                    assetBaseUrl={assetBaseUrl}
                    filePath={filePath}
                    key={index}
                    maxHeight="max-h-14"
                    onOpen={openInPanel}
                    thumbnail
                  />
                ))}
              </div>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                Reference
              </p>
            </div>
            <p className="text-sm text-muted-foreground">{part.input.prompt}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{part.input.prompt}</p>
        )}
      </ToolCardSection>
    </ToolCard>
  );
}

function GeneratedImage({
  assetBaseUrl,
  filePath,
  maxHeight = "max-h-96",
  onOpen,
  thumbnail = false,
}: {
  assetBaseUrl: string;
  filePath: string;
  maxHeight?: string;
  onOpen: (filePath: string) => void;
  thumbnail?: boolean;
}) {
  const filename = filenameFromFilePath(filePath);
  const src = getAssetUrl({ assetBase: assetBaseUrl, filePath });

  const handleClick = () => {
    onOpen(filePath);
  };

  return (
    <button
      className={cn(
        "block cursor-zoom-in rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        thumbnail ? "rounded-md" : "rounded-lg",
      )}
      onClick={handleClick}
      type="button"
    >
      <ImageWithFallback
        alt={filename}
        className={`${maxHeight} ${thumbnail ? "w-auto rounded-md" : "w-auto rounded-lg"} object-contain`}
        fallback={
          thumbnail ? (
            <div className="flex size-16 items-center justify-center rounded-md border border-border bg-muted">
              <ImagesIcon className="size-5 text-muted-foreground/50" />
            </div>
          ) : (
            <div className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted">
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

function ImageActions({
  assetBaseUrl,
  filePath,
  subdomain,
}: {
  assetBaseUrl: string;
  filePath: string;
  subdomain: ProjectSubdomain;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const navigate = useNavigate({ from: "/projects/$subdomain" });

  const handleAddToChat = () => {
    appendToPrompt({ key: subdomain, update: filePath });
  };

  const handleExpand = () => {
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: { filePath, type: "file" as const },
      }),
    });
  };

  const handleCopy = async () => {
    const src = getAssetUrl({ assetBase: assetBaseUrl, filePath });
    const response = await fetch(src);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  };

  return (
    <div className="flex shrink-0 items-center gap-3">
      <ConfirmedIconButton
        className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
        icon={ChatIcon}
        onClick={handleAddToChat}
        successTooltip="Added!"
        tooltip="Add to chat"
        variant="ghost"
      />
      <ConfirmedIconButton
        className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
        icon={ArrowsOutSimpleIcon}
        onClick={handleExpand}
        successTooltip="Opened!"
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
