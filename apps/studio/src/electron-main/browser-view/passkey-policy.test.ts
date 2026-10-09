import { describe, expect, it } from "vitest";

import { withPasskeysOff } from "./passkey-policy";

describe("withPasskeysOff", () => {
  it("adds the policy where the site sent none", () => {
    expect(withPasskeysOff({ "content-type": ["text/html"] }))
      .toMatchInlineSnapshot(`
      {
        "content-type": [
          "text/html",
        ],
        "permissions-policy": [
          "publickey-credentials-get=(), publickey-credentials-create=()",
        ],
      }
    `);
  });

  it("follows the site's own policy, under the site's spelling", () => {
    expect(
      withPasskeysOff({
        "Permissions-Policy": ["publickey-credentials-get=(self)"],
      }),
    ).toMatchInlineSnapshot(`
      {
        "Permissions-Policy": [
          "publickey-credentials-get=(self)",
          "publickey-credentials-get=(), publickey-credentials-create=()",
        ],
      }
    `);
  });

  it("follows a policy sent as one string", () => {
    expect(
      withPasskeysOff({
        "permissions-policy": "publickey-credentials-create=*",
      }),
    ).toMatchInlineSnapshot(`
      {
        "permissions-policy": [
          "publickey-credentials-create=*",
          "publickey-credentials-get=(), publickey-credentials-create=()",
        ],
      }
    `);
  });
});
