import { describe, expect, it } from "vitest";

import { settingsHrefOf } from "./settings-href";

describe("settingsHrefOf", () => {
  it.each([
    [{}, "/settings"],
    [{ tab: "Providers" }, "/settings/providers"],
    [{ tab: "Memory" }, "/settings/memory"],
    [{ memory: "roofs", tab: "Memory" }, "/settings/memory?memory=roofs"],
    [{ tab: "Skills" }, "/settings/skills"],
    [{ setting: "theme" }, "/settings/general?setting=theme"],
    [{ setting: "memory-import" }, "/settings/memory?setting=memory-import"],
    [{ setting: "no such setting" }, "/settings/general?q=no%20such%20setting"],
    [{ diagnosticLog: true, tab: "General" }, "/settings/general?log=true"],
    [
      { providerUsage: "claude-account", tab: "Providers" },
      "/settings/providers?usage=claude-account",
    ],
  ] as const)("%j opens at %s", (request, href) => {
    expect(settingsHrefOf(request)).toBe(href);
  });
});
