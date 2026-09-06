import { createContext } from "react";

/**
 * How a reply's files fence is drawn: the grid of cards a task's transcript
 * shows, or one thin row per file for a narrow transcript, where a card's
 * height is the room the words needed.
 */
export const FilesLayoutContext = createContext<"grid" | "list">("grid");
