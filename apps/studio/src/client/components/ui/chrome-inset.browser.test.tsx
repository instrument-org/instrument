import { zoomAtom } from "@/client/atoms/zoom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { ChromeInsetProvider } from "@/client/hooks/use-chrome-inset";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore } from "jotai";
import { type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

// macOS draws its traffic lights over the web contents, so a menu that reaches
// the top of the window does not just look wrong there: the part of it under
// the buttons stops answering the pointer. Both composer menus are the ones
// that get there first -- they open upward out of a composer pinned to the
// bottom of the window, and they turn Radix's collision handling off, so the
// height cap is the only thing between them and the top edge.

/** Taller than any window this runs in, so the menu always wants more room. */
const OVERFLOWING_ROWS = Array.from({ length: 40 }, (_, index) => (
  <div className="h-6" key={index}>
    Row {index}
  </div>
));

/** How the composer menus are set up: no collisions, capped by what Radix measured. */
const GROWS_UPWARD =
  "max-h-[calc(var(--radix-popover-content-available-height)/var(--content-zoom))]";

function LowInTheWindow({ children }: { children: ReactNode }) {
  return <div style={{ paddingTop: 700 }}>{children}</div>;
}

function storeAtZoom(zoom: number) {
  const store = createStore();
  store.set(zoomAtom, zoom);
  return store;
}

async function topOf(role: "dialog" | "menu") {
  const content = page.getByRole(role);
  await expect.element(content).toBeVisible();
  await expect
    .poll(() => Math.round(content.element().getBoundingClientRect().height))
    .toBeGreaterThan(0);
  return content.element().getBoundingClientRect().top;
}

describe("floating content and the window chrome", () => {
  it.each([1, 2])(
    "holds a popover below the toolbar at %sx zoom",
    async (zoom) => {
      await renderInBrowser(
        <ChromeInsetProvider top={TOOLBAR_HEIGHT}>
          <LowInTheWindow>
            <Popover defaultOpen>
              <PopoverTrigger>Open</PopoverTrigger>
              <PopoverContent
                avoidCollisions={false}
                className={GROWS_UPWARD}
                side="top"
              >
                {OVERFLOWING_ROWS}
              </PopoverContent>
            </Popover>
          </LowInTheWindow>
        </ChromeInsetProvider>,
        { store: storeAtZoom(zoom) },
      );

      // The band is layout px and this is on-screen px, so it grows with zoom
      // the same way the toolbar under it does.
      const band = TOOLBAR_HEIGHT * zoom;
      const top = await topOf("dialog");
      expect(top).toBeGreaterThanOrEqual(band - 1);
      // And it takes the rest: a popover parked anywhere lower would clear the
      // toolbar by accident rather than because it was told to.
      expect(top).toBeLessThanOrEqual(band + 2);
    },
  );

  it("holds the menu behind a composer's plus button below the toolbar", async () => {
    await renderInBrowser(
      <ChromeInsetProvider top={TOOLBAR_HEIGHT}>
        <LowInTheWindow>
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger>Add</DropdownMenuTrigger>
            <DropdownMenuContent
              avoidCollisions={false}
              className="max-h-[calc(var(--radix-dropdown-menu-content-available-height)/var(--content-zoom))]"
              side="top"
            >
              {OVERFLOWING_ROWS.map((row, index) => (
                <DropdownMenuItem key={index}>{row}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </LowInTheWindow>
      </ChromeInsetProvider>,
    );

    expect(await topOf("menu")).toBeGreaterThanOrEqual(TOOLBAR_HEIGHT - 1);
  });

  // The band belongs to the window that draws one. Nothing else reserves it:
  // not the onboarding window, which has no toolbar, and not a component
  // rendered on its own.
  it("takes the whole window where no chrome claims a band", async () => {
    await renderInBrowser(
      <LowInTheWindow>
        <Popover defaultOpen>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent
            avoidCollisions={false}
            className={GROWS_UPWARD}
            side="top"
          >
            {OVERFLOWING_ROWS}
          </PopoverContent>
        </Popover>
      </LowInTheWindow>,
    );

    expect(await topOf("dialog")).toBeLessThan(TOOLBAR_HEIGHT);
  });
});
