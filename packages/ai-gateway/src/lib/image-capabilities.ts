import { OUR_MODELS } from "@instrument-org/shared";

import { type ImageGenerationProviderType } from "./providers/metadata";

// Hand-maintained catalog of the generation parameters each image provider's
// selected model actually accepts. Values are transported to the model either
// as a standard AI SDK image param (size/aspectRatio) or as a top-level
// provider option (quality/background), depending on `via`. Keyed by provider
// type because each type resolves to a fixed model; the same underlying model
// reached through different providers can expose different knobs (e.g. the
// OpenRouter images endpoint advertises more aspect ratios than the Google SDK).
// Sourced from the providers' live capability descriptors, not synced at build
// time -- update by hand when a provider's default image model changes.

export interface ImageModelCapabilities {
  readonly params: Readonly<Partial<Record<ImageKnob, ImageParamSpec>>>;
  // Appended to the tool description for models that steer shape through the
  // prompt rather than a parameter.
  readonly shapeGuidance?: string;
  readonly supportsStreaming: boolean;
}

type ImageKnob = "aspectRatio" | "background" | "quality";

interface ImageParamSpec {
  readonly values: readonly string[];
  readonly via: "providerOption" | "standard";
}

const QUALITY_LEVELS = ["auto", "low", "medium", "high"] as const;
const GRADED_QUALITY = ["low", "medium", "high"] as const;
const GPT_IMAGE_BACKGROUND = ["auto", "opaque"] as const;

// OpenRouter's unified images endpoint advertises 14 ratios for the Gemini
// image model.
const GEMINI_OPENROUTER_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
] as const;

// The @ai-sdk/google image config exposes a narrower set.
const GEMINI_GOOGLE_ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
] as const;

const PROMPT_SHAPE_GUIDANCE =
  "This model has no size or aspect-ratio parameter; describe the desired dimensions, orientation, or framing directly in the prompt.";

const NO_PARAMS: ImageModelCapabilities = {
  params: {},
  supportsStreaming: false,
};

const IMAGE_CAPABILITIES: Record<
  ImageGenerationProviderType,
  ImageModelCapabilities
> = {
  deepinfra: NO_PARAMS,
  fireworks: NO_PARAMS,
  google: {
    params: {
      aspectRatio: { values: GEMINI_GOOGLE_ASPECT_RATIOS, via: "standard" },
    },
    supportsStreaming: false,
  },
  openai: {
    params: {
      quality: { values: QUALITY_LEVELS, via: "providerOption" },
    },
    shapeGuidance: PROMPT_SHAPE_GUIDANCE,
    supportsStreaming: false,
  },
  openrouter: {
    params: {
      aspectRatio: { values: GEMINI_OPENROUTER_ASPECT_RATIOS, via: "standard" },
    },
    supportsStreaming: false,
  },
  [OUR_MODELS.providerType]: {
    params: {
      background: { values: GPT_IMAGE_BACKGROUND, via: "providerOption" },
      quality: { values: QUALITY_LEVELS, via: "providerOption" },
    },
    shapeGuidance: PROMPT_SHAPE_GUIDANCE,
    supportsStreaming: true,
  },
  together: NO_PARAMS,
  vercel: NO_PARAMS,
  "x-ai": {
    params: {
      quality: { values: GRADED_QUALITY, via: "providerOption" },
    },
    supportsStreaming: false,
  },
};

// AI SDK `providerOptions` key for each provider's image model. Provider-option
// knobs (quality/background) are nested under this key; standard knobs are not.
const PROVIDER_IMAGE_OPTION_NAMESPACE: Record<
  ImageGenerationProviderType,
  string
> = {
  deepinfra: "deepinfra",
  fireworks: "fireworks",
  google: "google",
  openai: "openai",
  openrouter: "openrouter",
  [OUR_MODELS.providerType]: "openrouter",
  together: "togetherai",
  vercel: "vercel",
  "x-ai": "xai",
};

export function describeImageParameters(
  capabilities: ImageModelCapabilities,
): string {
  const lines = Object.entries(capabilities.params).map(
    ([knob, spec]) => `- ${knob}: one of ${spec.values.join(", ")}`,
  );
  const parts =
    lines.length > 0
      ? [
          "Optional image parameters supported by the selected model, passed as a `parameters` object:",
          ...lines,
          "Unsupported parameter names or values are ignored.",
        ]
      : ["The selected image model accepts no additional parameters."];
  if (capabilities.shapeGuidance) {
    parts.push(capabilities.shapeGuidance);
  }
  return parts.join("\n");
}

export function imageCapabilitiesForProvider(
  providerType: ImageGenerationProviderType,
): ImageModelCapabilities {
  return IMAGE_CAPABILITIES[providerType];
}

export function imageModelSupportsStreaming(
  providerType: ImageGenerationProviderType,
): boolean {
  return IMAGE_CAPABILITIES[providerType].supportsStreaming;
}

// Validates agent-supplied parameters against the selected model's catalog and
// splits them into the standard AI SDK image param (aspectRatio) and the
// top-level provider-option bag (quality/background). Unsupported names or
// out-of-range values are dropped.
export function resolveImageParameters({
  parameters,
  providerType,
}: {
  parameters?: Record<string, boolean | number | string>;
  providerType: ImageGenerationProviderType;
}): {
  aspectRatio?: `${number}:${number}`;
  namespace: string;
  providerParams: Record<string, boolean | number | string>;
} {
  const capabilities = IMAGE_CAPABILITIES[providerType];
  const providerParams: Record<string, boolean | number | string> = {};
  let aspectRatio: `${number}:${number}` | undefined;

  // Iterate the model's known knobs, not the agent-supplied keys, so a hostile
  // key (e.g. `constructor`) can't resolve to an inherited value on
  // capabilities.params.
  for (const knob of Object.keys(capabilities.params) as ImageKnob[]) {
    const spec = capabilities.params[knob];
    const value = parameters?.[knob];
    if (spec === undefined || value === undefined) {
      continue;
    }
    if (!spec.values.includes(String(value))) {
      continue;
    }
    if (spec.via === "standard" && knob === "aspectRatio") {
      if (typeof value === "string") {
        // Validated above against the model's allowed `${number}:${number}` set.
        aspectRatio = value as `${number}:${number}`;
      }
    } else if (spec.via === "providerOption") {
      providerParams[knob] = value;
    }
  }

  return {
    aspectRatio,
    namespace: PROVIDER_IMAGE_OPTION_NAMESPACE[providerType],
    providerParams,
  };
}
