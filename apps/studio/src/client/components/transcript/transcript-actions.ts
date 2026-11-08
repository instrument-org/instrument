import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type StoreId } from "@instrument-org/workspace/client";
import { createContext } from "react";

import { type RunAgain } from "../message-error";

/** What a row calls back with, and what it reads of the session's state. */
export interface TranscriptActions {
  isRunning: boolean;
  /** Starts a new chat with the conversation up to `upTo`, a reply's last message; only a chat's own transcript can. */
  onBranch?: (upTo: StoreId.Message) => Promise<void>;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onRunAgain?: RunAgain;
}

export const TranscriptActionsContext = createContext<TranscriptActions>({
  isRunning: false,
  onRetry: () => {},
});
