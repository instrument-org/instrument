// Where this menu lands is a measured claim about two boxes -- the composer and
// the menu hanging off it -- and jsdom has no layout to measure, so an assertion
// there would only be reading back the props. The zoom cases matter for the same
// reason twice over: the rects Radix positions against are on-screen px while the
// menu is laid out in its own, and only a real browser tells those apart.
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { createStore } from "jotai";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

// Relative, not `@/tests/render-browser`: oxlint's type-aware pass does not
// resolve the alias to this module and every access downstream then reads as an
// error type.
import { renderInBrowser } from "../../tests/render-browser";
import { zoomAtom } from "../atoms/zoom";
import { ComposerAddMenu } from "./composer-add-menu";

const noop = () => {
  // These tests assert on where the menu sits, not on what it chooses.
};

// The composer's own numbers: the width a prompt is written across, and the 16px
// its button row is inset by -- the overlap this menu used to open inside.
const COMPOSER_WIDTH = 480;
const COMPOSER_PADDING = 16;
const GAP = 4;

function Composer({ top }: { top: number }) {
  // State rather than a ref: the menu measures this box from its own layout
  // effect, which runs before a ref on it would have been attached.
  const [bounds, setBounds] = useState<HTMLDivElement | null>(null);

  return (
    <div
      data-composer=""
      ref={setBounds}
      style={{
        marginTop: top,
        padding: COMPOSER_PADDING,
        width: COMPOSER_WIDTH,
      }}
    >
      <ComposerAddMenu
        actions={[
          {
            icon: PaperclipIcon,
            id: "add-files",
            label: "Add files",
            onSelect: noop,
          },
        ]}
        bounds={bounds}
        onReturnFocus={noop}
        onSelectSkill={noop}
        onViewChange={noop}
        skills={[]}
        view="root"
      />
    </div>
  );
}

const box = (selector: string) => {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`${selector} is not mounted`);
  }
  return found.getBoundingClientRect();
};

const menuBox = () => box('[data-slot="dropdown-menu-content"]');
const composerBox = () => box("[data-composer]");

// floating-ui rounds what it places onto the device pixel grid, so a number
// asked for in layout px lands within half a device px of it. Anything the
// placement gets wrong is out by whole px.
const ROUNDING = 0.5;
const offBy = (actual: number, expected: number) => Math.abs(actual - expected);

describe("ComposerAddMenu in a browser", () => {
  // The menu is open from the first render, so every wait here is on floating-ui
  // settling rather than on anything the user does.
  it("spans the composer and clears its bottom edge", async () => {
    await renderInBrowser(<Composer top={0} />);

    await vi.waitFor(() => {
      const composer = composerBox();
      const menu = menuBox();
      expect(offBy(menu.width, composer.width)).toBeLessThanOrEqual(ROUNDING);
      expect(offBy(menu.left, composer.left)).toBeLessThanOrEqual(ROUNDING);
      expect(offBy(menu.top - composer.bottom, GAP)).toBeLessThanOrEqual(
        ROUNDING,
      );
    });
  });

  // A composer sitting low in the window still opens the menu below it while a
  // full-height one fits there. Handing that to the side with the most room
  // instead would open upward on the new task page, where the composer is
  // centered but the room above it is where the page's own heading is.
  it("opens below a composer that has room on both sides", async () => {
    await renderInBrowser(<Composer top={500} />);

    await vi.waitFor(() => {
      const composer = composerBox();
      const menu = menuBox();
      expect(offBy(menu.top - composer.bottom, GAP)).toBeLessThanOrEqual(
        ROUNDING,
      );
    });
  });

  // The task page pins its composer to the bottom of the window, which is the
  // arrangement the menu used to open over the prompt in. Going up has to clear
  // the composer by the same gap it clears it by going down.
  it("opens above the composer when there is no room below it", async () => {
    await renderInBrowser(<Composer top={700} />);

    await vi.waitFor(() => {
      const composer = composerBox();
      const menu = menuBox();
      expect(offBy(menu.width, composer.width)).toBeLessThanOrEqual(ROUNDING);
      expect(offBy(menu.left, composer.left)).toBeLessThanOrEqual(ROUNDING);
      expect(offBy(composer.top - menu.bottom, GAP)).toBeLessThanOrEqual(
        ROUNDING,
      );
    });
  });

  // Zoom is where this goes wrong quietly: the menu is portalled out of the
  // zoomed tree and re-applies zoom to itself, so a width or a gap handed to
  // Radix in the wrong one of the two spaces still looks right at 1x. A width
  // that was never converted comes out `zoom` times too wide, and a gap that was
  // converted twice comes out at 2.7 on-screen px instead of 6.
  it.each([1.5, 0.75])(
    "holds the gap and the width at %sx zoom",
    async (zoom) => {
      const store = createStore();
      store.set(zoomAtom, zoom);
      await renderInBrowser(
        <div style={{ zoom }}>
          <Composer top={0} />
        </div>,
        { store },
      );

      await vi.waitFor(() => {
        const composer = composerBox();
        const menu = menuBox();
        // On screen the composer is `zoom` times the width it was laid out at,
        // and the menu matches it there rather than in layout px.
        expect(
          offBy(composer.width, COMPOSER_WIDTH * zoom),
        ).toBeLessThanOrEqual(ROUNDING);
        expect(offBy(menu.width, composer.width)).toBeLessThanOrEqual(ROUNDING);
        expect(offBy(menu.left, composer.left)).toBeLessThanOrEqual(ROUNDING);
        // 4 layout px, which is what 4px reads as at every zoom level.
        expect(
          offBy(menu.top - composer.bottom, GAP * zoom),
        ).toBeLessThanOrEqual(ROUNDING);
      });
    },
  );
});
