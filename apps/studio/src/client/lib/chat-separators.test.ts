import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import { type SessionMessage, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { chatSeparators, separatorDayLabel } from "./chat-separators";

const params = {
  provider: OUR_MODELS.providerType,
  providerConfigId: AIProviderConfigIdSchema.parse(OUR_MODELS.cacheIdentifier),
};

const model = (author: string, canonicalId: string, name: string) =>
  AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    features: ["inputText", "outputText", "tools"],
    name,
    params,
    providerId: `${author}/${canonicalId}`,
    providerName: "Instrument",
    tags: [],
    uri: AIGatewayModelURI.fromModel({
      author,
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
      params,
    }),
  });

const auto = model("instrument", "auto", "Auto");
const glm = model("z-ai", "glm-5.3-prime", "GLM 5.3 Prime");
const sonnet = model("anthropic", "claude-sonnet-5", "Claude Sonnet 5");

const sessionId = StoreId.newSessionId();

const sent = (
  at: string,
  switched?: { from: AIGatewayModel.Type; to: AIGatewayModel.Type },
): SessionMessage.WithParts => {
  const id = StoreId.newMessageId();
  const side = (asked: AIGatewayModel.Type) => ({
    modelId: asked.canonicalId,
    name: asked.name,
    provider: asked.params.provider,
  });
  return {
    id,
    metadata: { createdAt: new Date(at), sessionId },
    parts: switched
      ? [
          {
            data: { from: side(switched.from), to: side(switched.to) },
            metadata: {
              createdAt: new Date(at),
              id: StoreId.newPartId(),
              messageId: id,
              sessionId,
            },
            type: "data-modelChange",
          },
        ]
      : [],
    role: "user",
  };
};

const reply = (
  at: string,
  asked: AIGatewayModel.Type,
  served?: AIGatewayModel.Type,
): SessionMessage.WithParts => ({
  id: StoreId.newMessageId(),
  metadata: {
    aiGatewayModel: asked,
    aiGatewayModelServed: served,
    createdAt: new Date(at),
    finishReason: "stop",
    modelId: asked.canonicalId,
    modelIdServed: served?.providerId,
    providerId: asked.params.provider,
    sessionId,
  },
  parts: [],
  role: "assistant",
});

/** Each separator as the index of the message it sits over and what it names. */
const describeSeparators = (messages: SessionMessage.WithParts[]) =>
  [...chatSeparators(messages)].map(([id, separator]) => ({
    at: messages.findIndex((message) => message.id === id),
    model: separator.usage?.requested?.name,
    switched: separator.change && {
      from: separator.change.from.usage?.requested?.name,
      to:
        separator.change.to.usage?.requested?.name ??
        separator.change.to.recorded.name,
    },
    timed: separator.timed,
  }));

