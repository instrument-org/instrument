import "@tailwindcss/browser";
import { afterEach, describe, expect, it } from "vitest";

import { untilRestyled } from "./restyle";

/** Well under the cap, so an answer this fast came from the compiler's write. */
const PROMPT_MS = 1500;

/**
 * A padding class built at run time: the app's own stylesheet, loaded for
 * every browser test, compiles every class its scanner finds written in source.
 */
const pt = (px: number) => ["pt", `[${px}px]`].join("-");

describe("untilRestyled", () => {
  const added: Element[] = [];
  afterEach(() => {
    for (const el of added.splice(0)) {
      el.remove();
    }
  });

  function box(cls: string, pinnedPx?: number) {
    const el = document.createElement("div");
    if (pinnedPx !== undefined) {
      el.id = `pinned-${pinnedPx}`;
      const style = document.createElement("style");
      style.textContent = `#${el.id} { padding-top: ${pinnedPx}px; }`;
      document.body.append(style);
      added.push(style);
    }
    el.className = cls;
    document.body.append(el);
    added.push(el);
    return el;
  }

  it("answers at the page compiler's write for a class it has not seen", async () => {
    const el = box(pt(17));
    expect(getComputedStyle(el).paddingTop).toBe("0px");
    const t0 = performance.now();
    const changed = await untilRestyled(
      [pt(17)],
      () => getComputedStyle(el).paddingTop === "17px",
    );
    expect(changed).toBe(true);
    expect(performance.now() - t0).toBeLessThan(PROMPT_MS);
  });

  it("answers no at the write when the page's own CSS wins", async () => {
    const el = box(pt(23), 2);
    const t0 = performance.now();
    const changed = await untilRestyled(
      [pt(23)],
      () => getComputedStyle(el).paddingTop === "23px",
    );
    expect(changed).toBe(false);
    expect(performance.now() - t0).toBeLessThan(PROMPT_MS);
  });

  it("answers at once for a class already compiled", async () => {
    const first = box(pt(29));
    await untilRestyled(
      [pt(29)],
      () => getComputedStyle(first).paddingTop === "29px",
    );
    const el = box(pt(29), 3);
    const t0 = performance.now();
    const changed = await untilRestyled(
      [pt(29)],
      () => getComputedStyle(el).paddingTop === "29px",
    );
    expect(changed).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
