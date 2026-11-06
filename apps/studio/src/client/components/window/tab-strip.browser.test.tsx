import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
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

describe("a tab dragged in its own strip", () => {
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

  it("goes on being dragged in the hand, and stands where the hand says", async () => {
    const moves: number[] = [];
    let ended = 0;
    function Dragged() {
      const [left, setLeft] = useState<number>();
      return (
        <TabStrip
          heldAt={left === undefined ? undefined : { key: "b", left }}
          onClose={() => undefined}
          onSelect={() => undefined}
          onTabDrag={(_key, event) => {
            moves.push(event.clientX);
            setLeft(event.clientX - 10);
          }}
          onTabDragEnd={() => {
            ended += 1;
          }}
          selectedKey="b"
          tabs={tabs}
        />
      );
    }
    await renderInBrowser(<Dragged />);
    const { left, top } = tab("b").getBoundingClientRect();
    const at = (clientX: number) => ({
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY: top + 4,
      isPrimary: true,
      pointerId: 1,
    });
    tab("b").dispatchEvent(new PointerEvent("pointerdown", at(left + 10)));
    for (const x of [left + 30, left + 60, left + 90]) {
      window.dispatchEvent(new PointerEvent("pointermove", at(x)));
      await nextFrame();
      await nextFrame();
    }

    expect(ended).toBe(0);
    expect(moves.at(-1)).toBe(left + 90);
    await expect
      .poll(() => tab("b").getBoundingClientRect().left)
      .toBeCloseTo(left + 80, 0);

    window.dispatchEvent(new PointerEvent("pointerup", at(left + 90)));
    await expect.poll(() => ended).toBe(1);
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

  it("stays at the pointer while the row moves it with a transition, and has nothing left to give back", async () => {
    const WIDE = { width: "800px" };
    const Row = ({ carried, left }: { carried?: string; left?: number }) => (
      <div style={WIDE}>
        <TabStrip
          carriedKey={carried}
          heldAt={left === undefined ? undefined : { key: "held", left }}
          onClose={() => undefined}
          onSelect={() => undefined}
          selectedKey="held"
          tabs={orderedTabs(["a", "b", "c", "d", "held"])}
        />
      </div>
    );
    const screen = await renderInBrowser(<Row left={300} />);
    const leftOf = () => tab("held").getBoundingClientRect().left;
    await expect.poll(leftOf).toBeCloseTo(300, 0);

    // The row closing up behind it moves its place a long way, with no new pointer.
    await screen.rerender(<Row carried="held" left={300} />);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(leftOf()).toBeCloseTo(300, 0);

    await screen.rerender(<Row left={300} />);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(leftOf()).toBeCloseTo(300, 0);

    // Let go, it settles into the place the row has for it, with no offset left over.
    await screen.rerender(<Row />);
    await expect
      .poll(() => getComputedStyle(tab("held")).transform)
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
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
