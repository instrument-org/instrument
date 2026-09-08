import { type ErrorHandler } from "hono";

import { type AIGatewayEnv } from "../types";

/**
 * A throw anywhere in the gateway (the proxy unable to build its request, a
 * provider unreachable) would otherwise answer with Hono's bare
 * "Internal Server Error", and the client would retry it, log it, and show it
 * with the cause gone. The body carries the message in the shape the
 * workspace reads back out of an `APICallError`, which both SDK error schemas
 * accept, and the exception reaches the host's reporter.
 */
export const gatewayErrorHandler: ErrorHandler<AIGatewayEnv> = (error, c) => {
  c.var.captureException(error, { scopes: ["ai-gateway"] });
  return c.json(
    { error: { message: error.message, type: "gateway_error" }, type: "error" },
    500,
  );
};
