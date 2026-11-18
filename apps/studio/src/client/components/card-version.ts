import { createContext } from "react";

/**
 * The version of a file a reply's card stands for, once the chat has a
 * second version of the file: its number, and for an older one drawn from
 * its copy, the ways to open it and put it back, which its menu offers.
 */
export interface CardVersion {
  number: number;
  open?: () => void;
  restore?: () => void;
}

/** The version the card drawn under it stands for; absent outside a reply's cards. */
export const CardVersionContext = createContext<CardVersion | undefined>(
  undefined,
);
