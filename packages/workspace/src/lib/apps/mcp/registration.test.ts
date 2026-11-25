import { registerClient } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it } from "vitest";

import { watchRegistration } from "./registration";

/** What a registration answered with `status` and `body` leaves behind, through the SDK itself. */
async function register(status: number, body: string) {
  const watched = watchRegistration(() =>
    Promise.resolve(new Response(body, { status })),
  );
  const thrown = await registerClient("https://service.example", {
    clientMetadata: { redirect_uris: ["http://127.0.0.1:1/auth/callback/app"] },
    fetchFn: watched.fetch,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  return { refusal: watched.refusal(), thrown };
}

describe("watchRegistration", () => {
  it("keeps a refusal the SDK reports as a server error", async () => {
    const { refusal, thrown } = await register(
      400,
      JSON.stringify({
        error: "invalid_redirect_uri",
        error_description: "Redirect URI is not supported.",
      }),
    );
    expect(thrown).toMatchObject({ errorCode: "server_error" });
    expect(refusal).toEqual({
      error: "invalid_redirect_uri",
      said: "Redirect URI is not supported.",
      status: 400,
    });
  });

  it("keeps a refusal whose body is not an OAuth error", async () => {
    const { refusal } = await register(403, "Forbidden");
    expect(refusal).toEqual({ said: "Forbidden", status: 403 });
  });

  it.each([429, 500, 503])(
    "takes HTTP %s as a passing failure",
    async (status) => {
      const { refusal, thrown } = await register(status, "later");
      expect(thrown).toBeDefined();
      expect(refusal).toBeUndefined();
    },
  );

  it("keeps nothing for a registration that went through", async () => {
    const { refusal, thrown } = await register(
      201,
      JSON.stringify({
        client_id: "abc",
        redirect_uris: ["http://127.0.0.1:1/auth/callback/app"],
      }),
    );
    expect(thrown).toBeUndefined();
    expect(refusal).toBeUndefined();
  });

  it("ignores a refusal of any other request", async () => {
    const watched = watchRegistration(() =>
      Promise.resolve(new Response("no", { status: 403 })),
    );
    await watched.fetch("https://service.example/mcp", {
      body: JSON.stringify({ method: "initialize" }),
      method: "POST",
    });
    expect(watched.refusal()).toBeUndefined();
  });
});
