import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { ToolCard, ToolCardSection } from "./tool-card";

// Long enough to run off a section several times over, and unbroken by spaces
// only where it should be: `break-word` is meant to leave an ordinary token
// whole and break one that could not fit a line of its own.
const LONG_LINE = `stderr: ${"detail ".repeat(80)}`;

const COLLAPSED_HEIGHT = 176;

const renderSection = (props?: {
  copyText?: string;
  lineCount?: number;
  text?: string;
  wrappable?: boolean;
}) =>
  renderInBrowser(
    <div style={{ width: 480 }}>
      <ToolCard>
        <ToolCardSection
          collapsedHeight={COLLAPSED_HEIGHT}
          copyText={props?.copyText}
          lineCount={props?.lineCount}
          wrappable={props?.wrappable}
        >
          <pre className="font-mono text-sm">{props?.text ?? LONG_LINE}</pre>
        </ToolCardSection>
      </ToolCard>
    </div>,
  );

const preIn = (root: Element) => {
  const pre = root.querySelector("pre");
  if (!pre) {
    throw new Error("no section content rendered");
  }
  return pre;
};

describe("tool card section", () => {
  it("wraps a long line rather than running it off the section", async () => {
    const screen = await renderSection({ wrappable: true });
    const pre = preIn(screen.container);

    expect(globalThis.getComputedStyle(pre).whiteSpace).toBe("pre-wrap");
    expect(pre.scrollWidth).toBeLessThanOrEqual(pre.clientWidth);
  });

  it("hands a long line back to the horizontal scroller when wrapping is off", async () => {
    const screen = await renderSection({ wrappable: true });
    await screen.getByRole("button", { name: "Wrap lines" }).click();

    const pre = preIn(screen.container);
    expect(globalThis.getComputedStyle(pre).whiteSpace).toBe("pre");
    expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
  });

  // The toggle reports a state rather than performing an action, so on content
  // that already fits it is the only thing on screen that can say which view
  // the reader is looking at.
  it("reports which way the section is currently drawn", async () => {
    const screen = await renderSection({ wrappable: true });
    const toggle = screen.getByRole("button", { name: "Wrap lines" });

    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  });

  // Both controls sit in one corner cluster, and the section holds enough
  // padding open for whichever of them it ended up with. Sized for one button,
  // the second one comes down on the text.
  it("keeps the first line clear of the controls above it", async () => {
    const screen = await renderSection({ copyText: "out", wrappable: true });

    const copy = screen
      .getByRole("button", { name: "Copy" })
      .element()
      .getBoundingClientRect();
    const pre = preIn(screen.container).getBoundingClientRect();

    expect(copy.left).toBeGreaterThanOrEqual(pre.right);
  });

  it("draws no controls on a section with nothing to act on", async () => {
    const screen = await renderSection();

    expect(screen.container.querySelectorAll("button")).toHaveLength(0);
  });

  describe("opening a clamped section", () => {
    // The card is what the reader sees grow, and it is the honest measure of
    // whether the clamp came off: the region inside it could report any height
    // it liked while the card stayed the same eight lines tall.
    const cardOf = (root: Element) => {
      const card = preIn(root).closest(".rounded-2xl");
      if (!card) {
        throw new Error("no card around the section");
      }
      return card;
    };

    it("offers the rest of a section taller than its clamp", async () => {
      const screen = await renderSection({ wrappable: true });

      await expect
        .element(screen.getByRole("button", { name: /Show more/ }))
        .toBeVisible();
      expect(
        cardOf(screen.container).getBoundingClientRect().height,
      ).toBeLessThan(COLLAPSED_HEIGHT * 2);
    });

    it("takes the clamp off rather than scrolling within it", async () => {
      const screen = await renderSection({ wrappable: true });
      const pre = preIn(screen.container);

      await screen.getByRole("button", { name: /Show more/ }).click();

      const card = cardOf(screen.container).getBoundingClientRect();
      expect(card.height).toBeGreaterThan(COLLAPSED_HEIGHT);
      // Everything is laid out, not parked behind a scroller inside the card.
      expect(pre.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        card.bottom,
      );
    });

    it("closes again", async () => {
      const screen = await renderSection({ wrappable: true });
      await screen.getByRole("button", { name: /Show more/ }).click();

      const opened = cardOf(screen.container).getBoundingClientRect().height;
      await screen.getByRole("button", { name: "Show less" }).click();

      expect(
        cardOf(screen.container).getBoundingClientRect().height,
      ).toBeLessThan(opened);
    });

    // What it costs to open, for the sections whose content has countable lines
    // at all. Markdown and rows do not, and say "Show more" instead.
    it("says how much there is when the caller can count it", async () => {
      const screen = await renderSection({ lineCount: 62, wrappable: true });

      await expect
        .element(screen.getByRole("button", { name: "Show all 62 lines" }))
        .toBeVisible();
    });

    // Measured rather than counted from the text: one 500-character line fills
    // the clamp on its own once it wraps, and a line count would call it short.
    it("offers the rest of a single line long enough to fill the clamp", async () => {
      const screen = await renderSection({
        lineCount: 1,
        text: "x".repeat(4000),
        wrappable: true,
      });

      await expect
        .element(screen.getByRole("button", { name: "Show all 1 lines" }))
        .toBeVisible();
    });

    it("offers nothing on a section that already fits", async () => {
      const screen = await renderSection({ text: "one line", wrappable: true });

      await expect
        .element(screen.getByRole("button", { name: "Wrap lines" }))
        .toBeVisible();
      expect(screen.container.querySelectorAll("button")).toHaveLength(1);
    });
  });
});
