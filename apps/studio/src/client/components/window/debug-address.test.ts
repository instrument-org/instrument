import { APP_PROTOCOL } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { debugAddressOf, debugHrefOf } from "./debug-address";

describe("a debug page's address", () => {
  it.each([
    ["the landing page", "/debug", "instrument://debug"],
    ["the landing page with a slash", "/debug/", "instrument://debug"],
    ["a page", "/debug/app-states", "instrument://debug/app-states"],
    [
      "a component's page",
      "/debug/components/colors",
      "instrument://debug/components/colors",
    ],
    [
      "a page with its search",
      "/debug/components/transcript?scenario=long-reply",
      "instrument://debug/components/transcript?scenario=long-reply",
    ],
  ])("names %s", (_case, href, address) => {
    expect(debugAddressOf(href)).toBe(address);
    expect(debugHrefOf(address)).toBe(href.replace(/\/$/, ""));
  });

  it.each([
    ["a built-in page", "/settings/general"],
    ["a path that only starts the same", "/debugger"],
    ["a chat", "/chats/2026-10-02-trip"],
  ])("names nothing for %s", (_case, href) => {
    expect(debugAddressOf(href)).toBeUndefined();
  });

  it.each([
    [
      "the build's own scheme",
      `${APP_PROTOCOL}://debug/billing`,
      "/debug/billing",
    ],
    ["a host in capitals", "instrument://Debug/billing", "/debug/billing"],
    ["a trailing slash", "instrument://debug/billing/", "/debug/billing"],
  ])("opens %s", (_case, address, href) => {
    expect(debugHrefOf(address)).toBe(href);
  });

  it.each([
    ["a screen's address", "instrument://screen/settings"],
    ["a web address", "https://debug/billing"],
    ["words", "debug"],
  ])("opens nothing for %s", (_case, address) => {
    expect(debugHrefOf(address)).toBeUndefined();
  });
});
