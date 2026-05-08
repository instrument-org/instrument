import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { tv } from "tailwind-variants";

import { FileIcon } from "./file-icon";
import { ImageWithFallback } from "./image-with-fallback";

const thumbnailIcon = tv({
  base: "size-4 shrink-0",
  compoundVariants: [
    { class: "text-primary", isActive: true, variant: "primary" },
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
      true: "",
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
  file: ProjectFileViewerFile;
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

  if (kind === "markdown" || kind === "text" || kind === "code") {
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
                "h-px min-w-0 rounded-full",
                isActive
                  ? variant === "primary"
                    ? "bg-primary/35"
                    : "bg-sidebar-accent-foreground/35"
                  : "bg-muted-foreground/20",
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
        "h-10 w-8 shrink-0 overflow-hidden rounded-md border border-border bg-background shadow-sm",
        isActive &&
          (variant === "primary"
            ? "border-primary/20 bg-primary/10"
            : "border-sidebar-accent-foreground/20 bg-sidebar-accent-foreground/10"),
        className,
      )}
    >
      {children}
    </div>
  );
}
