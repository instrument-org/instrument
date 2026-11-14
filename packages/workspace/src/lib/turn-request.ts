import {
  type AIGatewayModel,
  catalogEffort,
  CLIENT_SESSION_ID_HEADER,
  nativeSearchTools,
  providerOptionsForModel,
  type ReasoningEffort,
} from "@instrument-org/ai-gateway";
import { CLAUDE_ACCOUNT_PROVIDER_CONFIG } from "@instrument-org/shared";
import { type LanguageModel, type ToolSet } from "ai";
import { omit } from "radashi";

import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { TOOL_NAMES } from "../tools/name";
import { cacheSessionFor } from "./fork-cache-session";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * What a session's request goes out with besides its messages: its tools as
 * its provider takes them, its options, and the header its cache is routed
 * by. A question asked beside the session (a suggested next message, a
 * summary before a price step) goes out with the same and `aside`, so the
 * provider's cache, and on a Claude account the session's own transcript,
 * serves everything before the question.
 */
export async function turnRequest({
  aiSDKModel,
  aside = false,
  chatId,
  effort,
  model,
  sessionId,
  tools,
}: {
  aiSDKModel: Exclude<LanguageModel, string>;
  /** Asked beside the session, so its answer is never part of it. */
  aside?: boolean;
  chatId: ChatId;
  /** How hard the model thinks, when not as hard as the session's turns. */
  effort?: ReasoningEffort;
  model: AIGatewayModel.Type;
  sessionId: StoreId.Session;
  /** The session's agent's tools, as the turn defines them. */
  tools: ToolSet;
}) {
  // A Claude account searches with Claude Code's own WebSearch, inside the
  // agent's step, rather than through our web_search tool, whose search on
  // this account is a separate Claude Code process with a model of its own
  // in front of the same WebSearch. What it finds arrives as sources.
  // A Grok account does the same with xAI's hosted web and X search, which
  // run on xAI's side within the response; their calls are xAI's to run
  // and replay drops them, so only the sources they cite are kept.
  const nativeTools = await nativeSearchTools(model.params.provider);
  const searchesNatively =
    aiSDKModel.provider === CLAUDE_ACCOUNT_PROVIDER_CONFIG.type ||
    nativeTools !== undefined;
  const cacheSession = cacheSessionFor({ chatId, sessionId });
  const providerOptions = providerOptionsForModel(aiSDKModel, {
    effort:
      effort ?? getWorkspaceConfig().reasoningEffort ?? catalogEffort(model),
    reasoning: model.reasoning,
  });
  if (searchesNatively) {
    providerOptions[CLAUDE_ACCOUNT_PROVIDER_CONFIG.type] = {
      ...providerOptions[CLAUDE_ACCOUNT_PROVIDER_CONFIG.type],
      ...(aside && { aside: true }),
      builtInTools: ["WebSearch"],
      // Its own session even for a task, so a task and its chat each keep
      // a Claude Code session of their own, a task's forked from its
      // chat's where it branched off.
      sessionId,
      ...(cacheSession !== sessionId && { parentSessionId: cacheSession }),
    };
  }
  const ownTools = omit(tools, [TOOL_NAMES.webSearch]);
  return {
    // Groups the session's generations into one trace in the analytics our
    // gateway reports, and routes the request to the provider cache the
    // session's earlier requests warmed. A task names its chat's session,
    // whose cache holds the conversation it carries on from.
    headers: { [CLIENT_SESSION_ID_HEADER]: cacheSession },
    /** Our own tools by name, where the provider runs searches of its own. */
    ownToolNames: nativeTools && new Set(Object.keys(ownTools)),
    providerOptions,
    tools: searchesNatively ? { ...ownTools, ...nativeTools } : tools,
  };
}
