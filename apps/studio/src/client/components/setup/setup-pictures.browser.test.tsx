import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Every image decode held until the test lets it go, standing in for a
 * picture whose bytes are still arriving. Stubbed before the pictures'
 * modules load, since they start decoding as they are imported.
 */
function holdDecodes() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(
    () => promise,
  );
  return resolve;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setup's pictures", () => {
  it("hold Welcome's burst hidden and at its start until its images are decoded", async () => {
    const release = holdDecodes();
    const { WelcomeBurst } = await import("./welcome-burst");
    const screen = await renderInBrowser(<WelcomeBurst />);
    const root = screen.container.querySelector<HTMLElement>("[aria-hidden]");
    const icon = screen.container.querySelector("img");
    if (!root || !icon) {
      throw new Error("the burst did not render");
    }
    const pages = [
      ...root.querySelectorAll<HTMLElement>(".welcome-burst-page"),
    ];
    expect(pages).toHaveLength(6);

    await new Promise((resolve) => setTimeout(resolve, 300));
    // The icon inside it is hidden with it.
    expect(getComputedStyle(root).opacity).toBe("0");
    for (const page of pages) {
      expect(page.getAnimations().map((a) => a.playState)).toEqual([
        "paused",
        "paused",
      ]);
    }

    release();
    // The browser tests zero every CSS duration, so a burst let go is over
    // at once; one still held reads paused.
    await vi.waitFor(() => {
      expect(pages[0]?.getAnimations()[0]?.playState).toBe("finished");
    });
    await vi.waitFor(() => {
      expect(getComputedStyle(root).opacity).toBe("1");
      expect(getComputedStyle(icon).opacity).toBe("1");
    });
  });
});
