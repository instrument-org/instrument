import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { type FileType, getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { tv } from "tailwind-variants";

import { FileIcon } from "./file-icon";
import { ImageWithFallback } from "./image-with-fallback";

// Which types are drawn as ruled lines standing in for text, rather than their
// file icon. Exhaustive so a new `FileType` has to choose: as a list of
// matches, `.csv` lost its lines the moment it stopped being reported as
// `code`. The rest are binary formats whose icon says more than fake text.
const HAS_LINE_THUMBNAIL: Record<FileType, boolean> = {
  archive: false,
  audio: false,
  code: true,
  csv: true,
  docx: false,
  html: false,
  image: false,
  iwork: false,
  jsonl: true,
  markdown: true,
  parquet: false,
  pdf: false,
  pptx: false,
  sqlite: false,
  text: true,
  unknown: false,
  video: false,
  xlsx: false,
};

const thumbnailIcon = tv({
  base: "size-4 shrink-0",
  compoundVariants: [
    {
      class: "text-sidebar-accent-foreground",
      isActive: true,
      variant: "sidebar",
    },
  ],
  defaultVariants: {
    isActive: false,
    variant: "sidebar",
  },
  variants: {
    isActive: {
      false: "text-muted-foreground",
      true: "text-foreground",
    },
    variant: {
      primary: "",
      sidebar: "",
    },
  },
});

export function FileThumbnail({
  file,
  isActive,
  variant = "sidebar",
}: {
  file: TaskFileViewerFile;
  isActive: boolean;
  variant?: "primary" | "sidebar";
}) {
  const kind = getFileType(file);

  if (kind === "image") {
    return (
      <ThumbnailFrame isActive={isActive} variant={variant}>
        <ImageWithFallback
          alt=""
          className="size-full object-contain"
          draggable={false}
          fallback={
            <div className="flex size-full items-center justify-center">
              <FileIcon
                className={thumbnailIcon({ isActive, variant })}
                filename={file.filename}
                mimeType={file.mimeType}
              />
            </div>
          }
          filename={file.filename}
          showCheckerboard
          src={file.url}
        />
      </ThumbnailFrame>
    );
  }

  if (HAS_LINE_THUMBNAIL[kind]) {
    return (
      <ThumbnailFrame
        className="flex flex-col p-1"
        isActive={isActive}
        variant={variant}
      >
        <div className="flex flex-1 flex-col justify-center gap-px">
          {[0.85, 0.72, 0.9, 0.55].map((w) => (
            <div
              className={cn(
                "h-px min-w-0 rounded-full bg-muted-foreground/20",
                isActive &&
                  variant === "sidebar" &&
                  "bg-sidebar-accent-foreground/35",
              )}
              key={w}
              style={{ width: `${w * 100}%` }}
            />
          ))}
        </div>
      </ThumbnailFrame>
    );
  }

  return (
    <ThumbnailFrame
      className="flex items-center justify-center"
      isActive={isActive}
      variant={variant}
    >
      <FileIcon
        className={thumbnailIcon({ isActive, variant })}
        filename={file.filename}
        mimeType={file.mimeType}
      />
    </ThumbnailFrame>
  );
}

function ThumbnailFrame({
  children,
  className,
  isActive,
  variant = "sidebar",
}: {
  children: React.ReactNode;
  className?: string;
  isActive?: boolean;
  variant?: "primary" | "sidebar";
}) {
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden shadow-xs",
        variant === "primary"
          ? "h-11.5 w-9 rounded-sm border border-black/5 bg-card dark:border-white/5 dark:bg-white/5"
          : "h-10 w-8 rounded-md border border-border bg-background shadow-sm",
        variant === "sidebar" &&
          isActive &&
          "border-sidebar-accent-foreground/20 bg-sidebar-accent-foreground/10",
        className,
      )}
    >
      {children}
    </div>
  );
}
