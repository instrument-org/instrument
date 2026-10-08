import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";

import {
  type ModelListError,
  offerKeyOf,
  type readModelStatus,
} from "./model-status";

/**
 * Every state the chosen model can be in, as the inputs that put it there:
 * read by the unit test that pins what each one says, and by the debug page
 * that draws each one, so the two cannot drift apart.
 */
const model = ({
  author = "anthropic",
  canonicalId,
  config = "anthropic-key",
  name,
  provider = "anthropic" as const,
  providerId,
  replacedBy,
  restricted,
}: {
  author?: string;
  canonicalId: string;
  config?: string;
  name: string;
  provider?: "anthropic" | "instrument" | "openrouter";
  providerId?: string;
  replacedBy?: string;
  restricted?: string;
}) => {
  const params = {
    provider,
    providerConfigId: AIProviderConfigIdSchema.parse(config),
  };
  return AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    features: [],
    name,
    params,
    providerId: providerId ?? `${author}/${canonicalId}`,
    providerName: config,
    tags: [],
    ...(replacedBy && { replacedBy }),
    ...(restricted && {
      restricted: { message: restricted, reason: "plan" },
    }),
    uri: AIGatewayModelURI.fromModel({
      author,
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
      params,
    }),
  });
};

const auto = model({
  author: OUR_MODELS.author,
  canonicalId: "auto",
  config: "instrument",
  name: "Auto",
  provider: "instrument",
  providerId: OUR_MODELS.text.id,
});
const sonnet55 = model({
  canonicalId: "claude-sonnet-5.5",
  name: "Claude Sonnet 5.5",
});
const sonnet5 = model({
  canonicalId: "claude-sonnet-5",
  name: "Claude Sonnet 5",
  replacedBy: "claude-sonnet-5.5",
});
const opus = model({
  canonicalId: "claude-opus-5.5",
  name: "Claude Opus 5.5",
  restricted: "Claude Opus needs a paid plan.",
});
const viaOpenRouter = model({
  canonicalId: "claude-haiku-4.5",
  config: "openrouter-key",
  name: "Claude Haiku 4.5",
  provider: "openrouter",
});

const viaInstrument = model({
  canonicalId: "claude-haiku-4.5",
  config: "instrument",
  name: "Claude Haiku 4.5",
  provider: "instrument",
});

const listed = [auto, sonnet55, sonnet5, opus, viaOpenRouter];

/** A URI for a model no list holds any more. */
const goneURI = (canonicalId: string, config = "anthropic-key") =>
  model({ canonicalId, config, name: canonicalId }).uri;

const openRouterDown: ModelListError[] = [
  {
    config: { displayName: "OpenRouter", id: "openrouter-key" },
    message: "401 Unauthorized",
  },
];

const none = new Set<string>();
// The removed connection is named by its kind only where a name is known; the
// case below that leaves it out reads the fallback.

export const modelStatusScenarios = {
  loading: { dismissedOffers: none, isLoading: true, models: listed },
  fine: { dismissedOffers: none, models: listed, modelURI: sonnet55.uri },
  "newer release listed": {
    dismissedOffers: none,
    models: listed,
    modelURI: sonnet5.uri,
  },
  "newer release, offer dismissed": {
    dismissedOffers: new Set([offerKeyOf(sonnet5, sonnet55)]),
    models: listed,
    modelURI: sonnet5.uri,
  },
  "restricted, with Auto to fall back on": {
    dismissedOffers: none,
    models: listed,
    modelURI: opus.uri,
  },
  "withdrawn, its series continues": {
    dismissedOffers: none,
    models: listed,
    modelURI: goneURI("claude-sonnet-4.5"),
  },
  "provider removed, same model elsewhere": {
    dismissedOffers: none,
    models: listed,
    modelURI: goneURI("claude-haiku-4.5", "removed-key"),
    providerNames: new Map([["anthropic", "Anthropic"]]),
  },
  "provider removed, same model through OpenRouter and Instrument": {
    dismissedOffers: none,
    // Instrument listed last, so only the preference can put it first.
    models: [...listed, viaInstrument],
    modelURI: goneURI("claude-haiku-4.5", "removed-key"),
  },
  "withdrawn, nothing continues it": {
    dismissedOffers: none,
    models: listed,
    modelURI: goneURI("mystery-model"),
  },
  "its provider failed to load": {
    dismissedOffers: none,
    errors: openRouterDown,
    models: [auto, sonnet55],
    modelURI: viaOpenRouter.uri,
  },
  "the list failed": {
    dismissedOffers: none,
    isError: true,
    modelURI: sonnet55.uri,
  },
  "none chosen": { dismissedOffers: none, models: listed },
  "nothing listed": { dismissedOffers: none, models: [] },
} satisfies Record<string, Parameters<typeof readModelStatus>[0]>;
