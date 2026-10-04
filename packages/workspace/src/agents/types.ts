import { type AIGatewayModel } from "@instrument-org/ai-gateway";

import type { InternalToolName } from "../tools/all";
import type { AnyAgentTool } from "../tools/types";

import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";

export interface Agent<T extends AgentTools> {
  agentTools: T;
  getMessages: ({
    sessionId,
    taskId,
  }: {
    sessionId: StoreId.Session;
    taskId: TaskId;
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
    taskId: TaskId;
  }) => Promise<void>;
  onStart: (options: {
    sessionId: StoreId.Session;
    signal: AbortSignal;
    taskId: TaskId;
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

const AGENT_NAMES = ["main", "instrument"] as const;

export type AgentName = (typeof AGENT_NAMES)[number];
export type AgentTools = Partial<Record<InternalToolName, AnyAgentTool>>;

export type AnyAgent = Agent<AgentTools>;
