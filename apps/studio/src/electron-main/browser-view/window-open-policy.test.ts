import { type HandlerDetails } from "electron";
import { describe, expect, it } from "vitest";

import {
  guestWindowOpenHandler,
  sameTabNavigationUrl,
} from "./window-open-policy";

function details(overrides: Partial<HandlerDetails>): HandlerDetails {
  return {
    disposition: "new-window",
    features: "",
    frameName: "",
    referrer: { policy: "no-referrer-when-downgrade", url: "" },
    url: "https://accounts.google.com/o/oauth2/auth",
    ...overrides,
  };
}

describe("guestWindowOpenHandler", () => {
  const denyCases: { name: string; overrides: Partial<HandlerDetails> }[] = [
    {
      name: "target=_blank foreground tab",
      overrides: { disposition: "foreground-tab" },
    },
    { name: "background tab", overrides: { disposition: "background-tab" } },
    { name: "default disposition", overrides: { disposition: "default" } },
    { name: "other disposition", overrides: { disposition: "other" } },
    { name: "file URL", overrides: { url: "file:///etc/passwd" } },
    { name: "javascript URL", overrides: { url: "javascript:alert(1)" } },
    { name: "malformed URL", overrides: { url: "not a url" } },
  ];

  it.each(denyCases)("denies $name", ({ overrides }) => {
    expect(guestWindowOpenHandler(details(overrides)).action).toBe("deny");
  });

  const allowCases: {
    features: string;
    height: number;
    name: string;
    width: number;
  }[] = [
    {
      features: "",
      height: 720,
      name: "no features -> fallback size",
      width: 520,
    },
    {
      features: "width=480,height=640",
      height: 640,
      name: "explicit size",
      width: 480,
    },
    {
      features: "width=10,height=10",
      height: 240,
      name: "clamps below minimum",
      width: 240,
    },
    {
      features: "width=5000,height=5000",
      height: 1600,
      name: "clamps above maximum",
      width: 1600,
    },
  ];

  it.each(allowCases)(
    "allows a new-window popup: $name",
    ({ features, height, width }) => {
      const result = guestWindowOpenHandler(details({ features }));
      expect(result.action).toBe("allow");
      expect(result.overrideBrowserWindowOptions).toMatchObject({
        autoHideMenuBar: true,
        height,
        width,
      });
    },
  );

  it("allows plain http popups", () => {
    expect(
      guestWindowOpenHandler(details({ url: "http://example.test/oauth" }))
        .action,
    ).toBe("allow");
  });
});

describe("sameTabNavigationUrl", () => {
  const navigateCases: {
    disposition: HandlerDetails["disposition"];
    name: string;
  }[] = [
    { disposition: "foreground-tab", name: "a target=_blank link" },
    { disposition: "background-tab", name: "a cmd- or middle-click" },
  ];

  it.each(navigateCases)("navigates $name in place", ({ disposition }) => {
    expect(
      sameTabNavigationUrl(
        details({
          disposition,
          url: "https://www.amazon.com/gp/product/B0B8F29SP8",
        }),
      ),
    ).toBe("https://www.amazon.com/gp/product/B0B8F29SP8");
  });

  const ignoredCases: { name: string; overrides: Partial<HandlerDetails> }[] = [
    {
      name: "an allowed popup, which opens its own window",
      overrides: { disposition: "new-window" },
    },
    { name: "the default disposition", overrides: { disposition: "default" } },
    { name: "another disposition", overrides: { disposition: "other" } },
    {
      name: "a file URL",
      overrides: { disposition: "foreground-tab", url: "file:///etc/passwd" },
    },
    {
      name: "a javascript URL",
      overrides: {
        disposition: "foreground-tab",
        url: "javascript:alert(1)",
      },
    },
    {
      name: "a malformed URL",
      overrides: { disposition: "foreground-tab", url: "not a url" },
    },
  ];

  it.each(ignoredCases)("leaves $name alone", ({ overrides }) => {
    expect(sameTabNavigationUrl(details(overrides))).toBeNull();
  });
});
