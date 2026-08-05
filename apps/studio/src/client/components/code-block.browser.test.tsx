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

// The wrapper that holds those controls also sits between the prose root and
// the block, which is enough to defeat Typography's first/last-child margin
// reset: it lands on the wrapper, and the block's own margin collapses through
// it and out of the blob. What that looks like is a message ending in code
// carrying a band of dead space under it, so the rule that reaches through the
// wrapper is measured here rather than read off a class list.
describe("code block spacing in prose", () => {
  const PROSE_CLASS =
    "prose prose-custom max-w-none text-sm/relaxed dark:prose-invert prose-pre:text-sm";

  const marginsOf = (element: Element) => {
    const style = globalThis.getComputedStyle(element);
    return { bottom: style.marginBottom, top: style.marginTop };
  };

  // Distance between the blob's own box and the code block at each edge, which
  // is what a collapsed-out margin adds to. The blob has to be measured as the
  // flex item a message renders it as: in a plain block parent the margin
  // escapes the blob as well, and every edge reads as 0 whether or not the
  // reset is doing anything.
  const edgeGaps = (root: Element) => {
    const blocks = [...root.querySelectorAll("pre")];
    const rootRect = root.getBoundingClientRect();
    return {
      bottom: Math.round(
        rootRect.bottom - blocks.at(-1)!.getBoundingClientRect().bottom,
      ),
      top: Math.round(blocks[0]!.getBoundingClientRect().top - rootRect.top),
    };
  };

  // Highlighted code arrives as markup one level below the wrapper; the
  // plain-text fallback is a bare `pre` inside it. Both are what ships.
  it.each([
    { name: "highlighted", wrap: (pre: React.ReactNode) => <div>{pre}</div> },
    { name: "plain", wrap: (pre: React.ReactNode) => pre },
  ])("has no dead space at either edge ($name)", async ({ wrap }) => {
    const block = (label: string) => (
      <CodeWithCopy content={label}>
        {wrap(
          <pre>
            <code>{label}</code>
          </pre>,
        )}
      </CodeWithCopy>
    );

    const screen = await render(
      <div className="flex flex-col items-start">
        <div className={PROSE_CLASS} data-testid="prose">
          {block("leading")}
          <p>Body.</p>
          {block("trailing")}
        </div>
      </div>,
    );

    expect(edgeGaps(screen.getByTestId("prose").element())).toEqual({
      bottom: 0,
      top: 0,
    });
  });

  it("keeps the margins that separate a block from the prose around it", async () => {
    const screen = await render(
      <div className={PROSE_CLASS}>
        <p>Before.</p>
        <CodeWithCopy content="middle">
          <pre>
            <code>middle</code>
          </pre>
        </CodeWithCopy>
        <p>After.</p>
      </div>,
    );

    const { bottom, top } = marginsOf(screen.container.querySelector("pre")!);
    expect(Number.parseFloat(top)).toBeGreaterThan(0);
    expect(Number.parseFloat(bottom)).toBeGreaterThan(0);
  });

  // The edge reset keys off the wrapper being a direct child of the blob, so a
  // list that leads a message keeps the spacing around code inside its items.
  it("keeps the margins on a block nested in a leading list", async () => {
    const screen = await render(
      <div className={PROSE_CLASS}>
        <ul>
          <li>
            Step one.
            <CodeWithCopy content="nested">
              <pre>
                <code>nested</code>
              </pre>
            </CodeWithCopy>
          </li>
        </ul>
      </div>,
    );

    const { top } = marginsOf(screen.container.querySelector("pre")!);
    expect(Number.parseFloat(top)).toBeGreaterThan(0);
  });
});
