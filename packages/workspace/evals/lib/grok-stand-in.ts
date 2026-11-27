/**
 * A Grok plan for a run, on loopback: the gateway reaches it as it reaches
 * xAI for a signed-in Grok account, and every search X's tools make there
 * answers with the case's posts, cited as x_search cites what it found. A run
 * has no real plan to search with, and a real search finds different posts
 * every day.
 */
import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  GROK_ACCOUNT_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import http from "node:http";

export interface StandInPost {
  /** When it was posted, YYYY-MM-DD. */
  date: string;
  handle: string;
  /** Its status id, a number, as its link names it. */
  id: string;
  text: string;
}

/**
 * Serves the plan for the life of the process and answers the Grok account
 * config that reaches it. A search of posts gets `posts`, and a search of
 * accounts finds none.
 */
export async function serveGrokStandIn(
  posts: StandInPost[],
): Promise<AIGatewayProviderConfig.Type> {
  const answer = JSON.stringify({
    id: "resp_stand_in",
    model: "grok-stand-in",
    object: "response",
    output: [
      {
        arguments: "{}",
        id: "xs_stand_in",
        name: "x_keyword_search",
        status: "completed",
        type: "x_search_call",
      },
      {
        content: [
          {
            annotations: posts.map((post) => ({
              type: "url_citation",
              url: `https://x.com/i/status/${post.id}`,
            })),
            text: JSON.stringify({
              accounts: [],
              posts: posts.map((post) => ({
                date: post.date,
                handle: post.handle,
                text: post.text,
                url: `https://x.com/${post.handle}/status/${post.id}`,
              })),
            }),
            type: "output_text",
          },
        ],
        id: "msg_stand_in",
        role: "assistant",
        status: "completed",
        type: "message",
      },
    ],
    status: "completed",
    usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 },
  });
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://stand-in");
    // The account's catalog, read once its config is known: empty, so a
    // search runs on xAI's alias for its newest Grok.
    if (request.method === "GET" && pathname.endsWith("/language-models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [] }));
      return;
    }
    if (request.method === "POST" && pathname.endsWith("/responses")) {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(answer);
      });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end(`The Grok stand-in has no ${pathname}`);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("The Grok stand-in has no port");
  }
  return {
    ...GROK_ACCOUNT_PROVIDER_CONFIG,
    apiKey: "grok-stand-in",
    baseURL: `http://127.0.0.1:${String(address.port)}`,
    cacheIdentifier: "grok-stand-in",
    id: AIProviderConfigIdSchema.parse("grok-stand-in"),
  };
}
