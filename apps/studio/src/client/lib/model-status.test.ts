import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import {
  type ModelListError,
  noticeFor,
  offerKeyOf,
  readModelStatus,
} from "./model-status";

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

type Input = Parameters<typeof readModelStatus>[0];
const none = new Set<string>();

const cases = {
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
} satisfies Record<string, Input>;

describe("readModelStatus and noticeFor", () => {
  it("say one thing for each state the chosen model can be in", () => {
    const read = Object.fromEntries(
      Object.entries(cases).map(([name, input]) => {
        const status = readModelStatus(input);
        const notice = noticeFor(status);
        return [
          name,
          {
            status: status.kind,
            ...(notice && {
              notice: `[${notice.tone}${notice.dismissible ? ", ×" : ""}] ${notice.text}${notice.action ? ` → ${notice.action.label}` : ""}`,
            }),
          },
        ];
      }),
    );
    expect(read).toMatchInlineSnapshot(`
      {
        "fine": {
          "status": "ready",
        },
        "its provider failed to load": {
          "notice": "[problem] Couldn't load models from OpenRouter → Retry",
          "status": "provider-failed",
        },
        "loading": {
          "status": "loading",
        },
        "newer release listed": {
          "notice": "[offer, ×] Claude Sonnet 5.5 is available → Switch to Claude Sonnet 5.5",
          "status": "newer",
        },
        "newer release, offer dismissed": {
          "status": "ready",
        },
        "none chosen": {
          "notice": "[problem] No model chosen → Choose a model",
          "status": "none-chosen",
        },
        "nothing listed": {
          "notice": "[problem] No models available → Add a provider",
          "status": "no-models",
        },
        "provider removed, same model elsewhere": {
          "notice": "[problem] Claude Haiku 4.5 is no longer available → Use it through openrouter-key",
          "status": "gone",
        },
        "restricted, with Auto to fall back on": {
          "notice": "[problem] Claude Opus 5.5 is unavailable → Use Auto",
          "status": "restricted",
        },
        "the list failed": {
          "notice": "[problem] Couldn't load models → Retry",
          "status": "list-failed",
        },
        "withdrawn, its series continues": {
          "notice": "[problem] Claude Sonnet 4.5 is no longer available → Switch to Claude Sonnet 5.5",
          "status": "gone",
        },
        "withdrawn, nothing continues it": {
          "notice": "[problem] Mystery Model is no longer available → Use Auto",
          "status": "gone",
        },
      }
    `);
  });
});
