import { describe, expect, it } from "vitest";

import { injectShimScript } from "./inject-shim-script";

const SHIM = "<!--shim-->";

describe("injectShimScript", () => {
  it.each([
    {
      body: "<html><head></head><body></body></html>",
      expected: "<html><head><!--shim--></head><body></body></html>",
      label: "plain head",
    },
    {
      body: '<html><head lang="en"></head><body></body></html>',
      expected: '<html><head lang="en"><!--shim--></head><body></body></html>',
      label: "head with attributes",
    },
    {
      body: "<HTML><HEAD></HEAD><BODY></BODY></HTML>",
      expected: "<HTML><HEAD><!--shim--></HEAD><BODY></BODY></HTML>",
      label: "uppercase head",
    },
    {
      body: "<html><body>hi</body></html>",
      expected: "<html><!--shim--><body>hi</body></html>",
      label: "no head",
    },
    {
      body: "<html>hi</html>",
      expected: "<html><!--shim-->hi</html>",
      label: "no head or body",
    },
    {
      body: "<!doctype html>\n<p>hi</p>",
      expected: "<!doctype html><!--shim-->\n<p>hi</p>",
      label: "doctype only",
    },
    {
      body: "<p>hi</p>",
      expected: "<!--shim--><p>hi</p>",
      label: "bare fragment",
    },
    {
      body: "<head></head><head></head>",
      expected: "<head><!--shim--></head><head></head>",
      label: "first head only",
    },
  ])("injects into $label", ({ body, expected }) => {
    expect(injectShimScript(body, SHIM)).toBe(expected);
  });
});
