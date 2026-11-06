import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { createContext } from "react";

import { type RunAgain } from "../message-error";

/** What a row calls back with, and what it reads of the session's state. */
export interface TranscriptActions {
  isRunning: boolean;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onRunAgain?: RunAgain;
}

export const TranscriptActionsContext = createContext<TranscriptActions>({
  isRunning: false,
  onRetry: () => {},
});
