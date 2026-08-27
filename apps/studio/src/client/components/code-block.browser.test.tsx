import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

import { CodeWithCopy, MarkdownCodeBlock } from "./code-block";
import { ImageViewer } from "./image-viewer";

// A block asks which theme to highlight against, and the real provider answers
// through an RPC round trip the browser project has no main process for. Every
// case here is about the box the block draws, which is the same box whether the
// code inside it came back highlighted or as the plain text it falls back to.
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    syntax: {
      highlightCode: {
        queryOptions: () => ({ queryFn: () => [], queryKey: ["highlight"] }),
      },
      supportedLanguages: {
        queryOptions: () => ({ queryFn: () => [], queryKey: ["languages"] }),
      },
    },
  },
}));

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

      const screen = await renderInBrowser(
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

      const screen = await renderInBrowser(
        <div style={{ height: 300, width: 300 }}>
          <ImageViewer
            file={{ filename: "pixel.gif", url: PIXEL }}
            onError={() => {
              throw new Error("the pixel should load");
            }}
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

// An unnamed `group-hover:` answers any hovered ancestor carrying `group`, not
// the nearest one, so a block sitting inside a message that groups itself for
// its own hover chrome would reveal its copy button from anywhere in that
// message. The toolbar names its group so the block itself is the only thing
// that can show it.
describe("block toolbar scope", () => {
  it("stays hidden while an outer group is hovered", async () => {
    const screen = await renderInBrowser(
      <div className="group">
        <p data-testid="prose">Prose above the block.</p>
        <CodeWithCopy content="const answer = 42;">
          <pre data-testid="block">
            <code>const answer = 42;</code>
          </pre>
        </CodeWithCopy>
      </div>,
    );

    const toolbar = screen.getByRole("button").element().parentElement;
    if (!toolbar) {
      throw new Error("the toolbar did not render");
    }

    await screen.getByTestId("prose").hover();
    expect(globalThis.getComputedStyle(toolbar).opacity).toBe("0");

    await screen.getByTestId("block").hover();
    expect(globalThis.getComputedStyle(toolbar).opacity).toBe("1");
  });
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

  const codeBlocksIn = (root: Element) => {
    const blocks = [...root.querySelectorAll("pre")];
    const first = blocks.at(0);
    const last = blocks.at(-1);
    if (!first || !last) {
      throw new Error("no code block rendered");
    }
    return { first, last };
  };

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
    const { first, last } = codeBlocksIn(root);
    const rootRect = root.getBoundingClientRect();
    return {
      bottom: Math.round(rootRect.bottom - last.getBoundingClientRect().bottom),
      top: Math.round(first.getBoundingClientRect().top - rootRect.top),
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

    const screen = await renderInBrowser(
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
    const screen = await renderInBrowser(
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

    const { bottom, top } = marginsOf(codeBlocksIn(screen.container).first);
    expect(Number.parseFloat(top)).toBeGreaterThan(0);
    expect(Number.parseFloat(bottom)).toBeGreaterThan(0);
  });

  // The edge reset keys off the wrapper being a direct child of the blob, so a
  // list that leads a message keeps the spacing around code inside its items.
  it("keeps the margins on a block nested in a leading list", async () => {
    const screen = await renderInBrowser(
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

    const { top } = marginsOf(codeBlocksIn(screen.container).first);
    expect(Number.parseFloat(top)).toBeGreaterThan(0);
  });

  // The markdown block reaches the same rules through one more wrapper of its
  // own, and both of them let the block's margin collapse out. That is not a
  // detail: the controls are placed against the wrapper's box, so if it ever
  // stopped coinciding with the block's own, they would sit in the margin
  // above the code. The case below measures that; this one measures the edges.
  it("has no dead space at either edge of a markdown block", async () => {
    const screen = await renderInBrowser(
      <div className="flex flex-col items-start">
        <div className={PROSE_CLASS} data-testid="prose">
          <MarkdownCodeBlock code="leading" />
          <p>Body.</p>
          <MarkdownCodeBlock code="trailing" />
        </div>
      </div>,
    );

    expect(edgeGaps(screen.getByTestId("prose").element())).toEqual({
      bottom: 0,
      top: 0,
    });
  });
});

describe("markdown code block", () => {
  const PROSE_CLASS =
    "prose prose-custom max-w-none text-sm/relaxed dark:prose-invert prose-pre:text-sm";

  const LONG_LINE = `const message = "${"long ".repeat(60)}";`;

  const preIn = (root: Element) => {
    const pre = root.querySelector("pre");
    if (!pre) {
      throw new Error("no code block rendered");
    }
    return pre;
  };

  // With prose ahead of it, which is where a block spends most of its life and
  // the only place its own margin survives: leading a message, the blob's edge
  // reset takes that margin away, and every control measured against the
  // block's box lands in the right place whether or not the box is the one it
  // was positioned against.
  const renderBlock = (code: string, filename?: string) =>
    renderInBrowser(
      <div className={PROSE_CLASS} style={{ width: 480 }}>
        <p>Before.</p>
        <MarkdownCodeBlock code={code} filename={filename} language="ts" />
      </div>,
    );

  it("wraps a long line rather than running it off the block", async () => {
    const screen = await renderBlock(LONG_LINE);
    const pre = preIn(screen.container);

    expect(globalThis.getComputedStyle(pre).whiteSpace).toBe("pre-wrap");
    expect(pre.scrollWidth).toBeLessThanOrEqual(pre.clientWidth);
  });

  it("hands a long line back to the horizontal scroller when wrapping is off", async () => {
    const screen = await renderBlock(LONG_LINE);
    await screen.getByRole("button", { name: "Wrap lines" }).click();

    const pre = preIn(screen.container);
    expect(globalThis.getComputedStyle(pre).whiteSpace).toBe("pre");
    expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
  });

  // The controls are positioned against the wrapper, and what makes that the
  // block's own box is the block's margin collapsing out of it. An in-flow
  // sibling ahead of the code keeps that margin inside instead, and every
  // control then draws in the gap above the block rather than on it.
  it("puts its controls inside the edges of the block", async () => {
    const screen = await renderBlock("const a = 1;");

    const toolbar = screen
      .getByRole("button", { name: "Wrap lines" })
      .element()
      .getBoundingClientRect();
    const pre = preIn(screen.container).getBoundingClientRect();

    expect(toolbar.top).toBeGreaterThanOrEqual(pre.top);
    expect(toolbar.bottom).toBeLessThan(pre.bottom);
  });

  // A filename is drawn over the block rather than above it, which only works
  // if the block is holding a band of padding open for it.
  it("keeps the first line clear of the filename it is labeled with", async () => {
    const screen = await renderBlock("const a = 1;", "src/foo.ts");

    const label = screen
      .getByText("src/foo.ts")
      .element()
      .getBoundingClientRect();
    const pre = preIn(screen.container);
    const firstLine = pre.querySelector("code")?.getBoundingClientRect();

    expect(label.top).toBeGreaterThanOrEqual(pre.getBoundingClientRect().top);
    expect(firstLine?.top).toBeGreaterThanOrEqual(label.bottom);
  });

  it("caps a long block until the reader asks for the rest", async () => {
    const code = Array.from({ length: 60 }, (_, index) => `line ${index}`).join(
      "\n",
    );
    const screen = await renderBlock(code);
    const pre = preIn(screen.container);

    const capped = pre.getBoundingClientRect().height;
    expect(pre.scrollHeight).toBeGreaterThan(pre.clientHeight);

    const expand = screen.getByRole("button", { name: "Show more" });
    expect(expand.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      pre.getBoundingClientRect().bottom,
    );

    await expand.click();

    expect(pre.getBoundingClientRect().height).toBeGreaterThan(capped);
    expect(pre.scrollHeight).toBe(pre.clientHeight);
  });
});
