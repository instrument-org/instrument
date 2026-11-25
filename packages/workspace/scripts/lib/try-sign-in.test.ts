import { describe, expect, it } from "vitest";

import { trySignIn } from "./try-sign-in";

const ENDPOINT = "https://service.example/mcp";
const MANAGED = "https://service.example/register/abc";

/** A service that asks for a sign-in and answers a registration with `register`. */
function service(register: (body: unknown) => Response) {
  const calls: { body: unknown; method: string; path: string }[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ body, method, path: url.pathname });
    if (url.pathname === "/mcp") {
      return Promise.resolve(new Response(null, { status: 401 }));
    }
    if (url.pathname === "/register") {
      return Promise.resolve(register(body));
    }
    if (method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
      return Promise.resolve(
        Response.json({
          authorization_endpoint: "https://service.example/authorize",
          code_challenge_methods_supported: ["S256"],
          issuer: "https://service.example",
          registration_endpoint: "https://service.example/register",
          response_types_supported: ["code"],
          token_endpoint: "https://service.example/token",
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  return { calls, fetchFn };
}

describe("trySignIn", () => {
  it("says what a service that refuses the callback address answered", async () => {
    const { fetchFn } = service(() =>
      Response.json(
        {
          error: "invalid_redirect_uri",
          error_description: "Redirect URI is not supported.",
        },
        { status: 400 },
      ),
    );
    expect(await trySignIn(ENDPOINT, fetchFn)).toEqual({
      error: "invalid_redirect_uri",
      kind: "refused",
      said: "Redirect URI is not supported.",
      status: 400,
    });
  });

  it("registers as the app does, and takes the registration back where it can", async () => {
    const { calls, fetchFn } = service((body) =>
      Response.json(
        {
          ...(body as object),
          client_id: "abc",
          registration_access_token: "token",
          registration_client_uri: MANAGED,
        },
        { status: 201 },
      ),
    );
    expect(await trySignIn(ENDPOINT, fetchFn)).toEqual({
      kind: "accepted",
      removed: true,
    });
    expect(calls.find((call) => call.path === "/register")?.body)
      .toMatchInlineSnapshot(`
      {
        "application_type": "native",
        "client_name": "Instrument",
        "grant_types": [
          "authorization_code",
          "refresh_token",
        ],
        "redirect_uris": [
          "http://127.0.0.1:47893/auth/callback/app",
        ],
        "response_types": [
          "code",
        ],
        "token_endpoint_auth_method": "none",
      }
    `);
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/register/abc",
    });
  });

  it("says a registration was left behind when the service has no way to remove it", async () => {
    const { fetchFn } = service((body) =>
      Response.json({ ...(body as object), client_id: "abc" }, { status: 201 }),
    );
    expect(await trySignIn(ENDPOINT, fetchFn)).toEqual({
      kind: "accepted",
      removed: false,
    });
  });

  it("keeps a server fault apart from a refusal", async () => {
    const { fetchFn } = service(() => new Response("down", { status: 503 }));
    expect(await trySignIn(ENDPOINT, fetchFn)).toMatchObject({
      kind: "failed",
    });
  });
});
