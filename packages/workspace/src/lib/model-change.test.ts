import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  modelAnsweredSinceTold,
  modelChangeSincePreviousTurn,
  withSwitchesOnUserTurns,
} from "./model-change";

const model = createMockAIGatewayModel({
  canonicalId: "current-model",
  contextLength: 200_000,
});

const assistant = (modelId: string, contextLength?: number, name?: string) =>
  ({
    metadata: {
      aiGatewayModel:
        contextLength === undefined
          ? undefined
          : {
              canonicalId: modelId,
              contextLength,
              name,
              params: { provider: "instrument", providerConfigId: "here" },
            },
      modelId,
    },
    parts: [],
    role: "assistant",
  }) as unknown as SessionMessage.WithParts;

const user = () =>
  ({
    metadata: {},
    parts: [],
    role: "user",
  }) as unknown as SessionMessage.WithParts;

describe("modelChangeSincePreviousTurn", () => {
  it("reports nothing on the first turn, which changes nothing", () => {
    expect(
      modelChangeSincePreviousTurn({ messages: [user()], model }),
    ).toBeUndefined();
  });

  it("reports nothing while the same model keeps answering", () => {
    expect(
      modelChangeSincePreviousTurn({
        messages: [user(), assistant("current-model"), user()],
        model,
      }),
    ).toBeUndefined();
  });

  it("names both models and both windows on a move", () => {
    expect(
      modelChangeSincePreviousTurn({
        messages: [
          user(),
          assistant("roomier-model", 1_000_000, "Roomier Model"),
          user(),
        ],
        model,
      }),
    ).toEqual({
      from: {
        contextLength: 1_000_000,
        modelId: "roomier-model",
        name: "Roomier Model",
        provider: "instrument",
      },
      to: {
        contextLength: 200_000,
        maker: "test",
        modelId: "current-model",
        name: "Mock Model",
        provider: "instrument",
        providerId: "mock-provider-id",
        providerName: "Test Provider",
      },
    });
  });

  it("sees a move to the same model from another provider", () => {
    const elsewhere = {
      metadata: {
        aiGatewayModel: {
          canonicalId: "current-model",
          name: "Mock Model",
          params: { provider: "openrouter" },
          providerName: "Other Provider",
          uri: "author/current-model?provider=other&providerConfigId=other",
        },
        modelId: "current-model",
      },
      parts: [],
      role: "assistant",
    } as unknown as SessionMessage.WithParts;
    expect(
      modelChangeSincePreviousTurn({
        messages: [user(), elsewhere, user()],
        model,
      })?.from.providerName,
    ).toBe("Other Provider");
  });

  it("sees no move when another computer asked through its own connection", () => {
    const elsewhere = {
      metadata: {
        aiGatewayModel: {
          canonicalId: "current-model",
          params: {
            provider: "instrument",
            providerConfigId: "other-computer",
          },
          uri: "author/current-model?provider=instrument&providerConfigId=other-computer",
        },
        modelId: "current-model",
      },
      parts: [],
      role: "assistant",
    } as unknown as SessionMessage.WithParts;
    expect(
      modelChangeSincePreviousTurn({
        messages: [user(), elsewhere, user()],
        model,
      }),
    ).toBeUndefined();
  });

  // A reply written by 1.x kept no model record, only the ids, so the note on
  // an old chat moved to another model drew the old side without its mark.
  it("names the provider of a reply recorded before the model was stored", () => {
    const fromOneX = {
      metadata: { modelId: "auto", providerId: "instrument" },
      parts: [],
      role: "assistant",
    } as unknown as SessionMessage.WithParts;
    expect(
      modelChangeSincePreviousTurn({
        messages: [user(), fromOneX, user()],
        model,
      })?.from,
    ).toEqual({ modelId: "auto", provider: "instrument" });
  });

  it("looks past a message the workspace wrote to the model asked before it", () => {
    const synthetic = {
      metadata: { modelId: "synthetic", providerId: "system", synthetic: true },
      parts: [],
      role: "assistant",
    } as unknown as SessionMessage.WithParts;
    const since = (before: string) =>
      modelChangeSincePreviousTurn({
        messages: [user(), assistant(before), synthetic, user()],
        model,
      })?.from.modelId;
    expect(since("current-model")).toBeUndefined();
    expect(since("roomier-model")).toBe("roomier-model");
  });

  it("carries an absent window through rather than inventing one", () => {
    expect(
      modelChangeSincePreviousTurn({
        messages: [user(), assistant("unmeasurable-model"), user()],
        model,
      })?.from.contextLength,
    ).toBeUndefined();
  });

  it("stops being new once the moved-to model has answered", () => {
    // The turn after a change records the new model itself, which is what makes
    // this self-limiting rather than something needing a guard.
    expect(
      modelChangeSincePreviousTurn({
        messages: [
          user(),
          assistant("roomier-model", 1_000_000),
          user(),
          assistant("current-model", 200_000),
          user(),
        ],
        model,
      }),
    ).toBeUndefined();
  });

  it("still sees the move when the turn that asked failed", () => {
    // A failed turn still records the model it was asking, so a session that
    // switched and then failed does not lose the fact that it switched.
    expect(
      modelChangeSincePreviousTurn({
        messages: [user(), assistant("roomier-model", 1_000_000)],
        model,
      })?.to.modelId,
    ).toBe("current-model");
  });
});

