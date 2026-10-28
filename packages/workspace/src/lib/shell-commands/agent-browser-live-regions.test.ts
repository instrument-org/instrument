// @vitest-environment jsdom
import { Script } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

import { liveRegionsArgs } from "./agent-browser-follow-up";

type Reading = {
  loadedAt: number;
  regions: { changedAt: number | null; read: boolean; text: string }[];
  url: string;
};

/** Runs the live-region script in this page, as `eval` would in the browser. */
async function readRegions(): Promise<Reading> {
  const script = liveRegionsArgs({ settleMs: 0, since: 0 })[2] ?? "";
  // At the top level of this context, whose globals are the jsdom page's, as
  // the CLI's `eval` runs it in the browser's. Its value is the script's own
  // return, a plain object of known shape.
  return (await new Script(script).runInThisContext()) as Reading;
}

const texts = (reading: Reading) => reading.regions.map(({ text }) => text);

describe("the live-region script", () => {
  beforeAll(() => {
    // jsdom lays nothing out, so it has no innerText; the text is the same
    // for these pages.
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent ?? "";
      },
    });
  });

  it("reads a status message, and one with an Undo button", async () => {
    document.body.innerHTML = `
      <p role="status">Saved Ada Lovelace as contact #3.</p>
      <div role="alert">Message archived. <button>Undo</button></div>`;
    expect(texts(await readRegions())).toEqual([
      "Saved Ada Lovelace as contact #3.",
      "Message archived. Undo",
    ]);
  });

  it("skips a form marked as a live region and reads the alert inside it", async () => {
    document.body.innerHTML = `
      <form aria-live="polite">
        <h1>Sign in or create account</h1>
        <label>Enter mobile number or email <input name="email"></label>
        <button>Continue</button>
        <div role="alert"></div>
      </form>`;
    expect(texts(await readRegions())).toEqual([]);
    const alert = document.querySelector('[role="alert"]');
    if (alert) alert.textContent = "Enter your email or mobile phone number";
    // The observer stamps the region in a microtask after the change.
    await Promise.resolve();
    const reading = await readRegions();
    expect(texts(reading)).toEqual(["Enter your email or mobile phone number"]);
    expect(reading.regions[0]?.changedAt).not.toBeNull();
  });

  it("skips a region with more than a few links", async () => {
    document.body.innerHTML = `
      <section aria-live="polite">
        <a href="/p/1">Mug</a><a href="/p/2">Kettle</a>
        <a href="/p/3">Teapot</a><a href="/p/4">Tray</a>
      </section>
      <div role="status">Added to your cart. <a href="/cart">View cart</a></div>`;
    expect(texts(await readRegions())).toEqual([
      "Added to your cart. View cart",
    ]);
  });

  it("names the document by when it loaded and its address without the fragment", async () => {
    window.history.replaceState(null, "", "/contacts?page=2#new");
    const reading = await readRegions();
    expect(reading.url).toBe(`${window.location.origin}/contacts?page=2`);
    expect(reading.loadedAt).toBe(performance.timeOrigin);
  });
});
