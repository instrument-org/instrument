import { InfoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { FileLoading } from "../file-loading";
import { readArchiveMember } from "./archive";

// The preview iWork writes is a screen-resolution JPEG of one page; anything
// near this bound means the file is not what it claims to be.
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

// In order. The first is where every current version of the apps puts it; the
// second is where the generation before them did, and a document last saved by
// one of those still previews.
const PREVIEW_MEMBERS = ["preview.jpg", "QuickLook/Thumbnail.jpg"];

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
    queryFn: () => readPreview(url),
    queryKey: ["iwork-preview", url],
    retry: false,
  });

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
  if (!preview) {
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
        <PreviewImage blob={preview} filename={filename} />
      </div>
    </>
  );
}

function appName(filename: string) {
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  return APP_NAMES[extension.toLowerCase()] ?? "iWork";
}

/**
 * The preview, shown through a blob URL that lives exactly as long as the
 * element showing it.
 *
 * The browser holds a blob URL until it is revoked, so one per opened file
 * would keep every preview seen this session in memory. Tying creation to the
 * element rather than to a memo or a piece of state is what makes the revoke
 * reliable: there is one URL per attached node, and detaching the node is the
 * event that ends it.
 */
function PreviewImage({ blob, filename }: { blob: Blob; filename: string }) {
  const attach = useCallback(
    (node: HTMLImageElement) => {
      const url = URL.createObjectURL(blob);
      node.src = url;
      return () => {
        URL.revokeObjectURL(url);
      };
    },
    [blob],
  );

  return (
    <img
      alt={`Preview of ${filename}`}
      className="mx-auto my-4 max-w-full bg-white shadow-sm"
      ref={attach}
    />
  );
}

/**
 * The first preview image the document carries, or null when it carries none.
 */
async function readPreview(url: string) {
  for (const name of PREVIEW_MEMBERS) {
    const blob = await readArchiveMember({
      maxBytes: MAX_PREVIEW_BYTES,
      name,
      url,
    });
    if (blob) {
      return blob;
    }
  }
  return null;
}
