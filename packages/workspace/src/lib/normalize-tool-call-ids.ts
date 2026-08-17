import type { AIGatewayModel } from "@instrument-org/ai-gateway";
import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "ai";

import { isAnthropic } from "./is-anthropic";

type AssistantPart = Extract<
  AssistantModelMessage["content"],
  unknown[]
>[number];

type ToolPart = ToolModelMessage["content"][number];

/**
 * Rewrite tool call ids into the character set Anthropic accepts.
 *
 * Every slot holding one has to move together. A call and the result answering
 * it sit on the same assistant message when the provider ran the tool itself,
 * so rewriting one shape and not its neighbor breaks the pair instead of
 * fixing it: the provider rejects a `tool_use` that no `tool_result` refers
 * back to, and the turn fails outright rather than degrading.
 *
 * The exhaustive switches are the point. A part shape carrying an id is the
 * kind of thing that arrives with an SDK upgrade, and one that slipped past
 * here would keep an id nothing else matches. Failing to compile is the only
 * way that gets noticed.
 */
export function normalizeToolCallIds({
  messages,
  model,
}: {
  messages: ModelMessage[];
  model: AIGatewayModel.Type;
}): ModelMessage[] {
  if (!isAnthropic(model)) {
    return messages;
  }

  return messages.map((message) => {
    switch (message.role) {
      case "assistant": {
        if (typeof message.content === "string") {
          return message;
        }
        return {
          ...message,
          content: message.content.map(normalizeAssistantPart),
        };
      }
      case "system":
      case "user": {
        return message;
      }
      case "tool": {
        return { ...message, content: message.content.map(normalizeToolPart) };
      }
      default: {
        const unhandled: never = message;
        return unhandled;
      }
    }
  });
}

function normalizeAssistantPart(part: AssistantPart): AssistantPart {
  switch (part.type) {
    case "file":
    case "reasoning":
    case "text": {
      return part;
    }
    case "tool-approval-request":
    case "tool-call":
    case "tool-result": {
      return { ...part, toolCallId: normalizeToolCallId(part.toolCallId) };
    }
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

function normalizeToolCallId(toolCallId: string) {
  // Anthropic doesn't support tool call IDs with special characters
  // and will error "String should match pattern '^[a-zA-Z0-9_-]+$'"
  return toolCallId.replaceAll(/[^\w-]/g, "_");
}

function normalizeToolPart(part: ToolPart): ToolPart {
  switch (part.type) {
    case "tool-approval-response": {
      // Keyed by `approvalId`, and carries no tool call id to rewrite.
      return part;
    }
    case "tool-result": {
      return { ...part, toolCallId: normalizeToolCallId(part.toolCallId) };
    }
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}
