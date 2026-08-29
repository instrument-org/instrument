import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { modelChangeSincePreviousTurn } from "./model-change";

const model = createMockAIGatewayModel({
  canonicalId: "current-model",
  contextLength: 200_000,
});

const assistant = (modelId: string, contextLength?: number, name?: string) =>
  ({
    metadata: {
      aiGatewayModel:
        contextLength === undefined ? undefined : { contextLength, name },
      modelId,
    },
    parts: [],
    role: "assistant",
  }) as unknown as SessionMessage.WithParts;

const user = () =>
  ({ metadata: {}, parts: [], role: "user" }) as unknown as
    SessionMessage.WithParts;

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
      },
      to: { contextLength: 200_000, modelId: "current-model", name: "Mock Model" },
    });
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
