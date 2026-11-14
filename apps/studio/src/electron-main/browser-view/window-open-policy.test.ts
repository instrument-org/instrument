import { type HandlerDetails } from "electron";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  agentPopupTabOf,
  guestWindowOpenHandler,
  newTabOpenOf,
  newWindowOpenOf,
  pageAddressOfLink,
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
      features: "popup",
      height: 720,
      name: "no size -> fallback size",
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
      guestWindowOpenHandler(
        details({ features: "popup", url: "http://example.test/oauth" }),
      ).action,
    ).toBe("allow");
  });

  it("opens no popup for a Shift-click, which names no features", () => {
    expect(guestWindowOpenHandler(details({})).action).toBe("deny");
  });
});

describe("newWindowOpenOf", () => {
  it.each([
    {
      expected: { url: "https://example.com/next" },
      name: "a Shift-click to the web",
      overrides: { url: "https://example.com/next" },
    },
    {
      expected: null,
      name: "a popup, which names its size",
      overrides: { features: "width=480,height=640" },
    },
    {
      expected: null,
      name: "a named window",
      overrides: { frameName: "signin" },
    },
    {
      expected: null,
      name: "a tab-open",
      overrides: { disposition: "foreground-tab" as const },
    },
    {
      expected: null,
      name: "a file from a web page",
      overrides: { url: "file:///etc/passwd" },
    },
  ])("opens a window for $name: $expected", ({ expected, overrides }) => {
    expect(newWindowOpenOf(details(overrides), "https://example.com/")).toEqual(
      expected,
    );
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

describe("newTabOpenOf", () => {
  const FILE_PAGE = "file:///Users/me/site/a.html";

  it.each([
    {
      expected: { background: false, url: "https://example.com/" },
      from: "https://example.org/",
      name: "a target=_blank link, in front",
      overrides: { disposition: "foreground-tab", url: "https://example.com/" },
    },
    {
      expected: { background: true, url: "https://example.com/" },
      from: FILE_PAGE,
      name: "a middle click, behind",
      overrides: { disposition: "background-tab", url: "https://example.com/" },
    },
    {
      expected: { background: true, url: "file:///Users/me/site/b.html" },
      from: FILE_PAGE,
      name: "a file a page on the computer links to",
      overrides: {
        disposition: "background-tab",
        url: "file:///Users/me/site/b.html",
      },
    },
    {
      expected: null,
      from: "https://example.org/",
      name: "a file a web page links to",
      overrides: { disposition: "foreground-tab", url: "file:///etc/hosts" },
    },
    {
      expected: null,
      from: FILE_PAGE,
      name: "a sign-in popup",
      overrides: { disposition: "new-window" },
    },
  ] satisfies {
    expected: null | { background: boolean; url: string };
    from: string;
    name: string;
    overrides: Partial<HandlerDetails>;
  }[])("reads $name", ({ expected, from, overrides }) => {
    expect(newTabOpenOf(details(overrides), from)).toEqual(expected);
  });
});

describe("agentPopupTabOf", () => {
  it.each([
    {
      expected: "https://accounts.google.com/o/oauth2/auth",
      name: "a popup to the web",
      overrides: { features: "width=500,height=600" },
    },
    {
      expected: "https://help.example.com/chat",
      name: "a named popup with no features",
      overrides: { frameName: "help", url: "https://help.example.com/chat" },
    },
    {
      expected: null,
      name: "a Shift-click, which is the person's",
      overrides: {},
    },
    {
      expected: null,
      name: "a target=_blank link",
      overrides: { disposition: "foreground-tab" },
    },
    {
      expected: null,
      name: "a popup to a file",
      overrides: { features: "popup", url: "file:///etc/hosts" },
    },
  ] satisfies {
    expected: null | string;
    name: string;
    overrides: Partial<HandlerDetails>;
  }[])("reads $name", ({ expected, overrides }) => {
    expect(agentPopupTabOf(details(overrides))).toBe(expected);
  });
});

describe("pageAddressOfLink", () => {
  it.each([
    {
      expected: "file:///Users/mac-user/wireframes/a%20b.html",
      url: "instrument://file/~/wireframes/a%20b.html",
    },
    {
      expected: "file:///Users/mac-user/notes/a.md",
      url: "instrument://file//Users/mac-user/notes/a.md",
    },
    {
      expected: "file:///Users/mac-user/notes/a.md",
      url: "instrument://file/Users/mac-user/notes/a.md",
    },
    {
      expected: "file:///Users/mac-user/a.html",
      url: "instrument://file/~/notes/../a.html",
    },
    { expected: "instrument://chat/abc", url: "instrument://chat/abc" },
    { expected: "https://example.com/", url: "https://example.com/" },
  ])("follows $url at $expected", ({ expected, url }) => {
    expect(pageAddressOfLink(url, "/Users/mac-user", path.posix)).toBe(
      expected,
    );
  });

  it("reads a Windows path with its drive", () => {
    expect(
      pageAddressOfLink(
        "instrument://file/~/Documents/a.html",
        "C:\\Users\\windows-user",
        path.win32,
      ),
    ).toBe("file:///C:/Users/windows-user/Documents/a.html");
  });

  it("opens an app link to a file in a tab, as the page's link to the file", () => {
    const url = pageAddressOfLink(
      "instrument://file/~/wireframes/a.html",
      "/Users/mac-user",
      path.posix,
    );
    expect(
      newTabOpenOf(
        details({ disposition: "background-tab", url }),
        "file:///Users/mac-user/visual-answers/page.html",
      ),
    ).toEqual({
      background: true,
      url: "file:///Users/mac-user/wireframes/a.html",
    });
  });
});
