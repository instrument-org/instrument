import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { createContext } from "react";

type Reply = SessionMessageDataPart.ReplyDataPart;

/**
 * Starts a reply to a bubble: set by the chat whose composer takes replies,
 * absent everywhere else, so a bubble offers to reply only where the answer
 * has somewhere to go.
 */
export const ReplyContext = createContext<((reply: Reply) => void) | undefined>(
  undefined,
);
