import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { createContext } from "react";

/** What a row calls back with, and what it reads of the session's state. */
export interface TranscriptActions {
  isDeveloperMode: boolean;
  isRunning: boolean;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onRunAgain?: () => void;
}

export const TranscriptActionsContext = createContext<TranscriptActions>({
  isDeveloperMode: false,
  isRunning: false,
  onRetry: () => {},
});
