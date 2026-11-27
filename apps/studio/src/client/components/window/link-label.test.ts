import { describe, expect, it } from "vitest";

import { LINK_COLORS, linkColorOf, newLinkColor } from "./link-label";

describe("a link group's label color", () => {
  it("takes the first color no open group wears", () => {
    expect(newLinkColor([])).toBe(LINK_COLORS[0]);
    expect(newLinkColor([LINK_COLORS[0], undefined, LINK_COLORS[1]])).toBe(
      LINK_COLORS[2],
    );
  });

  it("shares a color only once every color is worn, the least worn first", () => {
    const worn = [...LINK_COLORS, LINK_COLORS[0], LINK_COLORS[2]];
    expect(newLinkColor(worn)).toBe(LINK_COLORS[1]);
  });

  it("keeps the color a group was given, and takes one from the word without", () => {
    expect(linkColorOf("Side panel", "#123456")).toBe("#123456");
    expect(linkColorOf("Side panel", undefined)).toBe(
      linkColorOf("side PANEL", undefined),
    );
    expect(LINK_COLORS).toContain(linkColorOf("Side panel", undefined));
  });
});
