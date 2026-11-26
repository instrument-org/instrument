import { type FileTab } from "@/client/atoms/window";
import { atom } from "jotai";

/**
 * What the large panel shows: a file or a folder by where it is, a picture by
 * its address, or a part of a message (`LookContent`).
 */
export type LookTarget =
  | { content: LookContent; kind: "content" }
  | { kind: "file"; tab: FileTab }
  | { folder: LookFolder; kind: "folder" }
  | { kind: "picture"; picture: LookPicture };

/** A picture with no file behind it: a diagram, a pasted image, a web image in a message. */
export type LookPicture = {
  filename: string;
  mimeType?: string;
  url: string;
};

/**
 * A part of a message, such as a table, under a title. The message draws it
 * into the panel itself (`LookedAtContent`), so it keeps the message's context.
 */
export type LookContent = {
  /** The drawing's own id, which tells it the panel is showing it. */
  id: string;
  title: string;
};

/** A folder in the panel, with what its card says about it. */
export type LookFolder = {
  /** A picture drawn in place of the folder glyph, for a folder with its own icon. */
  glyphSrc?: string;
  hostPath: string;
  /** ISO time, as the folder's row has it. */
  modifiedAt?: string;
  name: string;
};

/** Where a target is, which is what makes two the same. */
export function lookPathOf(target: LookTarget) {
  switch (target.kind) {
    case "content": {
      return target.content.id;
    }
    case "file": {
      return target.tab.hostPath;
    }
    case "folder": {
      return target.folder.hostPath;
    }
    case "picture": {
      return target.picture.url;
    }
  }
}

/** The file where the opener knows it, for its actions; the picture alone otherwise. */
export function lookTargetOf({
  hostPath,
  ...picture
}: LookPicture & { hostPath?: string }): LookTarget {
  return hostPath
    ? {
        kind: "file",
        tab: {
          hostPath,
          name: hostPath.split(/[/\\]/).at(-1) ?? picture.filename,
        },
      }
    : { kind: "picture", picture };
}

/**
 * What the window's own panel shows, asked for from anywhere: a picture, a
 * diagram or a table in a message, or a file waiting in the reply box, is put
 * up here to be seen at the size Quick Look gives a file.
 */
export const lookAtAtom = atom<LookTarget | null>(null);

/** Where the panel has room for the `LookContent` it shows, by that content's id. */
export const lookContentSlotAtom = atom<{
  element: HTMLElement;
  id: string;
} | null>(null);
