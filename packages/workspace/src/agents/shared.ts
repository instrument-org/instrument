import { sift } from "radashi";

import { isToolPart } from "../lib/is-tool-part";
import { type Environment } from "../schemas/environment";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type AgentName } from "./types";

/**
 * @param environment The computer the text describes, recorded with it so a
 * later message can tell what changed since.
 */
export function createContextMessage({
  agentName,
  environment,
  now,
  sessionId,
  textParts,
  told,
}: {
  agentName: AgentName;
  environment: Environment;
  now: Date;
  sessionId: StoreId.Session;
  textParts: (boolean | null | string | undefined)[];
  /** What else the text tells, for later notes to be measured against. */
  told?: Pick<
    SessionMessage.Context["metadata"],
    "apps" | "folders" | "skills"
  >;
}): SessionMessage.ContextWithParts {
  const userMessageId = StoreId.newMessageId();

  const text = sift(
    textParts.map((part) =>
      typeof part === "string" ? part.trim() : undefined,
    ),
  ).join("\n\n");

  return {
    id: userMessageId,
    metadata: {
      agentName,
      createdAt: now,
      environment,
      realRole: "user",
      sessionId,
      ...told,
    },
    parts: [
      {
        metadata: {
          createdAt: now,
          endedAt: now,
          id: StoreId.newPartId(),
          messageId: userMessageId,
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "session-context",
  };
}

export function createSystemMessage({
  agentName,
  now,
  sessionId,
  text,
}: {
  agentName: AgentName;
  now: Date;
  sessionId: StoreId.Session;
  text: string;
}): SessionMessage.ContextWithParts {
  const systemMessageId = StoreId.newMessageId();

  return {
    id: systemMessageId,
    metadata: {
      agentName,
      createdAt: now,
      realRole: "system",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: now,
          endedAt: now,
          id: StoreId.newPartId(),
          messageId: systemMessageId,
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "session-context",
  };
}

export function shouldContinueWithToolCalls({
  messages,
}: {
  messages: SessionMessage.WithParts[];
}) {
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  // Continue if no assistant message was found
  if (!lastAssistantMessage) {
    return Promise.resolve(true);
  }

  // Continue if last assistant message has tool calls this app ran. One the
  // provider ran inside the step, such as a search Claude Code ran itself,
  // was answered there, and the model read its result before it stopped.
  return Promise.resolve(
    lastAssistantMessage.parts.some(
      (part) => isToolPart(part) && part.providerExecuted !== true,
    ),
  );
}
