import { describe, expect, it } from "vitest";

import { instrumentAddressOf, screenOfHref } from "./instrument-screens";

describe("built-in pages", () => {
  it.each([
    ["/settings", { name: "settings" }, "instrument://settings/general"],
    [
      "/settings/providers?setting=x",
      { name: "settings", part: "providers" },
      "instrument://settings/providers",
    ],
    ["/history?q=roof", { name: "history" }, "instrument://screen/history"],
    ["/memory", { name: "memory" }, "instrument://screen/memory"],
    ["/skills", { name: "skills" }, "instrument://screen/skills"],
    ["/activity", { name: "activity" }, "instrument://screen/activity"],
    ["/apps", { name: "apps" }, "instrument://screen/apps"],
    ["/files", { name: "files" }, "instrument://screen/files"],
  ])("%s is %j at %s", (href, screen, address) => {
    expect(screenOfHref(href)).toEqual(screen);
    expect(instrumentAddressOf(href)).toBe(address);
  });

  it.each(["/settings/theme", "/memory/roofs", "/files/Users/x", "/chats/c"])(
    "%s is no built-in page",
    (href) => {
      expect(screenOfHref(href)).toBeUndefined();
    },
  );
});
