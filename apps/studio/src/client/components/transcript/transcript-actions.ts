import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type StoreId } from "@instrument-org/workspace/client";
import { createContext } from "react";

import { type RunAgain } from "../message-error";

/** What a row calls back with, and what it reads of the session's state. */
export interface TranscriptActions {
  isDeveloperMode: boolean;
  isRunning: boolean;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onRunAgain?: RunAgain;
}

export const TranscriptActionsContext = createContext<TranscriptActions>({
  isDeveloperMode: false,
  isRunning: false,
  onRetry: () => {},
});

/** What the model heard of each `state` part, for the notes developers see. */
export const StateNotesContext = createContext<
  ReadonlyMap<StoreId.Part, string>
>(new Map());
