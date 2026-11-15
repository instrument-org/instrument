import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, expect, it, vi } from "vitest";

import { currentDrag, pressToDrag, setLander } from "./session";
import { useStripTarget } from "./use-group-drag";

const ROW_Y = 300;
const STRIP_Y = 20;

const pointer = (type: string, x: number, y: number) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      buttons: type === "pointermove" ? 1 : 0,
      clientX: x,
      clientY: y,
      isPrimary: true,
    }),
  );

/** A side's strip of two 100px tabs, from the window's left edge. */
function Strip({ group }: { group: string }) {
  useStripTarget({
    group,
    isOn: true,
    side: 0,
    strip: () => document.querySelector<HTMLElement>("[data-group-tabs]"),
    tabs: [
      { href: "/a", id: "a", kind: "screen" },
      { href: "/b", id: "b", kind: "screen" },
    ],
  });
  return (
    <div
      data-group-tabs=""
      style={{ height: 40, left: 0, position: "fixed", top: 0, width: 400 }}
    >
      <div role="tablist" style={{ display: "flex" }}>
        {["a", "b"].map((key) => (
          <div data-tab-key={key} key={key} style={{ height: 40, width: 100 }}>
            {key}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Presses a sidebar row of `group` and carries it to `x` over the strip. */
const carryRowTo = (group: string, x: number) => {
  pressToDrag(
    { button: 0, clientX: 10, clientY: ROW_Y, isPrimary: true },
    () => ({
      grab: { x: 0, y: 0 },
      held: { group, height: 40, kind: "group" },
    }),
  );
  pointer("pointermove", 10, ROW_Y - 40);
  pointer("pointermove", x, STRIP_Y);
};

afterEach(() => {
  pointer("pointerup", 0, 0);
  setLander(undefined);
  document.body.replaceChildren();
});

it("lands a sidebar row dropped on another group's strip at the gap", async () => {
  const landed = vi.fn();
  setLander(landed);
  await renderInBrowser(<Strip group="up" />);
  carryRowTo("other", 150);
  const strip = { group: "up", index: 1, kind: "strip", side: 0 };
  expect(currentDrag()?.landing).toEqual(strip);
  pointer("pointerup", 150, STRIP_Y);
  expect(landed).toHaveBeenCalledWith(
    { group: "other", height: 40, kind: "group" },
    strip,
  );
});

it("lands a sidebar row nowhere on its own group's strip", async () => {
  await renderInBrowser(<Strip group="up" />);
  carryRowTo("up", 150);
  expect(currentDrag()?.landing).toBeUndefined();
});
