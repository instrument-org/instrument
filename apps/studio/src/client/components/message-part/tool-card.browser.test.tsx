import { renderInBrowser } from "@/tests/render-browser";
import { noop } from "radashi";
import { describe, expect, it, vi } from "vitest";

import { TranscriptScrollContext } from "../transcript-scroll-context";
import { ToolCard, ToolCardSection } from "./tool-card";

// Long enough to run off a section several times over, and unbroken by spaces
// only where it should be: `break-word` is meant to leave an ordinary token
// whole and break one that could not fit a line of its own.
const LONG_LINE = `stderr: ${"detail ".repeat(80)}`;

const COLLAPSED_HEIGHT = 176;
// The height an opened region stands at, from `tool-card.tsx`.
const EXPANDED_HEIGHT = 480;

const renderSection = (props?: {
  copyText?: string;
  releaseAutoScroll?: () => void;
  text?: string;
  wrappable?: boolean;
}) =>
  renderInBrowser(
    <TranscriptScrollContext value={props?.releaseAutoScroll ?? noop}>
      <div style={{ width: 480 }}>
        <ToolCard>
          <ToolCardSection
            collapsedHeight={COLLAPSED_HEIGHT}
            copyText={props?.copyText}
            wrappable={props?.wrappable}
          >
            <pre className="font-mono text-sm">{props?.text ?? LONG_LINE}</pre>
          </ToolCardSection>
        </ToolCard>
      </div>
    </TranscriptScrollContext>,
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

    // Opening grows the region to a bounded height and scrolls inside it. Laid
    // out in full instead, a four-hundred-line log is a card taller than the
    // window, and everything after it in the transcript is pushed past reach.
    it("grows to a bounded height rather than to whatever the content measures", async () => {
      const screen = await renderSection({
        text: Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n"),
        wrappable: true,
      });
      const pre = preIn(screen.container);

      await screen.getByRole("button", { name: /Show more/ }).click();

      const card = cardOf(screen.container).getBoundingClientRect();
      expect(card.height).toBeGreaterThan(COLLAPSED_HEIGHT);
      expect(card.height).toBeLessThan(600);
      // The content is far taller than the card holding it, which is what makes
      // the region a scroller rather than a full layout.
      expect(pre.getBoundingClientRect().height).toBeGreaterThan(card.height);
    });

    // Measured rather than read off the computed style or driven by scrollTop:
    // `overflow-y` reports `auto` whenever the other axis is `auto`, and a
    // clipped box still scrolls under a script, so both of those pass against a
    // region that cannot scroll. What is true either way is the size of the
    // window and how much is behind it.
    it("holds a bounded window onto the rest once opened", async () => {
      const screen = await renderSection({
        text: Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n"),
        wrappable: true,
      });
      const scroller = preIn(screen.container).parentElement?.parentElement;
      if (!scroller) {
        throw new Error("no scroller around the content");
      }

      expect(scroller.clientHeight).toBe(COLLAPSED_HEIGHT);

      await screen.getByRole("button", { name: /Show more/ }).click();

      expect(scroller.clientHeight).toBe(EXPANDED_HEIGHT);
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
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

    // Measured rather than counted from the text: one 500-character line fills
    // the clamp on its own once it wraps, and a line count would call it short.
    it("offers the rest of a single line long enough to fill the clamp", async () => {
      const screen = await renderSection({
        text: "x".repeat(4000),
        wrappable: true,
      });

      await expect
        .element(screen.getByRole("button", { name: /Show more/ }))
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

  // While the transcript's scroller follows the live end, any growth re-pins it
  // to the bottom -- including growth the reader just clicked for, which carries
  // the opened region off screen. `TranscriptScrollContext` is the contract:
  // every control that reshapes a region hands scrolling back first.
  describe("handing scrolling back to the reader", () => {
    it("releases the scroller before opening the section", async () => {
      const releaseAutoScroll = vi.fn();
      const screen = await renderSection({
        releaseAutoScroll,
        wrappable: true,
      });

      await screen.getByRole("button", { name: /Show more/ }).click();

      expect(releaseAutoScroll).toHaveBeenCalledOnce();
    });

    it("releases the scroller before rewrapping the lines", async () => {
      const releaseAutoScroll = vi.fn();
      const screen = await renderSection({
        releaseAutoScroll,
        wrappable: true,
      });

      await screen.getByRole("button", { name: "Wrap lines" }).click();

      expect(releaseAutoScroll).toHaveBeenCalledOnce();
    });
  });
});
