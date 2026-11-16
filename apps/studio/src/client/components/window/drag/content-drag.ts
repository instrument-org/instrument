import { type FileDragProps, useFileDrag } from "@/client/hooks/use-file-drag";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { type DragEvent } from "react";

/**
 * Content a press can carry out of where it is: a file or folder on the
 * computer, by its path, or a link, by its address. Unlike a piece of the
 * window (a tab, a group's row, a bookmark), content is held by the
 * system's drag, so it can leave the app, and every place here that takes
 * it takes it the way it takes the same thing dragged in from the Finder or
 * another browser (`useSystemDrags`).
 */
export type Content =
  | { hostPath: string; kind: "file" }
  | { kind: "link"; title: string; url: string };

/** What an address carries: the file or folder a `file://` address names, else the link. */
export function contentOfAddress(url: string, title: string): Content {
  const hostPath = hostPathOfFileUrl(url);
  if (hostPath) {
    // A folder's address ends in a separator, which its path does not.
    const trimmed = hostPath.replace(/(?<=.)[/\\]+$/, "");
    return { hostPath: trimmed, kind: "file" };
  }
  return { kind: "link", title, url };
}

/** The link this window's own drag carries while it is in the air, which the system's drag says only at the release. */
let linkInAir: { title: string; url: string } | undefined;

/** The link this window put in the system's drag, while it is in the air. */
export function ownLinkInAir() {
  return linkInAir;
}

/** The pieces of a link a drop target reads: its address listed, as text, and as markup carrying its name. */
function linkTransfer({ title, url }: { title: string; url: string }) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.textContent = title || url;
  return {
    "text/html": anchor.outerHTML,
    "text/plain": url,
    "text/uri-list": url,
  };
}

/**
 * Props that make an element a handle for its content, held by the system's
 * drag: a file goes as the file, as a row of Files drags (`useFileDrag`),
 * and a link as a link, as one in a browser's page drags. Nothing makes an
 * element drag where it carries nothing, or while it is being edited
 * (`isOff`), where a press selects words.
 */
export function useContentDrag(
  content: Content | undefined,
  { isOff = false }: { isOff?: boolean } = {},
): Partial<FileDragProps> & { onDragEnd?: () => void } {
  const file =
    !isOff && content?.kind === "file"
      ? { hostPath: content.hostPath }
      : undefined;
  const fileDrag = useFileDrag(file);
  if (isOff || !content) {
    return {};
  }
  if (content.kind === "file") {
    return fileDrag;
  }
  return {
    draggable: true,
    onDragEnd: () => {
      linkInAir = undefined;
    },
    onDragStart: (event: DragEvent) => {
      startLinkDrag(event, content);
    },
  };
}

/** Puts a link in the system's drag, under a picture of its name. */
function startLinkDrag(event: DragEvent, link: { title: string; url: string }) {
  const transfer = event.dataTransfer;
  // A link inside something else that drags (a chip inside a row) is the
  // one held.
  event.stopPropagation();
  transfer.clearData();
  for (const [type, data] of Object.entries(linkTransfer(link))) {
    transfer.setData(type, data);
  }
  transfer.effectAllowed = "copyLink";
  linkInAir = { title: link.title, url: link.url };
  const picture = linkPicture(link);
  transfer.setDragImage(picture, 12, 12);
  // The picture is taken as the drag starts, so it can go straight after.
  setTimeout(() => {
    picture.remove();
  }, 0);
}

/** A chip of a link's name, off screen, for the system to picture the drag by. */
function linkPicture({ title, url }: { title: string; url: string }) {
  const chip = document.createElement("div");
  chip.textContent = title || url;
  Object.assign(chip.style, {
    background: "var(--popover)",
    borderRadius: "10px",
    color: "var(--foreground)",
    font: "500 13px/32px var(--font-sans)",
    left: "-1000px",
    maxWidth: "256px",
    overflow: "hidden",
    padding: "0 12px",
    position: "fixed",
    textOverflow: "ellipsis",
    top: "-1000px",
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(chip);
  return chip;
}
