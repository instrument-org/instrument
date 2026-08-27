import { type ReactNode, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

// The gutter is shown by a container query and find deliberately skips text it
// can see is not painted, so what this hook returns depends on the real
// stylesheet resolving that query.
import "../../styles/globals.css";
import { useFindHighlights } from "./use-find-highlights";

/** A code cell as the viewer builds one: Shiki's per-token spans, and the
 * execution-count gutter the container query hides on a narrow panel. */
function CodeCell({ label, tokens }: { label: string; tokens: string[] }) {
  return (
    <div className="flex gap-2">
      <div className="hidden w-14 shrink-0 @min-[520px]/notebook:block">
        {label}
      </div>
      <pre>
        {tokens.map((token, index) => (
          <span key={index}>{token}</span>
        ))}
      </pre>
    </div>
  );
}

/**
 * Find over rendered DOM, in the only environment that can observe it: the CSS
 * Custom Highlight API, `checkVisibility`, and container queries are all things
 * jsdom does not have, and between them they are most of what this hook does.
 */
function FindHarness({
  children,
  query,
  width,
}: {
  children: ReactNode;
  query: string;
  width: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Held in state rather than taken from the prop on every render, so a test
  // can widen the panel the way the app does: a parent re-render that changes
  // nothing inside the container.
  const [currentWidth, setCurrentWidth] = useState(width);
  const { activeMatch, goToMatch, matchCount, styleSheet } = useFindHighlights({
    containerRef: scrollRef,
    query,
  });

  return (
    <>
      <style>{styleSheet}</style>
      {/* Outside the searched container, so the readout is not itself text a
          query can match. */}
      <output data-testid="readout">{`${activeMatch}/${matchCount}`}</output>
      <button
        data-testid="next"
        onClick={() => {
          goToMatch(1);
        }}
        type="button"
      >
        next
      </button>
      <button
        data-testid="widen"
        onClick={() => {
          setCurrentWidth(800);
        }}
        type="button"
      >
        widen
      </button>
      <div ref={scrollRef} style={{ width: currentWidth }}>
        <div className="@container/notebook">{children}</div>
      </div>
    </>
  );
}

async function renderFind({
  children,
  query,
  width = 800,
}: {
  children: ReactNode;
  query: string;
  width?: number;
}) {
  const screen = await render(
    <FindHarness query={query} width={width}>
      {children}
    </FindHarness>,
  );

  const readout = () => screen.container.querySelector("output")?.textContent;
  return { ...screen, readout };
}

describe("useFindHighlights", () => {
  it("matches across the elements syntax highlighting splits a line into", async () => {
    // The reason the haystack is concatenated at all: searched node by node,
    // no query longer than one token would ever match.
    const { readout } = await renderFind({
      children: <CodeCell label="In [1]:" tokens={["im", "port", " ", "os"]} />,
      query: "import os",
    });

    await expect.poll(readout).toBe("0/1");
  });

  it("does not match across a block boundary", async () => {
    // The last character of one cell sits against the first of the next, so
    // without a separator a two-letter query paints a highlight over
    // everything in between.
    const { readout } = await renderFind({
      children: (
        <>
          <CodeCell label="In [1]:" tokens={["ab"]} />
          <CodeCell label="In [2]:" tokens={["cd"]} />
        </>
      ),
      query: "bc",
    });

    await expect.poll(readout).toBe("0/0");
  });

  it("registers a highlight per instance, so two viewers do not collide", async () => {
    await renderFind({
      children: <CodeCell label="In [1]:" tokens={["alpha"]} />,
      query: "alpha",
    });
    await renderFind({
      children: <CodeCell label="In [1]:" tokens={["alpha alpha"]} />,
      query: "alpha",
    });

    // Two names per instance -- the matches and the active one -- and no name
    // shared between them, which is what keeps one viewer's matches off the
    // other's page.
    await expect
      .poll(() => new Set(CSS.highlights.keys()).size)
      .toBe(4);
  });

  it("walks matches and wraps at the end", async () => {
    const { getByTestId, readout } = await renderFind({
      children: <CodeCell label="In [1]:" tokens={["a a a"]} />,
      query: "a",
    });

    await expect.poll(readout).toBe("0/3");
    await getByTestId("next").click();
    await expect.poll(readout).toBe("1/3");
    await getByTestId("next").click();
    await getByTestId("next").click();
    await expect.poll(readout).toBe("0/3");
  });

  it("counts the gutter only at the width that paints it", async () => {
    // A container query flipping mutates nothing, so a resize is the only
    // thing that can tell the hook the page it searched has changed.
    const { getByTestId, readout } = await renderFind({
      children: <CodeCell label="In [1]:" tokens={["print"]} />,
      query: "in",
      width: 400,
    });

    await expect.poll(readout).toBe("0/1");
    await getByTestId("widen").click();
    await expect.poll(readout).toBe("0/2");
  });
});
