import { type AIGatewayModel } from "@instrument-org/ai-gateway";

import type { InternalToolName } from "../tools/all";
import type { AnyAgentTool } from "../tools/types";

import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";

export interface Agent<T extends AgentTools> {
  agentTools: T;
  getMessages: ({
    sessionId,
    chatId,
    model,
  }: {
    sessionId: StoreId.Session;
    chatId: ChatId;
    /** The model the request writing the baseline runs on. */
    model: AIGatewayModel.Type;
  }) =>
    | Promise<SessionMessage.ContextWithParts[]>
    | SessionMessage.ContextWithParts[];
  getTools: () => Promise<AnyAgentTool[]>;
  name: AgentName;
  onFinish: (options: {
    model: AIGatewayModel.Type;
    parentMessageId: StoreId.Message;
    sessionId: StoreId.Session;
    signal: AbortSignal;
    chatId: ChatId;
  }) => Promise<void>;
  onStart: (options: {
    sessionId: StoreId.Session;
    signal: AbortSignal;
    chatId: ChatId;
  }) => Promise<void>;
  shouldContinue: (options: {
    chatId: ChatId;
    messages: SessionMessage.WithParts[];
    sessionId: StoreId.Session;
  }) => Promise<boolean>;
  /**
   * The system prompt `getMessages` puts in the baseline. Built from code
   * alone, never from the task or the computer, so it reads the same in every
   * chat on every computer. A chat keeps the one it started with until its
   * window rolls over; see `session-baseline.ts`.
   */
  systemPrompt: () => string;
}

/**
 * The agent's name, as written on a session's baseline. A session stored
 * under an earlier name (`main`, `instrument-one`) is read and continued by
 * this agent all the same: its baseline predates the current
 * `SESSION_CONTEXT_VERSION`, so it is written again on the next turn.
 */
export type AgentName = "instrument";
export type AgentTools = Partial<Record<InternalToolName, AnyAgentTool>>;

export type AnyAgent = Agent<AgentTools>;
