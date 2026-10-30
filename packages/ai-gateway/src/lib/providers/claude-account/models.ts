import { Result } from "typescript-result";

import { AIGatewayModel } from "../../../schemas/model";
import { AIGatewayModelURI } from "../../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../../schemas/provider-config";
import { addHeuristicTags } from "../../add-heuristic-tags";
import { canonicalizeAnthropicModelId } from "../../canonicalize-model-id";
import { TypedError } from "../../errors";
import { generateModelName } from "../../generate-model-name";
import { getModelFeatures } from "../../get-model-features";
import { reportedContextLength } from "../../reported-context-windows";
import { getProviderMetadata } from "../metadata";
import { ClaudeCodeSession } from "./session";

/** The CLI's short names, which stand for whichever model is current. */
const ALIASES = new Set(["haiku", "opus", "sonnet"]);

/**
 * How long listing the models waits on Claude Code to say their windows, all
 * of them together. A model it has not answered for by then has no window
 * until it finishes a turn.
 */
const CONTEXT_WINDOWS_DEADLINE_MS = 15_000;

/**
 * The models the user's plan offers, as the signed-in CLI lists them. Read
 * from a short-lived process, since only the CLI knows what the plan includes.
 */
export function fetchClaudeAccountModels(config: AIGatewayProviderConfig.Type) {
  return Result.fromAsyncCatching(
    async () => {
      if (!config.executablePath) {
        throw new Error("No Claude Code executable is configured.");
      }
      const session = new ClaudeCodeSession(
        "models",
        {
          builtInTools: [],
          configDir: config.configDir,
          effort: undefined,
          executablePath: config.executablePath,
          modelId: "default",
          systemPrompt: "",
          tools: [],
        },
        () => {},
      );
      try {
        const models = await session.supportedModels();
        return { models, windows: await contextWindowsOf(session, models) };
      } finally {
        session.close();
      }
    },
    (error) =>
      new TypedError.Unknown("Failed to list the Claude account's models", {
        cause: error,
      }),
  ).map(({ models: listed, windows }) => {
    const metadata = getProviderMetadata(config.type);
    const author = "anthropic";
    const params = { provider: config.type, providerConfigId: config.id };
    const seen = new Set<string>();

    return listed.flatMap((model) => {
      // The CLI's recommendation, which is also listed under its own name.
      if (model.value === "default") {
        return [];
      }
      // An alias names whatever model is current, so the model it resolves
      // to is listed instead and stays put when the alias moves.
      const id = ALIASES.has(model.value) ? model.resolvedModel : model.value;
      if (!id) {
        return [];
      }
      // Named from the id rather than from a list of known models, so one the
      // account gets before we have heard of it still reads as a model. One
      // row per model: an alias and a context variant of the same model would
      // otherwise share its address.
      const canonicalId = canonicalIdOf(model.resolvedModel ?? id);
      if (seen.has(canonicalId)) {
        return [];
      }
      seen.add(canonicalId);
      const providerId = AIGatewayModel.ProviderIdSchema.parse(id);
      return [
        addHeuristicTags(
          {
            author,
            canonicalId,
            contextLength:
              reportedContextLength({ params, providerId }) ??
              windows.get(model.value),
            features: getModelFeatures(canonicalId),
            name: generateModelName(canonicalId),
            params,
            providerId,
            providerName: config.displayName ?? metadata.name,
            reasoning: model.supportedEffortLevels?.length
              ? {
                  efforts: model.supportedEffortLevels,
                  enabledByDefault: true,
                  mandatory: false,
                }
              : undefined,
            tags: [],
            uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
          },
          config,
        ),
      ];
    });
  });
}

/**
 * The window each model runs in, by the name Claude Code lists it under, as
 * the process says when switched to it: the capacity, not the smaller window
 * Claude Code would compact at. Asked without a prompt, so no model is
 * called. Once a model finishes a turn, the window that turn reports is
 * read instead.
 */
async function contextWindowsOf(
  session: ClaudeCodeSession,
  models: { value: string }[],
) {
  const windows = new Map<string, number>();
  const read = async () => {
    for (const { value } of models) {
      if (value === "default") {
        continue;
      }
      try {
        await session.useModel(value);
        const { rawMaxTokens } = await session.contextUsage();
        if (Number.isSafeInteger(rawMaxTokens) && rawMaxTokens > 0) {
          windows.set(value, rawMaxTokens);
        }
      } catch (error) {
        console.warn(
          `[claude-account] could not read ${value}'s context window: ${String(error)}`,
        );
      }
    }
  };
  // A call still waiting at the deadline ends when the caller closes the
  // process, and the models answered by then keep their windows.
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    read(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CONTEXT_WINDOWS_DEADLINE_MS);
    }),
  ]);
  clearTimeout(timer);
  return windows;
}

/**
 * The id other providers list the same model under: `claude-opus-5-5` (or a
 * dated build, or a context variant like `claude-fable-5-1[1m]`) becomes
 * `claude-opus-5.5`, so features, tags and names line up with theirs.
 */
function canonicalIdOf(id: string) {
  return AIGatewayModel.CanonicalIdSchema.parse(
    canonicalizeAnthropicModelId(id.replace(/\[[^\]]*\]$/, "")),
  );
}
