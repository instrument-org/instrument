import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  AccessDeniedError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { describe, expect, it } from "vitest";

import { describeSignInFailure } from "./oauth-flow";

describe("describeSignInFailure", () => {
  // The SDK's ServerError for a registration body that is not an OAuth error
  // object, as Figma's MCP server sends.
  it("says a refused registration takes only approved clients, then what the server said", () => {
    expect(
      describeSignInFailure(
        new ServerError(
          "HTTP 403: Invalid OAuth error response: SyntaxError. Raw body: Forbidden",
        ),
      ),
    ).toMatchInlineSnapshot(
      `"the server refuses to register a client from here (HTTP 403). It only accepts clients it has approved in advance, so this sign-in cannot be one; a web app (the user signs in to the site in Instrument's browser), or a server the service ships for this machine, is the way in. The server said: OAuth server_error: HTTP 403: Invalid OAuth error response: SyntaxError. Raw body: Forbidden"`,
    );
  });

  // A 403 from the MCP endpoint itself is not a refused registration.
  it("passes a 403 from the server's own endpoint through as it came", () => {
    expect(
      describeSignInFailure(
        new StreamableHTTPError(403, "Error POSTing to endpoint: no"),
      ),
    ).toMatchInlineSnapshot(
      `"HTTP 403: Streamable HTTP error: Error POSTing to endpoint: no"`,
    );
  });

  it("names the OAuth error code a server sent", () => {
    expect(
      describeSignInFailure(new AccessDeniedError("")),
    ).toMatchInlineSnapshot(`"OAuth access_denied"`);
  });
});
