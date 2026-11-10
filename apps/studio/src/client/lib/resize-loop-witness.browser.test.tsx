import { afterEach, expect, it } from "vitest";

import {
  resizeLoopWitnesses,
  watchResizeObservers,
} from "./resize-loop-witness";

const Native = window.ResizeObserver;

afterEach(() => {
  window.ResizeObserver = Native;
  document.body.replaceChildren();
});

it("names the observer whose callback resized what it observes", async () => {
  watchResizeObservers();
  const box = document.createElement("div");
  box.dataset.slot = "growing-box";
  box.className = "grow";
  box.style.height = "10px";
  document.body.append(box);

  const loop = new Promise<string[] | undefined>((resolve) => {
    window.addEventListener(
      "error",
      (event) => {
        event.preventDefault();
        resolve(resizeLoopWitnesses(event.message));
      },
      { once: true },
    );
  });
  const observer = new ResizeObserver(() => {
    box.style.height = `${box.offsetHeight + 10}px`;
  });
  observer.observe(box);
  const witnesses = await loop;
  observer.disconnect();

  expect(witnesses?.length).toBeGreaterThan(0);
  expect(witnesses?.[0]).toMatch(
    /^body > div\[data-slot=growing-box\]\.grow ← .*resize-loop-witness\.browser\.test/,
  );
});

it("adds nothing to another error", () => {
  expect(resizeLoopWitnesses("Script error.")).toBeUndefined();
});
