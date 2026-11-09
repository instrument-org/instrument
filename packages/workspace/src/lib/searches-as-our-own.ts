import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { CLAUDE_ACCOUNT_PROVIDER_CONFIG } from "@instrument-org/shared";

import { type SessionMessage } from "../schemas/session/message";
import { TOOL_NAMES } from "../tools/name";

/**
 * A search Claude Code ran inside a Claude account's step is stored as a
 * `web_search` the provider ran, with its result beside the call in the
 * assistant message. That is how the Claude account's replay and step
 * planner read it, and no other provider can: one sends the call with no
 * reply, another takes `web_search` for a server tool of its own. For any
 * other model it is sent as a search of ours, the call answered by its
 * result, which every provider reads.
 */
export function searchesAsOurOwn(
  messages: SessionMessage.WithParts[],
  model: AIGatewayModel.Type,
): SessionMessage.WithParts[] {
  if (model.params.provider === CLAUDE_ACCOUNT_PROVIDER_CONFIG.type) {
    return messages;
  }
  return messages.map((message) =>
    message.parts.some(isProviderSearch)
      ? {
          ...message,
          parts: message.parts.map((part) =>
            isProviderSearch(part)
              ? { ...part, providerExecuted: false }
              : part,
          ),
        }
      : message,
  );
}

function isProviderSearch(part: SessionMessage.WithParts["parts"][number]) {
  return (
    part.type === `tool-${TOOL_NAMES.webSearch}` &&
    "providerExecuted" in part &&
    part.providerExecuted === true
  );
}
