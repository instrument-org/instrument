import { type ViewerFile } from "@/client/atoms/task-file-viewer";
import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { type FileType, getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useState } from "react";
import { tv } from "tailwind-variants";

import { FileTypeIcon } from "./extend/file-system";
import { ImageWithFallback } from "./image-with-fallback";
import { useTheme } from "./theme-provider";

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
  // No `.ipynb` icon exists, so the alternative is the generic one, which says
  // nothing; the lines at least say "a document with text in it".
  notebook: true,
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
  file: ViewerFile;
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
              <FileTypeIcon
                className={thumbnailIcon({ isActive, variant })}
                fileName={file.filename}
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

  const drawn = HAS_LINE_THUMBNAIL[kind] ? (
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
  ) : (
    <ThumbnailFrame
      className="flex items-center justify-center"
      isActive={isActive}
      variant={variant}
    >
      <FileTypeIcon
        className={thumbnailIcon({ isActive, variant })}
        fileName={file.filename}
      />
    </ThumbnailFrame>
  );

  // A card in a reply is drawn as the file itself where the app keeps a
  // picture of it, the way the Finder's tiles are. The sidebar's rows stay
  // marks: a list of every file a task touched reads by name, not by page.
  // Only once the file channel is known, since a URL is all there is to ask
  // it with; before that there is no picture to wait for.
  if (variant === "primary" && hasFileChannel(file.hostPath)) {
    return (
      <ThumbnailPicture fallback={drawn} file={file} isActive={isActive} />
    );
  }

  return drawn;
}

function hasFileChannel(hostPath: string) {
  return (
    getComputerThumbnailUrl({ hostPath, size: 512, theme: "light" }) !== ""
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

/**
 * The picture the app keeps of a file, in the thumbnail's frame, or
 * `fallback` where there is none: a 404 from the channel is how it says so.
 *
 * At the version the card's own URL carries, so a reply that named a file
 * later rewritten still draws the file it handed over.
 */
function ThumbnailPicture({
  fallback,
  file,
  isActive,
}: {
  fallback: ReactNode;
  file: ViewerFile;
  isActive: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const picture = getComputerThumbnailUrl({
    hostPath: file.hostPath,
    // The frame is under fifty pixels tall, and the smallest size drawn is
    // sixty-four: blurred at twice the density a Mac draws at.
    size: 512,
    theme: resolvedTheme,
    version: URL.parse(file.url)?.searchParams.get("version") ?? undefined,
  });
  const [failed, setFailed] = useState<string>();
  if (!picture || failed === picture) {
    return fallback;
  }
  return (
    <ThumbnailFrame isActive={isActive} variant="primary">
      <img
        alt=""
        className="size-full object-cover object-top"
        draggable={false}
        onError={() => {
          setFailed(picture);
        }}
        src={picture}
      />
    </ThumbnailFrame>
  );
}
