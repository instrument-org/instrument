import { StudioSidebarRail } from "@/client/components/studio-sidebar-rail";
import { renderInBrowser } from "@/tests/render-browser";
import { atom } from "jotai";
import { useLayoutEffect, useRef, useState } from "react";
import { expect, it } from "vitest";

const WIDTH = 176;
const BOUNDS = { initial: WIDTH, max: 360, min: 140 };
const widthAtom = atom(WIDTH);

/**
 * A box that puts its rail over the content below a width, measured once it
 * is laid out, the way the Files screen and the chats page do: drawn first
 * as if wide, with the rail open beside the content.
 */
function Measured() {
  const ref = useRef<HTMLDivElement>(null);
  const [isNarrow, setNarrow] = useState(false);
  const [isOpenOver, setOpenOver] = useState(false);
  useLayoutEffect(() => {
    setNarrow((ref.current?.offsetWidth ?? 0) < 576);
  }, []);
  return (
    <div className="relative flex h-80 w-100" ref={ref}>
      <StudioSidebarRail
        bounds={BOUNDS}
        isOpen={isNarrow ? isOpenOver : true}
        isOverlay={isNarrow}
        onCollapse={() => {}}
        widthAtom={widthAtom}
      >
        <nav data-testid="places">Places</nav>
      </StudioSidebarRail>
      <button
        className="ml-auto"
        onClick={() => {
          setOpenOver(true);
        }}
        type="button"
      >
        Open
      </button>
    </div>
  );
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

function panelX(screen: Awaited<ReturnType<typeof renderInBrowser>>) {
  const panel = screen.getByTestId("places").element().parentElement;
  if (!panel) {
    throw new TypeError("no panel");
  }
  return new DOMMatrix(getComputedStyle(panel).transform).m41;
}

it("starts put away in a box too narrow for it, with no slide", async () => {
  const screen = await renderInBrowser(<Measured />);
  await nextFrame();
  expect(panelX(screen)).toBe(-WIDTH);
});

it("still slides when it opens over the content later", async () => {
  const screen = await renderInBrowser(<Measured />);
  await nextFrame();
  await screen.getByRole("button", { name: "Open" }).click();
  await nextFrame();
  const x = panelX(screen);
  expect(x).toBeGreaterThan(-WIDTH);
  expect(x).toBeLessThan(0);
});
