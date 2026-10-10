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
    taskId,
  }: {
    sessionId: StoreId.Session;
    taskId: ChatId;
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
    taskId: ChatId;
  }) => Promise<void>;
  onStart: (options: {
    sessionId: StoreId.Session;
    signal: AbortSignal;
    taskId: ChatId;
  }) => Promise<void>;
  shouldContinue: (options: {
    messages: SessionMessage.WithParts[];
  }) => Promise<boolean>;
  /**
   * The system prompt `getMessages` puts in the baseline. Built from code and
   * settings alone, never from the task, so a stored baseline whose system
   * message differs was written by an earlier build and is rebuilt.
   */
  systemPrompt: () => string;
}

/**
 * The agent's name, as written on a session's baseline. A session stored
 * under an earlier name (`main`, `instrument-one`) is read and continued by
 * this agent all the same: its baseline's system prompt differs from
 * `systemPrompt()`, so it is rebuilt on the next turn.
 */
export type AgentName = "instrument";
export type AgentTools = Partial<Record<InternalToolName, AnyAgentTool>>;

export type AnyAgent = Agent<AgentTools>;