describe("modelAnsweredSinceTold", () => {
  const reply = (modelIdServed?: string, asked = model) =>
    ({
      metadata: {
        aiGatewayModel: asked,
        modelId: asked.canonicalId,
        modelIdServed,
      },
      parts: [],
      role: "assistant",
    }) as unknown as SessionMessage.WithParts;
  const saying = (type: string, data: object) =>
    ({
      metadata: {},
      parts: [{ data, type }],
      role: "user",
    }) as unknown as SessionMessage.WithParts;
  const told = (modelId: string) => saying("data-modelAnswered", { modelId });
  const since = (messages: SessionMessage.WithParts[]) =>
    modelAnsweredSinceTold({ messages, model })?.modelId;

  it("names the last reply's model, as its provider reported it", () => {
    expect(
      modelAnsweredSinceTold({
        messages: [user(), reply("maker/one"), user()],
        model,
      }),
    ).toEqual({ modelId: "maker/one", providerName: "Test Provider" });
  });

  it.each([
    ["nothing has answered", [user()]],
    ["the reply reported no other id", [user(), reply(), user()]],
    [
      "only an earlier reply reported one",
      [user(), reply("maker/one"), user(), reply(), user()],
    ],
    [
      "it was told, with replies since",
      [
        user(),
        reply("maker/one"),
        told("maker/one"),
        reply("maker/one"),
        user(),
      ],
    ],
    [
      "another model wrote it",
      [
        user(),
        reply(
          "maker/one",
          createMockAIGatewayModel({ canonicalId: "other-model" }),
        ),
        user(),
      ],
    ],
  ])("says nothing when %s", (_why, messages) => {
    expect(since(messages)).toBeUndefined();
  });

  it("says so when a router's pick moves", () => {
    expect(
      since([
        user(),
        reply("maker/one"),
        told("maker/one"),
        reply("maker/two"),
        user(),
      ]),
    ).toBe("maker/two");
  });

  it("tells it again after a switch away and back", () => {
    expect(
      since([
        user(),
        reply("maker/one"),
        told("maker/one"),
        saying("data-modelChange", {}),
        reply("maker/one"),
        user(),
      ]),
    ).toBe("maker/one");
  });
});

describe("withSwitchesOnUserTurns", () => {
  const side = (modelId: string, providerId?: string) => ({
    modelId,
    providerId,
  });
  const switching = (
    role: "assistant" | "user",
    from: ReturnType<typeof side>,
    to: ReturnType<typeof side>,
  ) =>
    ({
      id: "msg",
      metadata: {},
      parts: [{ data: { from, to }, metadata: {}, type: "data-modelChange" }],
      role,
    }) as unknown as SessionMessage.WithParts;
  const a = side("a", "maker/a");
  const b = side("b", "maker/b");
  const c = side("c", "maker/c");
  const onUser = (messages: SessionMessage.WithParts[]) =>
    withSwitchesOnUserTurns(messages)[0]?.parts.map((part) =>
      part.type === "data-modelChange"
        ? `${part.data.from.modelId} to ${part.data.to.modelId}`
        : part.type,
    );

  it("says a failed reply's switch on the turn it answered", () => {
    expect(onUser([user(), switching("assistant", a, b)])).toEqual(["a to b"]);
  });

  it("reads several as the one move they come to", () => {
    expect(
      onUser([switching("user", a, b), switching("assistant", b, c)]),
    ).toEqual(["a to c"]);
    expect(
      onUser([switching("user", a, b), switching("assistant", b, a)]),
    ).toEqual([]);
  });

  it("leaves one recorded without the model's facts as it was sent", () => {
    expect(
      onUser([user(), switching("assistant", side("a"), side("b"))]),
    ).toEqual([]);
  });

  it("leaves a reply with no turn before it alone", () => {
    const messages = [switching("assistant", a, b)];
    expect(withSwitchesOnUserTurns(messages)).toEqual(messages);
  });
});
