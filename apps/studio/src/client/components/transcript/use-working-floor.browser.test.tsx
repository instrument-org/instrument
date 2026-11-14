import { renderInBrowser } from "@/tests/render-browser";
import { useEffect, useRef } from "react";
import { expect, it } from "vitest";

import { useWorkingFloor } from "./use-working-floor";

/** A working turn in a column that is watched, as the transcript's content is. */
function WatchedTurn({ height }: { height: string }) {
  const columnRef = useRef<HTMLDivElement>(null);
  const floorRef = useWorkingFloor(true);
  useEffect(() => {
    const column = columnRef.current;
    if (!column) {
      return;
    }
    const observer = new ResizeObserver(() => {});
    observer.observe(column);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={columnRef}>
      <div ref={floorRef}>
        <div data-testid="body" style={{ height }} />
      </div>
    </div>
  );
}

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    let left = count;
    const next = () => {
      left -= 1;
      if (left === 0) {
        resolve();
      } else {
        requestAnimationFrame(next);
      }
    };
    requestAnimationFrame(next);
  });

it.each(["100.6px", "100.25px", "100px"])(
  "holds a turn %s tall without resizing it inside its observer",
  async (height) => {
    const loops: string[] = [];
    const onError = (event: ErrorEvent) => {
      if (event.message.startsWith("ResizeObserver loop")) {
        loops.push(event.message);
        event.preventDefault();
      }
    };
    window.addEventListener("error", onError);
    try {
      const { container, rerender } = await renderInBrowser(
        <WatchedTurn height="40px" />,
      );
      await frames(3);
      await rerender(<WatchedTurn height={height} />);
      await frames(3);
      const turn = container.querySelector<HTMLElement>(
        "div > div:has([data-testid=body])",
      );
      expect(loops).toEqual([]);
      expect(turn?.getBoundingClientRect().height).toBeCloseTo(
        Number.parseFloat(height),
        1,
      );
    } finally {
      window.removeEventListener("error", onError);
    }
  },
);
