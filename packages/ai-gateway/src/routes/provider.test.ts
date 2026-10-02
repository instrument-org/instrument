import {
  AI_GATEWAY_API_KEY_NOT_NEEDED,
  AI_GATEWAY_API_PATH,
} from "@instrument-org/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDERS_PATH } from "../constants";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { type AIGatewayEnv } from "../types";
import { providerApp } from "./provider";

function AIProviderConfigId(id: string): AIGatewayProviderConfig.Type["id"] {
  // Branded ID; a bare string is fine for this test.
  return id as AIGatewayProviderConfig.Type["id"];
}

/** The gateway with one provider configured, mounted where the real one is. */
function gatewayWith(config: AIGatewayProviderConfig.Type) {
  return new Hono<AIGatewayEnv>()
    .basePath(AI_GATEWAY_API_PATH)
    .use("*", async (context, next) => {
      context.set("getAIProviderConfigs", () => [config]);
      context.set("captureException", vi.fn());
      await next();
    })
    .route(PROVIDERS_PATH, providerApp);
}

/** The headers the proxied request left with. */
async function forwardedHeaders(config: AIGatewayProviderConfig.Type) {
  const upstream = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response("{}")),
  );
  vi.stubGlobal("fetch", upstream);
  await gatewayWith(config).request(
    `${AI_GATEWAY_API_PATH}${PROVIDERS_PATH}/${config.id}/models`,
    {
      headers: {
        authorization: "Bearer internal-gateway-key",
        "x-api-key": "internal-gateway-key",
        "x-goog-api-key": "internal-gateway-key",
      },
    },
  );
  const [input, init] = upstream.mock.calls[0] ?? [];
  if (input === undefined) {
    throw new Error("the gateway never reached the provider");
  }
  return new Request(input, init).headers;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider proxy auth headers", () => {
  it("sends no key to a provider that needs none", async () => {
    const headers = await forwardedHeaders({
      apiKey: AI_GATEWAY_API_KEY_NOT_NEEDED,
      baseURL: "http://localhost:11434",
      cacheIdentifier: "ollama",
      id: AIProviderConfigId("ollama"),
      type: "ollama",
    });
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("x-goog-api-key")).toBeNull();
  });

  it("sends the provider's own key in place of the gateway's", async () => {
    const headers = await forwardedHeaders({
      apiKey: "provider-key",
      cacheIdentifier: "openai",
      id: AIProviderConfigId("openai"),
      type: "openai",
    });
    expect(headers.get("authorization")).toBe("Bearer provider-key");
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("x-goog-api-key")).toBeNull();
  });
});
