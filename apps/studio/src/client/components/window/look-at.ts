import { type FileTab } from "@/client/atoms/window";
import { atom } from "jotai";

/** What the large panel shows: a file, by where it is. */
export type LookTarget = { kind: "file"; tab: FileTab };

/**
 * What the window's own panel shows, asked for from anywhere: a tab's Expand
 * puts its file up here, to be seen at the size Quick Look gives a file.
 */
export const lookAtAtom = atom<LookTarget | null>(null);
