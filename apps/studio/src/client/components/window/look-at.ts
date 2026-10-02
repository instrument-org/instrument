import { type FileTab } from "@/client/atoms/window";
import { atom } from "jotai";

/** What the large panel shows: a file, by where it is, or a page by its address. */
export type LookTarget =
  | { kind: "file"; tab: FileTab }
  | { kind: "page"; title?: string; url: string };

/**
 * What the window's own panel shows, asked for from anywhere: a tab's Expand
 * puts what it has up here, to be seen at the size Quick Look gives a file.
 */
export const lookAtAtom = atom<LookTarget | null>(null);
