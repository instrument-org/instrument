import { Result } from "typescript-result";

import { AIGatewayModel } from "../../../schemas/model";
import { AIGatewayModelURI } from "../../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../../schemas/provider-config";
import { addHeuristicTags } from "../../add-heuristic-tags";
import { TypedError } from "../../errors";
import { getModelFeatures } from "../../get-model-features";
import { getProviderMetadata } from "../metadata";
import { ClaudePlanSession } from "./session";

/** The CLI's short names, which stand for whichever model is current. */
const ALIASES = new Set(["haiku", "opus", "sonnet"]);

/**
 * The models the user's plan offers, as the signed-in CLI lists them. Read
 * from a short-lived process, since only the CLI knows what the plan includes.
 */
export function fetchClaudePlanModels(config: AIGatewayProviderConfig.Type) {
  return Result.fromAsyncCatching(
    async () => {
      if (!config.executablePath) {
        throw new Error("No Claude Code executable is configured.");
      }
      const session = new ClaudePlanSession(
        "models",
        {
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
        return await session.supportedModels();
      } finally {
        session.close();
      }
    },
    (error) =>
      new TypedError.Unknown("Failed to list the Claude plan's models", {
        cause: error,
      }),
  ).map((listed) => {
    const metadata = getProviderMetadata(config.type);
    const author = "anthropic";
    const params = { provider: config.type, providerConfigId: config.id };
    const seen = new Set<string>();
    // The model the CLI recommends, which a fresh connection makes the default.
    const recommended = listed.find(
      (model) => model.value === "default",
    )?.resolvedModel;

    return listed.flatMap((model) => {
      // The CLI's recommendation, which is also listed under its own name.
      if (model.value === "default") {
        return [];
      }
      // An alias names whatever model is current, so the model it resolves
      // to is listed instead and stays put when the alias moves.
      const id = ALIASES.has(model.value) ? model.resolvedModel : model.value;
      if (!id || seen.has(id)) {
        return [];
      }
      seen.add(id);
      const providerId = AIGatewayModel.ProviderIdSchema.parse(id);
      const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(
        model.resolvedModel ?? id,
      );
      return [
        addHeuristicTags(
          {
            author,
            canonicalId,
            features: getModelFeatures(canonicalId),
            name: model.displayName,
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
            tags: canonicalId === recommended ? ["default"] : [],
            uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
          },
          config,
        ),
      ];
    });
  });
}
