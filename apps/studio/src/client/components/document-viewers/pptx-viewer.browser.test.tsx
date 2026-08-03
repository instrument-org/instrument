import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

// The question here is which of three stylesheets wins, so all three are loaded
// exactly as the app loads them and the answers are read off the cascade.
import "../../styles/globals.css";

import "@extend-ai/react-pptx/styles.css";

import "./pptx-viewer.css";

// The library's own palette, which nothing in Studio's theme should resolve to.
const PAPER = "rgb(248, 245, 238)";
const STAGE = "rgb(216, 210, 200)";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

const styleOf = (container: Element, selector: string) => {
  const element = container.querySelector(selector);
  if (!element) {
    throw new Error(`${selector} did not render`);
  }
  return getComputedStyle(element);
};

describe("pptx viewer theming", () => {
  it("leaves the library's own chrome in place where the viewer's class is absent", async () => {
    const { container } = await render(
      <div className="rpv-root">
        <div className="rpv-stage" />
      </div>,
    );

    // Establishes that the library stylesheet is live in this document, so the
    // assertions below are about the override rather than about a sheet that
    // never loaded.
    expect(styleOf(container, ".rpv-root").borderTopWidth).toBe("1px");
    expect(styleOf(container, ".rpv-root").backgroundColor).toBe(PAPER);
    expect(styleOf(container, ".rpv-stage").backgroundColor).toBe(STAGE);
  });

  it("outranks a utility class, which is why the override is a stylesheet", async () => {
    const { container } = await render(
      <div className="rpv-root bg-muted/40" />,
    );

    expect(styleOf(container, ".rpv-root").backgroundColor).toBe(PAPER);
  });

  it("drops the border and the fixed palette under the viewer's class", async () => {
    const { container } = await render(
      <div className="pptx-viewer rpv-root">
        <div className="rpv-stage" />
        <div className="rpv-status" />
      </div>,
    );

    expect(styleOf(container, ".rpv-root").borderTopWidth).toBe("0px");
    expect(styleOf(container, ".rpv-root").backgroundColor).not.toBe(PAPER);
    expect(styleOf(container, ".rpv-stage").backgroundColor).toBe(TRANSPARENT);
    // The overlay covers a slide that may still be on screen, so unlike the
    // stage it stays opaque.
    expect(styleOf(container, ".rpv-status").backgroundColor).not.toBe(STAGE);
    expect(styleOf(container, ".rpv-status").backgroundColor).not.toBe(
      TRANSPARENT,
    );
  });
});
