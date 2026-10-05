import { describe, expect, it } from "vitest";

import { soleColor, themeHalves } from "./icon-contrast";

describe("soleColor", () => {
  it.each([
    ['<svg><path fill="#282C33" d="M0"/></svg>', "#282c33"],
    ['<svg><path fill="#fff" d="M0"/></svg>', "#ffffff"],
    ['<svg fill="black"><path d="M0"/></svg>', "#000000"],
    ['<svg><path style="fill: rgb(228,67,50)" d="M0"/></svg>', "#e44332"],
    // A shape with no fill anywhere draws black.
    ['<svg><path d="M0"/></svg>', "#000000"],
    // Notion: a white sheet with black ink on it is two colors.
    ['<svg><path fill="#FFF" d="M0"/><path d="M1"/></svg>', undefined],
    [
      '<svg><path fill="#f00" d="M0"/><path fill="#00f" d="M1"/></svg>',
      undefined,
    ],
    ['<svg><path fill="none" stroke="#000" d="M0"/></svg>', "#000000"],
    // A gradient with no stops in the file is nothing this can read.
    ['<svg><path fill="url(#g)" d="M0"/></svg>', undefined],
  ])("%s → %s", (svg, color) => {
    expect(soleColor(svg)).toBe(color);
  });
});

describe("themeHalves", () => {
  it("makes a white dark half for a black mark and keeps the light one", () => {
    expect(
      themeHalves('<svg viewBox="0 0 1 1"><path fill="#000000" d="M0"/></svg>'),
    ).toMatchInlineSnapshot(`
      {
        "dark": "<svg fill="#ffffff" viewBox="0 0 1 1"><path fill="#ffffff" d="M0"/></svg>",
        "light": "<svg viewBox="0 0 1 1"><path fill="#000000" d="M0"/></svg>",
      }
    `);
  });

  it("fills the root for a mark that relied on default black", () => {
    expect(
      themeHalves('<svg viewBox="0 0 1 1"><path d="M0"/></svg>')?.dark,
    ).toMatchInlineSnapshot(
      `"<svg fill="#ffffff" viewBox="0 0 1 1"><path d="M0"/></svg>"`,
    );
  });

  it("makes a black light half for a pale mark", () => {
    expect(themeHalves('<svg><path fill="#FDDD35" d="M0"/></svg>'))
      .toMatchInlineSnapshot(`
      {
        "dark": "<svg><path fill="#FDDD35" d="M0"/></svg>",
        "light": "<svg fill="#000000"><path fill="#000000" d="M0"/></svg>",
      }
    `);
  });

  it.each([
    ['<svg><path fill="#e44332" d="M0"/></svg>'],
    // Brand colors that are soft on one ground but still read keep their color.
    ['<svg><path fill="#1ed760" d="M0"/></svg>'],
    ['<svg><path fill="#533afd" d="M0"/></svg>'],
    ['<svg><path fill="#f00" d="M0"/><path fill="#000" d="M1"/></svg>'],
  ])("leaves %s alone", (svg) => {
    expect(themeHalves(svg)).toBeUndefined();
  });
});
