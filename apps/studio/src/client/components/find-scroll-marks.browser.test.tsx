// Where a find's ticks land is measured from layout, which jsdom has none of.
import { renderInBrowser } from "@/tests/render-browser";
import { useLayoutEffect, useRef, useState } from "react";
import { expect, it } from "vitest";

import { dedupe, FindScrollMarks, useRangeMarks } from "./find-scroll-marks";

/** A tall scroll with a word at its top, its middle and its end. */
function Scroll({ active }: { active: number }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [ranges, setRanges] = useState<Range[]>([]);
  useLayoutEffect(() => {
    const words = viewportRef.current?.querySelectorAll("[data-word]") ?? [];
    setRanges(
      [...words].map((word) => {
        const range = document.createRange();
        range.selectNodeContents(word);
        return range;
      }),
    );
  }, []);
  const marks = useRangeMarks(viewportRef, ranges, active);
  return (
    <div style={{ height: 200, position: "relative", width: 300 }}>
      <FindScrollMarks marks={marks} />
      <div ref={viewportRef} style={{ height: 200, overflow: "auto" }}>
        <div style={{ height: 2000, position: "relative" }}>
          {[0, 1000, 1990].map((top) => (
            <span
              data-word
              key={top}
              style={{ height: 10, left: 0, position: "absolute", top }}
            >
              word
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ticks() {
  return [...document.querySelectorAll<HTMLElement>("span.absolute")]
    .filter((tick) => tick.style.top !== "")
    .map((tick) => ({
      at: Math.round(Number.parseFloat(tick.style.top) / 10) * 10,
      isActive:
        tick.className.includes("bg-yellow-500 ") ||
        tick.className.endsWith("bg-yellow-500"),
    }));
}

it("marks each match where it is down the whole scroll, the active one apart", async () => {
  await renderInBrowser(<Scroll active={1} />);
  await expect.poll(ticks).toEqual([
    { at: 0, isActive: false },
    { at: 50, isActive: true },
    { at: 100, isActive: false },
  ]);
});

it("draws one tick for matches closer than a tick, keeping the active one", () => {
  expect(
    dedupe(
      [
        { at: 0.5, isActive: false },
        { at: 0.501, isActive: true },
        { at: 0.502, isActive: false },
        { at: 0.9, isActive: false },
      ],
      200,
    ),
  ).toEqual([
    { at: 0.501, isActive: true },
    { at: 0.9, isActive: false },
  ]);
});
