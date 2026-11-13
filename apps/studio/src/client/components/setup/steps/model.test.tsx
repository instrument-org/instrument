import { renderWithProviders } from "@/tests/render";
import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MainModelList, useMainModelChoice } from "./model";

function model(canonicalId: string, name: string, configId = "openrouter") {
  const params = {
    provider: "openrouter" as const,
    providerConfigId: AIProviderConfigIdSchema.parse(configId),
  };
  return AIGatewayModel.Schema.parse({
    author: "openai",
    canonicalId,
    features: [],
    name,
    params,
    providerId: `openai/${canonicalId}`,
    providerName: configId === "openrouter" ? "OpenRouter" : "Other key",
    tags: [],
    uri: AIGatewayModelURI.fromModel({
      author: "openai",
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
      params,
    }),
  });
}

const models = [model("first", "First"), model("second", "Second")];
/** A model another key serves, outside the connection the choice is for. */
const elsewhere = model("elsewhere", "Elsewhere", "other");

const state = vi.hoisted(() => ({
  defaultURI: undefined as string | undefined,
  saved: [] as string[],
}));

// The default is a live read: saving one answers the next read with it, as
// the preferences store does once Continue writes it.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    gateway: {
      models: {
        live: {
          list: {
            experimental_liveOptions: () => ({
              queryFn: () => ({ models: [...models, elsewhere] }),
              queryKey: ["models"],
            }),
          },
        },
      },
    },
    preferences: {
      live: {
        defaultModelURI: {
          experimental_liveOptions: () => ({
            queryFn: () => state.defaultURI ?? null,
            queryKey: ["default"],
          }),
        },
      },
      setDefaultModelURI: {
        mutationOptions: () => ({
          mutationFn: ({ modelURI }: { modelURI: string }) => {
            state.defaultURI = modelURI;
            state.saved.push(modelURI);
            return Promise.resolve();
          },
        }),
      },
    },
  },
}));

const openRouter = {
  kind: "key" as const,
  providerConfigId: AIProviderConfigIdSchema.parse("openrouter"),
};

function Choice() {
  const choice = useMainModelChoice(openRouter);
  return (
    <>
      <MainModelList choice={choice} />
      <button
        onClick={() => {
          choice.save(() => {});
        }}
        type="button"
      >
        {choice.doneLabel("Continue")}
      </button>
    </>
  );
}

const rows = () =>
  screen
    .getAllByRole("radio")
    .map((radio) => radio.closest("label")?.textContent);

describe("useMainModelChoice", () => {
  it("keeps the order and the recommendation it opened with after Continue saves the pick", async () => {
    state.defaultURI = models[0]?.uri;
    const { queryClient } = renderWithProviders(<Choice />);
    await waitFor(
      () => {
        expect(rows()).toEqual(["FirstRecommended", "Second"]);
      },
      { interval: 1 },
    );

    fireEvent.click(screen.getByText("Second"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(
      () => {
        expect(state.saved).toEqual([models[1]?.uri]);
      },
      { interval: 1 },
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ["default"] }));
    expect(queryClient.getQueryData(["default"])).toBe(models[1]?.uri);
    // Query Cache tells its observers on a timer of its own.
    await act(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 20);
        }),
    );

    expect(rows()).toEqual(["FirstRecommended", "Second"]);
    expect(screen.getByRole("radio", { checked: true }).id).toBe(
      `setup-model-${String(models[1]?.uri)}`,
    );
  });

  it("keeps the model another connection serves on top, picked, until another is picked", async () => {
    state.defaultURI = elsewhere.uri;
    state.saved = [];
    renderWithProviders(<Choice />);
    await waitFor(
      () => {
        expect(rows()).toEqual([
          "ElsewhereOther keyCurrent",
          "FirstRecommended",
          "Second",
        ]);
      },
      { interval: 1 },
    );
    expect(screen.getByRole("radio", { checked: true }).id).toBe(
      `setup-model-${elsewhere.uri}`,
    );
    expect(screen.getByText("New from OpenRouter")).toBeTruthy();

    fireEvent.click(screen.getByText("Second"));
    fireEvent.click(screen.getByRole("button", { name: "Switch to Second" }));
    await waitFor(
      () => {
        expect(state.saved).toEqual([models[1]?.uri]);
      },
      { interval: 1 },
    );
  });
});
