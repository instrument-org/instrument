import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { type AIGatewayEnv } from "../types";
import { gatewayErrorHandler } from "./error-handler";

describe("gatewayErrorHandler", () => {
  it("answers a throw with the cause in the body and reports it", async () => {
    const captureException = vi.fn();
    const gateway = new Hono<AIGatewayEnv>().basePath("/gateway");
    gateway.onError(gatewayErrorHandler);
    gateway.get("/boom", () => {
      throw new TypeError(
        "RequestInit: duplex option is required when sending a body.",
      );
    });
    // Mounted the way the workspace server mounts it: a middleware on the host
    // supplies the variables, and route() carries the sub-app's error handler.
    const host = new Hono<AIGatewayEnv>();
    host.use("/gateway/*", async (c, next) => {
      c.set("captureException", captureException);
      await next();
    });
    host.route("/", gateway);

    const response = await host.request("/gateway/boom");

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchInlineSnapshot(`
      {
        "error": {
          "message": "RequestInit: duplex option is required when sending a body.",
          "type": "gateway_error",
        },
        "type": "error",
      }
    `);
    expect(captureException).toHaveBeenCalledWith(expect.any(TypeError), {
      scopes: ["ai-gateway"],
    });
  });
});
