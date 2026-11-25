import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  AccessDeniedError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { describe, expect, it } from "vitest";

import { describeSignInFailure } from "./oauth-flow";

describe("describeSignInFailure", () => {
  it("says a refused registration cannot start, with what the server said", () => {
    expect(
      describeSignInFailure(new ServerError("anything"), {
        error: "invalid_redirect_uri",
        said: "Redirect URI is not supported.",
        status: 400,
      }),
    ).toMatchInlineSnapshot(
      `"the server refuses to register Instrument as a client (HTTP 400, invalid_redirect_uri), as servers that take only clients they approved in advance do, so this sign-in cannot start. The server said: Redirect URI is not supported."`,
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
