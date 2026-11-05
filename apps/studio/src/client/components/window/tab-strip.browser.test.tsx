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

describe("a tab held over a strip from elsewhere", () => {
  const orderedTabs = (keys: string[]) =>
    keys.map((key) => ({ icon: <span />, key, title: key }));

  function Held({ left, order }: { left: number; order: string[] }) {
    return (
      <TabStrip
        heldAt={{ key: "held", left }}
        onClose={() => undefined}
        onReorder={() => undefined}
        onSelect={() => undefined}
        selectedKey="held"
        tabs={orderedTabs(order)}
      />
    );
  }

  it("stands at the pointer, wherever its place in the row has got to", async () => {
    const screen = await renderInBrowser(
      <Held left={150} order={["held", "a", "b"]} />,
    );
    const leftOf = () => tab("held").getBoundingClientRect().left;
    await expect.poll(leftOf).toBeCloseTo(150, 0);

    // Its place moves on to the far side of a tab, and it does not.
    await screen.rerender(<Held left={150} order={["a", "held", "b"]} />);
    await expect.poll(leftOf).toBeCloseTo(150, 0);

    await screen.rerender(<Held left={210} order={["a", "held", "b"]} />);
    await expect.poll(leftOf).toBeCloseTo(210, 0);
  });

  it("keeps inside the row, which cuts off anything past its ends", async () => {
    const screen = await renderInBrowser(
      <Held left={-200} order={["held", "a", "b"]} />,
    );
    const rowOf = () => {
      const row = tab("held").closest("[role=tablist]");
      if (!row) {
        throw new Error("no row");
      }
      return row.getBoundingClientRect();
    };
    await expect
      .poll(() => tab("held").getBoundingClientRect().left)
      .toBeCloseTo(rowOf().left, 0);

    await screen.rerender(<Held left={9000} order={["a", "b", "held"]} />);
    await expect
      .poll(() => tab("held").getBoundingClientRect().right)
      .toBeCloseTo(rowOf().right, 0);
  });
});
