import { OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import {
  describeImageParameters,
  imageCapabilitiesForProvider,
  resolveImageParameters,
} from "./image-capabilities";

const INSTRUMENT = OUR_MODELS.providerType;

describe("resolveImageParameters", () => {
  it("routes quality/background to the provider-option bag for the default model", () => {
    expect(
      resolveImageParameters({
        parameters: { background: "opaque", quality: "high" },
        providerType: INSTRUMENT,
      }),
    ).toEqual({
      aspectRatio: undefined,
      namespace: "openrouter",
      providerParams: { background: "opaque", quality: "high" },
    });
  });

  it("passes aspectRatio as a standard param where supported", () => {
    const result = resolveImageParameters({
      parameters: { aspectRatio: "16:9" },
      providerType: "openrouter",
    });

    expect(result.aspectRatio).toBe("16:9");
    expect(result.providerParams).toEqual({});
  });

  const droppedCases: {
    note: string;
    parameters: Record<string, string>;
    providerType: Parameters<typeof resolveImageParameters>[0]["providerType"];
  }[] = [
    {
      note: "default model has no aspect ratio",
      parameters: { aspectRatio: "16:9" },
      providerType: INSTRUMENT,
    },
    {
      note: "gemini-via-openrouter has no quality",
      parameters: { quality: "high" },
      providerType: "openrouter",
    },
    {
      note: "ratio outside the narrower Google set",
      parameters: { aspectRatio: "21:9" },
      providerType: "google",
    },
    {
      note: "xai quality is graded, not auto",
      parameters: { quality: "auto" },
      providerType: "x-ai",
    },
    {
      note: "unknown knob",
      parameters: { unknown: "x" },
      providerType: INSTRUMENT,
    },
  ];

  it.each(droppedCases)(
    "drops unsupported params ($note)",
    ({ parameters, providerType }) => {
      const result = resolveImageParameters({ parameters, providerType });

      expect(result.aspectRatio).toBeUndefined();
      expect(result.providerParams).toEqual({});
    },
  );

  it("ignores prototype keys without throwing", () => {
    expect(() =>
      resolveImageParameters({
        parameters: { constructor: "x", hasOwnProperty: "y" },
        providerType: INSTRUMENT,
      }),
    ).not.toThrow();

    const result = resolveImageParameters({
      parameters: { constructor: "x", quality: "high" },
      providerType: INSTRUMENT,
    });
    expect(result.providerParams).toEqual({ quality: "high" });
  });

  it("uses each provider's own option namespace", () => {
    expect(
      resolveImageParameters({
        parameters: { quality: "high" },
        providerType: "openai",
      }).namespace,
    ).toBe("openai");
    expect(
      resolveImageParameters({
        parameters: { quality: "high" },
        providerType: "x-ai",
      }).namespace,
    ).toBe("xai");
  });
});

describe("describeImageParameters", () => {
  it("lists the default model's knobs and shape guidance", () => {
    expect(describeImageParameters(imageCapabilitiesForProvider(INSTRUMENT)))
      .toMatchInlineSnapshot(`
      "Optional image parameters supported by the selected model, passed as a \`parameters\` object:
      - background: one of auto, opaque
      - quality: one of auto, low, medium, high
      Unsupported parameter names or values are ignored.
      This model has no size or aspect-ratio parameter; describe the desired dimensions, orientation, or framing directly in the prompt."
    `);
  });

  it("notes when a model takes no parameters", () => {
    expect(
      describeImageParameters(imageCapabilitiesForProvider("fireworks")),
    ).toMatchInlineSnapshot(
      `"The selected image model accepts no additional parameters."`,
    );
  });
});
