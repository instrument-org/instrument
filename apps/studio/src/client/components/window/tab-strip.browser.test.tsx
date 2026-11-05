import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { TabStrip } from "./tab-strip";

const tabs = ["a", "b", "c"].map((key) => ({
  icon: <span />,
  key,
  title: key,
}));

function Strip({ carriedKey }: { carriedKey?: string }) {
  return (
    <TabStrip
      carriedKey={carriedKey}
      onClose={() => undefined}
      onReorder={() => undefined}
      onSelect={() => undefined}
      selectedKey="b"
      tabs={tabs}
    />
  );
}

const tab = (key: string) => {
  const element = document.querySelector(`[data-tab-key="${key}"]`);
  if (!element) {
    throw new Error(`no tab ${key}`);
  }
  return element;
};

describe("a tab carried off its strip", () => {
  it("gives its place up, and comes back drawn as it was", async () => {
    const screen = await renderInBrowser(<Strip />);
    const whole = tab("b").getBoundingClientRect().width;
    expect(whole).toBeGreaterThan(0);

    await screen.rerender(<Strip carriedKey="b" />);
    await expect.poll(() => tab("b").getBoundingClientRect().width).toBe(0);
    expect(getComputedStyle(tab("b")).opacity).toBe("0");

    await screen.rerender(<Strip />);
    await expect.poll(() => tab("b").getBoundingClientRect().width).toBe(whole);
    // Nothing of the collapse stays in what the tab draws with.
    expect(getComputedStyle(tab("b")).opacity).toBe("1");
    expect(tab("b").getAttribute("style")).not.toContain("opacity");
  });
});
