import { renderInBrowser } from "@/tests/render-browser";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { describe, expect, it } from "vitest";

import { useInstantUntilFitted } from "./use-instant-until-fitted";

/**
 * A folder beside a file as the Files screen fits it: drawn shown, then
 * folded away in the first resize callback after layout, which is ahead of
 * the frame's paint but after its first style.
 */
function Beside() {
  const room = useRef<HTMLDivElement>(null);
  const folder = useRef<HTMLDivElement>(null);
  const [isLaidOut, setLaidOut] = useState(false);
  const [isShown, setShown] = useState(true);
  useLayoutEffect(() => {
    const box = room.current;
    if (!box) {
      return;
    }
    let isFirst = true;
    const observer = new ResizeObserver(() => {
      if (!isFirst) {
        return;
      }
      isFirst = false;
      flushSync(() => {
        setLaidOut(true);
        setShown(box.offsetWidth >= 800);
      });
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, []);
  const isInstant = useInstantUntilFitted(isLaidOut, folder);
  return (
    <div ref={room} style={{ display: "flex", height: 40, width: 500 }}>
      {/* The suite's stylesheet zeroes every duration, and a transition of
          no length never runs, so this one gets its length back. */}
      <style>
        {"[data-testid=folder] { transition-duration: 200ms !important; }"}
      </style>
      <div
        data-testid="folder"
        ref={folder}
        style={{
          transitionProperty: isInstant ? "none" : "width",
          width: isShown ? 300 : 0,
        }}
      />
      <button
        onClick={() => {
          setShown((shown) => !shown);
        }}
        type="button"
      >
        Toggle
      </button>
    </div>
  );
}

describe("useInstantUntilFitted", () => {
  it("lands the first fit at once and slides a later toggle", async () => {
    const runs: string[] = [];
    const onRun = (event: TransitionEvent) => {
      if (event.target instanceof HTMLElement && event.target.dataset.testid) {
        runs.push(`${event.propertyName} to ${event.target.style.width}`);
      }
    };
    document.addEventListener("transitionrun", onRun, true);
    try {
      const screen = await renderInBrowser(<Beside />);
      const folder = screen.getByTestId("folder");
      await expect.element(folder).toHaveStyle({ width: "0px" });
      // Two frames, which is when a transition started by the fit would run.
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      expect(runs).toEqual([]);

      await screen.getByRole("button", { name: "Toggle" }).click();
      await expect.poll(() => runs).toEqual(["width to 300px"]);
    } finally {
      document.removeEventListener("transitionrun", onRun, true);
    }
  });
});
