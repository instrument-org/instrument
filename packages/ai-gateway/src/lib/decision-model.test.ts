import { OUR_MODELS, type WorkspaceServerURL } from "@instrument-org/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { requestDecision } from "./decision-model";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestDecision", () => {
  it.each([
    { path: "/decision", type: OUR_MODELS.providerType },
    { path: "/systemone", type: "openrouter" },
  ])("asks $type on its decision endpoint, $path", async ({ path, type }) => {
    const fetch = vi.fn((_url: string) =>
      Promise.resolve(Response.json({ answers: {}, model: "m" })),
    );
    vi.stubGlobal("fetch", fetch);

    await requestDecision({
      body: { questions: {}, state: {} },
      // Only the id and type are read here.
      config: { id: "cfg-1", type } as AIGatewayProviderConfig.Type,
      workspaceServerURL: "http://localhost" as WorkspaceServerURL,
    });

    expect(String(fetch.mock.calls[0]?.[0])).toMatch(new RegExp(`${path}$`));
  });

  it("reads the plan refusal from the body, however long it is", async () => {
    const refused = {
      error: {
        message: "x".repeat(400),
        code: "usage-limit-exceeded",
      },
    };
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json(refused, { status: 429 })),
    );

    await expect(
      requestDecision({
        body: { questions: {}, state: {} },
        // Only the id and type are read here.
        config: {
          id: "cfg-1",
          type: OUR_MODELS.providerType,
        } as AIGatewayProviderConfig.Type,
        workspaceServerURL: "http://localhost" as WorkspaceServerURL,
      }),
    ).rejects.toMatchObject({
      refusal: { code: "usage-limit-exceeded" },
      status: 429,
    });
  });
});
