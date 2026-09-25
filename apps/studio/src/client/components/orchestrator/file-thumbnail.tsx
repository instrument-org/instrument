import { FileViewer } from "@/client/components/file-viewer";
import { useTheme } from "@/client/components/theme-provider";
import {
  getComputerFileUrl,
  getComputerThumbnailUrl,
} from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useState } from "react";

/** How much smaller than life a document is drawn in its thumbnail. */
const THUMBNAIL_SCALE = 0.4;

/** The shape a document's thumbnail is drawn in, and its picture with it. */
const THUMBNAIL_BOX_CLASS =
  "aspect-[0.78] w-full overflow-hidden rounded-sm bg-card shadow-sm ring-1 ring-border";

/**
 * A file drawn small, as the Finder's tiles draw it: the picture the app
 * keeps of it (a page as a browser draws it, Markdown and code typeset, the
 * rest as the system draws them), and the file's viewer scaled down into a
 * page-shaped box where there is no picture of it. What Home and the
 * columns' preview draw a document as.
 */
export function FileThumbnail({
  hostPath,
  name,
  url,
  version,
}: {
  hostPath: string;
  name: string;
  /** The file's channel URL, when the caller has one with the file's version in it. */
  url?: string;
  /** When the file was last written, as listed; a new value is a new picture. */
  version?: string;
}) {
  const { resolvedTheme } = useTheme();
  const picture = getComputerThumbnailUrl({
    hostPath,
    size: 512,
    theme: resolvedTheme,
    version,
  });
  const [failed, setFailed] = useState<string>();
  if (picture && failed !== picture) {
    return (
      <div className={cn("pointer-events-none", THUMBNAIL_BOX_CLASS)}>
        <img
          alt=""
          className="size-full object-cover object-top"
          draggable={false}
          onError={() => {
            setFailed(picture);
          }}
          src={picture}
        />
      </div>
    );
  }
  return (
    <DocumentThumbnail key={hostPath}>
      <FileViewer
        className="h-full"
        file={{
          filename: name,
          hostPath,
          url: url ?? getComputerFileUrl({ hostPath }),
        }}
      />
    </DocumentThumbnail>
  );
}

/**
 * A document at thumbnail size: the viewer drawn at full width and scaled
 * down into a page-shaped box, not interactive, clipped at the bottom the way
 * a page preview is. The viewer sees a box wide enough to lay itself out as
 * it would in a pane, so type and tables keep their shape at a smaller size.
 */
function DocumentThumbnail({ children }: { children: ReactNode }) {
  const inverse = `${100 / THUMBNAIL_SCALE}%`;
  return (
    // `contain-inline-size`: the box's own width says nothing about the
    // document in it, so a wide line in the viewer cannot widen the column
    // the thumbnail sits in.
    // Inert as well as untouchable: the viewer draws controls of its own,
    // and a picture of a document has none a click or a tab can reach.
    <div
      className={cn(
        "pointer-events-none contain-inline-size",
        THUMBNAIL_BOX_CLASS,
      )}
      inert
    >
      {/* The viewer is laid out at the box's width divided by the scale and
          drawn scaled back down, so it fills the box edge to edge; what it
          lays out past the box's height is clipped, the way a page preview
          is. Its own chrome rows are hidden, and so is a markdown file's
          outline, a rail of bars in the margin nobody reads at this size: a
          thumbnail is the document. */}
      <div
        className="origin-top-left [&_.viewer-chrome-stroke]:hidden [&_[data-slot=markdown-outline]]:hidden"
        style={{
          height: inverse,
          transform: `scale(${THUMBNAIL_SCALE})`,
          width: inverse,
        }}
      >
        {children}
      </div>
    </div>
  );
}
