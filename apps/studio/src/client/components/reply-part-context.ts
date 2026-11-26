import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { createContext } from "react";

/**
 * The reply part a Markdown block is drawn from, for a card in it that acts
 * on the reply itself: a prompt card's Send writes onto this part that it was
 * sent. Absent wherever the words are not a reply's (a file, a draft), where
 * such a card only copies.
 */
export const ReplyPartContext = createContext<
  SessionMessagePart.TextPart | undefined
>(undefined);
