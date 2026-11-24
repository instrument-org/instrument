import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { modelSide } from "../../lib/model-change";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import {
  modelAnsweredModelNote,
  modelChangeModelNote,
  runningModelText,
} from "./model-change-model-text";

/** A catalog row, with what the mock's own options leave out. */
const row = (
  options: Parameters<typeof createMockAIGatewayModel>[0],
  facts: Partial<AIGatewayModel.Type>,
): AIGatewayModel.Type => ({ ...createMockAIGatewayModel(options), ...facts });

const instrument = { author: "instrument", provider: "instrument" } as const;
const claude = row(
  {
    ...instrument,
    canonicalId: "claude",
    name: "Claude",
    providerId: "instrument/claude",
  },
  { family: "Claude Haiku", maker: "anthropic", providerName: "Instrument" },
);
const chatgpt = row(
  {
    ...instrument,
    canonicalId: "chatgpt",
    name: "ChatGPT",
    providerId: "instrument/chatgpt",
  },
  { family: "GPT Luna", maker: "openai", providerName: "Instrument" },
);
// The catalog names a family and a maker for it too, which are whatever it
// picked when the catalog was read.
const auto = row(
  {
    ...instrument,
    canonicalId: "auto",
    name: "Auto",
    providerId: OUR_MODELS.text.id,
  },
  { family: "Claude Haiku", maker: "anthropic", providerName: "Instrument" },
);
const exact = row(
  {
    author: "anthropic",
    canonicalId: "claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    providerId: "anthropic/claude-sonnet-5.5",
  },
  { providerName: "OpenRouter" },
);

describe("runningModelText", () => {
  it("names one of ours, an exact model, and a router but never its pick", () => {
    expect([claude, exact, auto].map((model) => runningModelText(model)))
      .toMatchInlineSnapshot(`
      [
        "Model: you run on Claude Haiku, made by Anthropic. The user picked it as "Claude", served through Instrument (model id instrument/claude). You are still Instrument, the agent. Asked what model you are, name the model plainly.",
        "Model: you run on Claude Sonnet 5.5, made by Anthropic. The user picked it, served through OpenRouter (model id anthropic/claude-sonnet-5.5). You are still Instrument, the agent. Asked what model you are, name the model plainly.",
        "Model: the user picked "Auto", served through Instrument (model id instrument/auto). "Auto" chooses a model for each request, so it can change between replies; a note says which one answered last once that is known. You are still Instrument, the agent. Asked what model you are, say Auto chose it and name the last one you were told of, if any.",
      ]
    `);
  });
});

describe("modelChangeModelNote", () => {
  it("tells a switch between ours, to a router, and from one", () => {
    expect(
      [
        [claude, chatgpt] as const,
        [claude, auto] as const,
        [auto, exact] as const,
      ].map(([from, to]) =>
        modelChangeModelNote({ from: modelSide(from), to: modelSide(to) }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "
      <instrument-system-note>
      The user switched this chat's model from Claude Haiku, made by Anthropic (picked as "Claude") to GPT Luna, made by OpenAI (picked as "ChatGPT"), served through Instrument (model id instrument/chatgpt). Replies before this came from the earlier model. From here you run on GPT Luna. This replaces what you were told above about your model. You are still Instrument, the agent. Asked what model you are, name the model plainly.
      </instrument-system-note>",
        "
      <instrument-system-note>
      The user switched this chat's model from Claude Haiku, made by Anthropic (picked as "Claude") to "Auto", served through Instrument (model id instrument/auto). Replies before this came from the earlier model. "Auto" chooses a model for each request, so it can change between replies; a note says which one answered last once that is known. This replaces what you were told above about your model. You are still Instrument, the agent. Asked what model you are, say Auto chose it and name the last one you were told of, if any.
      </instrument-system-note>",
        "
      <instrument-system-note>
      The user switched this chat's model from "Auto" to Claude Sonnet 5.5, made by Anthropic, served through OpenRouter (model id anthropic/claude-sonnet-5.5). Replies before this came from the earlier model. From here you run on Claude Sonnet 5.5. This replaces what you were told above about your model. You are still Instrument, the agent. Asked what model you are, name the model plainly.
      </instrument-system-note>",
      ]
    `);
  });
});

it("tells which model wrote the last reply", () => {
  expect(
    modelAnsweredModelNote({
      modelId: "anthropic/claude-haiku-5.5",
      providerName: "Instrument",
    }),
  ).toMatchInlineSnapshot(`
    "
    <instrument-system-note>
    About your model, for reference only, and not part of the user's message: the reply just before this message was written by Claude Haiku 5.5 (model id anthropic/claude-haiku-5.5), as Instrument reported. Don't mention it unless asked what model you are.
    </instrument-system-note>"
  `);
});
