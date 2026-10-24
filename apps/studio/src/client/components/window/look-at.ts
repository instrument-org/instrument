import { type FileTab } from "@/client/atoms/window";
import { atom } from "jotai";

/** What the large panel shows: a file or a folder, by where it is. */
export type LookTarget =
  | { kind: "file"; tab: FileTab }
  | { folder: LookFolder; kind: "folder" };

/** A folder in the panel, with what its card says about it. */
export type LookFolder = {
  /** A picture drawn in place of the folder glyph, for a folder with its own icon. */
  glyphSrc?: string;
  hostPath: string;
  /** ISO time, as the folder's row has it. */
  modifiedAt?: string;
  name: string;
};

/** Where a target is on the computer, which is what makes two the same. */
export function lookPathOf(target: LookTarget) {
  return target.kind === "file" ? target.tab.hostPath : target.folder.hostPath;
}

/**
 * What the window's own panel shows, asked for from anywhere: a tab's Expand
 * puts its file up here, to be seen at the size Quick Look gives a file.
 */
export const lookAtAtom = atom<LookTarget | null>(null);
