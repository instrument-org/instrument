import { beforeEach, describe, expect, it, vi } from "vitest";

const openExternal = vi.fn();

vi.mock("./open-external", () => ({
  openExternal: (url: string) => {
    openExternal(url);
  },
}));

vi.mock("./urls", () => ({
  studioURL: () => "file:///Applications/Instrument.app/renderer/index.html",
}));

const { guardNavigation, isStudioURL } = await import("./guard-navigation");

// Stands in for a window's web contents: records the `will-navigate` listener
// so a case can drive a navigation through it and see what the window decided.
function fakeContents() {
  let navigate:
    | ((event: { preventDefault: () => void }, url: string) => void)
    | undefined;
  return {
    contents: {
      on: (event: string, listener: typeof navigate) => {
        if (event === "will-navigate") {
          navigate = listener;
        }
      },
    },
    go(url: string) {
      let prevented = false;
      navigate?.(
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        url,
      );
      return prevented;
    },
  };
}

describe("isStudioURL", () => {
  it.each([
    [
      "the renderer itself",
      "file:///Applications/Instrument.app/renderer/index.html",
      true,
    ],
    // A hash route is a same-document navigation the window never asks about,
    // but it must read as the app either way.
    [
      "a hash route",
      "file:///Applications/Instrument.app/renderer/index.html#/tasks/1",
      true,
    ],
    ["a web page", "https://mermaid.js.org/", false],
    // Same "null" origin as the packaged renderer, so only the path tells them
    // apart.
    ["another file on disk", "file:///Users/someone/.ssh/id_rsa", false],
    ["a scheme that runs something", "javascript:alert(1)", false],
    ["nonsense", "not a url", false],
  ])("%s -> %s", (_case, url, expected) => {
    expect(isStudioURL(url)).toBe(expected);
  });
});

describe("guardNavigation", () => {
  beforeEach(() => {
    openExternal.mockClear();
  });

  it("lets the window navigate itself", () => {
    const window = fakeContents();
    guardNavigation(window.contents as never);

    expect(
      window.go("file:///Applications/Instrument.app/renderer/index.html"),
    ).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("refuses to leave the app, and opens the link in the browser instead", () => {
    // The whole point: a link on the page — from a markdown message, a diagram
    // that declared one, an HTML artifact — must not be able to replace the
    // app with a web page in the same window.
    const window = fakeContents();
    guardNavigation(window.contents as never);

    expect(window.go("https://mermaid.js.org/")).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://mermaid.js.org/");
  });
});