describe("chatSeparators", () => {
  it("names the model above the first message only, in a chat that stays on it", () => {
    expect(
      describeSeparators([
        sent("2026-09-26T16:12:00"),
        reply("2026-09-26T16:12:05", glm),
        sent("2026-09-26T16:20:00"),
        reply("2026-09-26T16:20:05", glm),
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "at": 0,
          "model": "GLM 5.3 Prime",
          "switched": undefined,
          "timed": true,
        },
      ]
    `);
  });

  it("marks an hour's quiet and a new day with the time alone", () => {
    expect(
      describeSeparators([
        sent("2026-09-26T16:12:00"),
        reply("2026-09-26T16:12:05", glm),
        sent("2026-09-26T17:30:00"),
        reply("2026-09-26T17:30:05", glm),
        sent("2026-09-26T23:59:00"),
        reply("2026-09-26T23:59:05", glm),
        sent("2026-09-27T00:05:00"),
        reply("2026-09-27T00:05:05", glm),
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "at": 0,
          "model": "GLM 5.3 Prime",
          "switched": undefined,
          "timed": true,
        },
        {
          "at": 2,
          "model": undefined,
          "switched": undefined,
          "timed": true,
        },
        {
          "at": 4,
          "model": undefined,
          "switched": undefined,
          "timed": true,
        },
        {
          "at": 6,
          "model": undefined,
          "switched": undefined,
          "timed": true,
        },
      ]
    `);
  });

  it("names both models above a message its turn recorded a switch on, timed only after a gap", () => {
    expect(
      describeSeparators([
        sent("2026-09-26T16:12:00"),
        reply("2026-09-26T16:12:05", glm),
        sent("2026-09-26T16:31:00", { from: glm, to: sonnet }),
        reply("2026-09-26T16:31:05", sonnet),
        sent("2026-09-26T18:00:00", { from: sonnet, to: glm }),
        reply("2026-09-26T18:00:05", glm),
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "at": 0,
          "model": "GLM 5.3 Prime",
          "switched": undefined,
          "timed": true,
        },
        {
          "at": 2,
          "model": undefined,
          "switched": {
            "from": "GLM 5.3 Prime",
            "to": "Claude Sonnet 5",
          },
          "timed": false,
        },
        {
          "at": 4,
          "model": undefined,
          "switched": {
            "from": "Claude Sonnet 5",
            "to": "GLM 5.3 Prime",
          },
          "timed": true,
        },
      ]
    `);
  });

  // Replies are read in landing order, which moves while one is still being
  // written, so a switch inferred from them landed on one message live and
  // another once the chat was opened again.
  it("draws no switch the turn did not record, whatever the replies asked", () => {
    expect(
      describeSeparators([
        sent("2026-09-26T16:12:00"),
        reply("2026-09-26T16:12:05", glm),
        sent("2026-09-26T16:31:00"),
        reply("2026-09-26T16:31:05", sonnet),
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "at": 0,
          "model": "GLM 5.3 Prime",
          "switched": undefined,
          "timed": true,
        },
      ]
    `);
  });

  it("names the model switched to before its reply exists", () => {
    expect(
      describeSeparators([
        sent("2026-09-26T16:12:00"),
        reply("2026-09-26T16:12:05", glm),
        sent("2026-09-26T16:31:00", { from: glm, to: sonnet }),
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "at": 0,
          "model": "GLM 5.3 Prime",
          "switched": undefined,
          "timed": true,
        },
        {
          "at": 2,
          "model": undefined,
          "switched": {
            "from": "GLM 5.3 Prime",
            "to": "Claude Sonnet 5",
          },
          "timed": false,
        },
      ]
    `);
  });

  it("gathers a router's picks under its one separator", () => {
    const separators = chatSeparators([
      sent("2026-09-26T16:12:00"),
      reply("2026-09-26T16:12:05", auto, glm),
      sent("2026-09-26T16:20:00"),
      reply("2026-09-26T16:20:05", auto, sonnet),
    ]);
    expect(
      [...separators.values()].map(({ usage }) => ({
        kind: usage?.kind,
        requested: usage?.requested?.name,
        served: usage?.served.map((s) => s.model?.name),
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "kind": "routed",
          "requested": "Auto",
          "served": [
            "GLM 5.3 Prime",
            "Claude Sonnet 5",
          ],
        },
      ]
    `);
  });

  it("names nothing until the reply exists", () => {
    expect(describeSeparators([sent("2026-09-26T16:12:00")]))
      .toMatchInlineSnapshot(`
        [
          {
            "at": 0,
            "model": undefined,
            "switched": undefined,
            "timed": true,
          },
        ]
      `);
  });
});

describe("separatorDayLabel", () => {
  const now = new Date("2026-09-26T16:00:00");

  it.each([
    ["2026-09-26T09:00:00", "Today"],
    ["2026-09-25T23:00:00", "Yesterday"],
    ["2026-09-22T12:00:00", "Tuesday"],
    ["2026-09-12T12:00:00", "Sat, Sep 12"],
    ["2025-12-30T12:00:00", "Tue, Dec 30, 2025"],
  ])("%s reads as %s", (at, label) => {
    expect(separatorDayLabel(new Date(at), now)).toBe(label);
  });
});
