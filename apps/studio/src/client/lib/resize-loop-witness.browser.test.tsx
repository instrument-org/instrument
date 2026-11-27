import { afterEach, expect, it } from "vitest";

import { nextResizeLoop } from "@/tests/resize-loop-guard";

import { resizeLoopWitnesses } from "./resize-loop-witness";

// The browser setup watches closely (`setup-browser.ts`).
afterEach(() => {
  document.body.replaceChildren();
});

function box(slot: string, parent: Element = document.body) {
  const element = document.createElement("div");
  element.dataset.slot = slot;
  element.style.height = "10px";
  parent.append(element);
  return element;
}

it("names the callback that resized the box it observes", async () => {
  const growing = box("growing-box");
  const loop = nextResizeLoop();
  const observer = new ResizeObserver(() => {
    growing.style.height = `${growing.offsetHeight + 10}px`;
  });
  observer.observe(growing);
  const witnesses = await loop;
  observer.disconnect();

  expect(witnesses[0]).toMatch(
    /^resized body > div\[data-slot=growing-box\] \(observed ← .*resize-loop-witness\.browser\.test.*\) ← .*resize-loop-witness\.browser\.test/,
  );
  expect(witnesses).toContainEqual(
    expect.stringMatching(/^pass 1: body > div\[data-slot=growing-box\] ← /),
  );
});

it("names the callback that resized a shallower box another observes", async () => {
  const outer = box("outer");
  const inner = box("inner", outer);
  const loop = nextResizeLoop();
  const watchingOuter = new ResizeObserver(() => {});
  watchingOuter.observe(outer);
  let isFirst = true;
  const watchingInner = new ResizeObserver(() => {
    if (isFirst) {
      isFirst = false;
      outer.style.paddingTop = "10px";
    }
  });
  watchingInner.observe(inner);
  // Both deliver in the first pass; the second has only the outer box left,
  // which is no deeper than the inner one was.
  const witnesses = await loop;
  watchingOuter.disconnect();
  watchingInner.disconnect();

  expect(witnesses[0]).toMatch(
    /^resized body > div\[data-slot=outer\] .* ← .*resize-loop-witness\.browser\.test/,
  );
});

it("names the callback that began observing a box the step could not deliver", async () => {
  const first = box("first");
  const late = box("late");
  const loop = nextResizeLoop();
  const watchingLate = new ResizeObserver(() => {});
  const observer = new ResizeObserver(() => {
    watchingLate.observe(late);
  });
  observer.observe(first);
  const witnesses = await loop;
  observer.disconnect();
  watchingLate.disconnect();

  expect(witnesses[0]).toMatch(
    /^began observing body > div\[data-slot=late\] ← .*resize-loop-witness\.browser\.test/,
  );
});

it("adds nothing to another error", () => {
  expect(resizeLoopWitnesses("Script error.")).toBeUndefined();
});
