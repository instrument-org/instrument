import "@/client/styles/globals.css";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CodeWithCopy } from "./code-block";
import { ImageViewer } from "./image-viewer";

// A 1x1 transparent gif, which is enough to get the viewer past its load gate.
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// A solid fill computes to `rgb(r, g, b)`, but the two ways of asking for a
// translucent one land in different notations: a `/80` opacity modifier comes
// back as `oklab(l a b / 0.8)`, while a token that is itself translucent comes
// back as `rgba(r, g, b, a)`. Reading only one of them is how a control that
// looks solid in a class list turns out not to be.
const alphaOf = (element: Element): number => {
  const color = globalThis.getComputedStyle(element).backgroundColor;
  const slashed = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
  if (slashed?.[1]) {
    return Number(slashed[1]) / (slashed[2] ? 100 : 1);
  }
  const parts = color.replaceAll(/^rgba?\(|\)$/g, "").split(",");
  return parts.length > 3 ? Number(parts[3]) : 1;
};

// These controls float over whatever the block is showing — a diagram, an
// image, syntax-highlighted code. Anything less than a solid fill lets that
// content read straight through the button sitting on top of it.

describe("block toolbar", () => {
  it.each(["light", "dark"] as const)(
    "stays opaque on hover in %s",
    async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");

      const screen = await render(
        <div className="bg-background">
          <CodeWithCopy content="const answer = 42;">
            <pre>
              <code>const answer = 42;</code>
            </pre>
          </CodeWithCopy>
        </div>,
      );

      const button = screen.getByRole("button").element();
      await screen.getByRole("button").hover();

      expect(alphaOf(button)).toBe(1);
    },
  );

  it.each(["light", "dark"] as const)(
    "keeps the image viewer's controls opaque in %s",
    async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");

      const screen = await render(
        <div style={{ height: 300, width: 300 }}>
          <ImageViewer
            filename="pixel.gif"
            onError={() => {
              throw new Error("the pixel should load");
            }}
            url={PIXEL}
          />
        </div>,
      );

      // The controls are held back until there is an image to zoom.
      const controls = await vi.waitFor(() => {
        const zoomIn = screen.container.querySelector("button")?.parentElement;
        if (!zoomIn) {
          throw new Error("controls did not render");
        }
        return zoomIn;
      });

      expect(alphaOf(controls)).toBe(1);
    },
  );
});
