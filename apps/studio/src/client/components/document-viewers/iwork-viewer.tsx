import { InfoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { FileLoading } from "../file-loading";
import { readArchiveMember } from "./archive";

// The preview iWork writes is a screen-resolution JPEG of one page; anything
// near this bound means the file is not what it claims to be.
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const PREVIEW_MEMBER = "preview.jpg";

const APP_NAMES: Record<string, string> = {
  key: "Keynote",
  numbers: "Numbers",
  pages: "Pages",
};

/**
 * Pages, Numbers and Keynote documents, shown through the preview image the
 * authoring app writes into them.
 *
 * These are zip containers around Apple's own IWA format, a protobuf stream
 * with no published schema and no reader outside Apple's apps, so rendering the
 * document itself is not on the table. What every one of them does carry is a
 * `preview.jpg` that iWork rendered at the last save, which is enough to tell
 * one file from another, check that the right version was attached, or read a
 * one-page memo without leaving the app.
 *
 * The banner is not decoration. A reader who is not told this is a snapshot
 * will reasonably assume they are looking at the live document, and every way
 * that assumption is wrong matters: the image is a single page, it carries no
 * selectable text, and it is as old as the last save by an Apple app rather
 * than as old as the file.
 */
export function IWorkViewer({
  filename,
  url,
}: {
  filename: string;
  url: string;
}) {
  const {
    data: preview,
    error,
    isLoading,
  } = useQuery({
    queryFn: () =>
      readArchiveMember({
        maxBytes: MAX_PREVIEW_BYTES,
        name: PREVIEW_MEMBER,
        url,
      }),
    queryKey: ["iwork-preview", url],
    retry: false,
  });

  const objectUrl = useObjectUrl(preview ?? null);

  if (isLoading) {
    return <FileLoading />;
  }

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
  // which owns the "preview unavailable" card for every viewer.
  if (error) {
    throw error;
  }
  // Documents saved by very old iWork versions, and anything renamed to look
  // like one, have no preview to show. The fallback card offers to open the
  // file in the app that can read it, which is the better answer anyway.
  if (!objectUrl) {
    throw new Error(`${filename} has no preview image inside it.`);
  }

  return (
    <>
      <div className="flex shrink-0 items-start gap-2 border-t border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <InfoIcon className="mt-px size-4 shrink-0" />
        <span>
          Preview of the first page, saved by {appName(filename)}. The full
          document can only be opened in {appName(filename)}.
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40">
        <img
          alt={`Preview of ${filename}`}
          className="mx-auto my-4 max-w-full bg-white shadow-sm"
          src={objectUrl}
        />
      </div>
    </>
  );
}

function appName(filename: string) {
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  return APP_NAMES[extension.toLowerCase()] ?? "iWork";
}

/**
 * A blob URL for as long as the blob is on screen.
 *
 * Object URLs are held by the document until they are revoked, so one per
 * opened file would keep every preview this session alive in memory.
 */
function useObjectUrl(blob: Blob | null) {
  const url = useMemo(
    () => (blob ? URL.createObjectURL(blob) : null),
    [blob],
  );

  useEffect(() => {
    if (!url) {
      return;
    }
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}
