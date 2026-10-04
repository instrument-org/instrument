import {
  AI_GATEWAY_API_KEY_NOT_NEEDED,
  AI_GATEWAY_API_PATH,
} from "@instrument-org/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLIENT_SESSION_ID_HEADER, PROVIDERS_PATH } from "../constants";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { workersAiTestOpenAiCompatBaseUrl } from "../test/workers-ai-fixtures";
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
async function forwardedHeaders(
  config: AIGatewayProviderConfig.Type,
  request: {
    body?: string;
    headers?: Record<string, string>;
    path?: string;
  } = {},
) {
  const upstream = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response("{}")),
  );
  vi.stubGlobal("fetch", upstream);
  await gatewayWith(config).request(
    `${AI_GATEWAY_API_PATH}${PROVIDERS_PATH}/${config.id}${request.path ?? "/models"}`,
    {
      body: request.body,
      headers: {
        authorization: "Bearer internal-gateway-key",
        "x-api-key": "internal-gateway-key",
        "x-goog-api-key": "internal-gateway-key",
        ...request.headers,
      },
      method: request.body === undefined ? "GET" : "POST",
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

describe("ChatGPT plan responses", () => {
  it("sends the session as the session-id header the plan caches by", async () => {
    const headers = await forwardedHeaders(
      {
        apiKey: "plan-token",
        cacheIdentifier: "chatgpt",
        id: AIProviderConfigId("chatgpt"),
        type: "chatgpt",
      },
      {
        body: JSON.stringify({ input: [], model: "gpt-5.6-sol", stream: true }),
        headers: { [CLIENT_SESSION_ID_HEADER]: "ses_1" },
        path: "/responses",
      },
    );
    expect(headers.get("session-id")).toBe("ses_1");
    expect(headers.get(CLIENT_SESSION_ID_HEADER)).toBeNull();
  });
});

describe("Workers AI session affinity", () => {
  it.each([
    {
      baseURL: workersAiTestOpenAiCompatBaseUrl,
      expected: "ses_1",
      name: "a Workers AI config",
    },
    {
      baseURL: "https://example.com/v1",
      expected: null,
      name: "another OpenAI-compatible config",
    },
  ])("sends x-session-affinity to $name", async ({ baseURL, expected }) => {
    const headers = await forwardedHeaders(
      {
        apiKey: "key",
        baseURL,
        cacheIdentifier: "compat",
        id: AIProviderConfigId("compat"),
        type: "openai-compatible",
      },
      { headers: { [CLIENT_SESSION_ID_HEADER]: "ses_1" } },
    );
    expect(headers.get("x-session-affinity")).toBe(expected);
  });
});

describe("OpenCode", () => {
  it.each([
    {
      expected: "https://opencode.ai/zen/go/v1/messages",
      path: "/messages",
      type: "opencode-go",
    },
    {
      expected: "https://opencode.ai/zen/v1/responses",
      path: "/responses",
      type: "opencode-zen",
    },
    {
      expected:
        "https://opencode.ai/zen/v1/models/gemini-3.7-flash:streamGenerateContent",
      path: "/models/gemini-3.7-flash:streamGenerateContent",
      type: "opencode-zen",
    },
  ] as const)(
    "sends $path for $type to $expected with every key header and the session",
    async ({ expected, path, type }) => {
      const upstream = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response("{}")),
      );
      vi.stubGlobal("fetch", upstream);
      await gatewayWith({
        apiKey: "opencode-key",
        cacheIdentifier: type,
        id: AIProviderConfigId(type),
        type,
      }).request(`${AI_GATEWAY_API_PATH}${PROVIDERS_PATH}/${type}${path}`, {
        headers: {
          authorization: "Bearer internal-gateway-key",
          [CLIENT_SESSION_ID_HEADER]: "ses_1",
        },
      });
      const [input, init] = upstream.mock.calls[0] ?? [];
      if (input === undefined) {
        throw new Error("the gateway never reached the provider");
      }
      const request = new Request(input, init);
      expect(request.url).toBe(expected);
      expect(request.headers.get("authorization")).toBe("Bearer opencode-key");
      expect(request.headers.get("x-api-key")).toBe("opencode-key");
      expect(request.headers.get("x-goog-api-key")).toBe("opencode-key");
      expect(request.headers.get("x-opencode-session")).toBe("ses_1");
    },
  );
});
