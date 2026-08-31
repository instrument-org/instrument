import {
  AI_GATEWAY_API_PATH,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { Hono } from "hono";
import { proxy } from "hono/proxy";

import { CLIENT_SESSION_ID_HEADER, PROVIDERS_PATH } from "../constants";
import { apiURL } from "../lib/providers/api-url";
import { setProviderAuthHeaders } from "../lib/providers/set-auth-headers";
import { setAttributionHeaders } from "../lib/set-attribution-headers";
import { setClientHeaders } from "../lib/set-client-headers";
import { SlashPrefixedPathSchema } from "../schemas/slash-prefixed-path";
import { type AIGatewayEnv } from "../types";

export const providerApp = new Hono<AIGatewayEnv>();

providerApp.all("/:providerConfigId/*", async (context) => {
  const { providerConfigId } = context.req.param();
  const configs = context.var.getAIProviderConfigs();
  if (configs.length === 0) {
    return context.json({ error: "No AI providers have been configured" }, 500);
  }
  const config = configs.find((c) => c.id === providerConfigId);

  if (!config) {
    return context.json(
      { error: `No provider config found for ${providerConfigId}` },
      500,
    );
  }

  const url = new URL(context.req.raw.url);
  const path = url.pathname.replace(
    [AI_GATEWAY_API_PATH, PROVIDERS_PATH, `/${providerConfigId}`].join(""),
    "",
  );

  const pathResult = SlashPrefixedPathSchema.safeParse(path);
  if (!pathResult.success) {
    return context.json({ error: "Invalid path" }, 400);
  }

  const targetUrl = new URL(apiURL({ config, path: pathResult.data }));
  targetUrl.search = url.search;

  const headers = new Headers(context.req.raw.headers);
  // Held aside and re-set below for our own provider, the same gate the client
  // metadata goes through.
  const sessionId = headers.get(CLIENT_SESSION_ID_HEADER);
  headers.delete(CLIENT_SESSION_ID_HEADER);
  setAttributionHeaders(headers, config.type);
  setProviderAuthHeaders(headers, config);
  if (config.type === OUR_PROVIDER_CONFIG.type) {
    setClientHeaders(headers, context.var.clientInfo, sessionId);
  }

  return proxy(targetUrl.toString(), {
    body: context.req.raw.body,
    headers,
    method: context.req.raw.method,
  });
});
