import { describe, expect, it } from "vitest";

import { isAuthRedirect } from "./extension-identity";

const ID = "kgdhhkahbiejbhlbmpklknjagbflmfid";

describe("isAuthRedirect", () => {
  it.each([
    [`https://${ID}.chromiumapp.org/`, true],
    [`https://${ID}.chromiumapp.org/callback#access_token=abc`, true],
    [`http://${ID}.chromiumapp.org/`, false],
    [`https://other.chromiumapp.org/`, false],
    [`https://${ID}.chromiumapp.org.example.com/`, false],
    ["https://accounts.example.com/authorize", false],
    ["not a url", false],
  ])("%s is the extension's answer: %s", (url, expected) => {
    expect(isAuthRedirect(url, ID)).toBe(expected);
  });
});
