import { renderInBrowser } from "@/tests/render-browser";
import { MotionGlobalConfig } from "motion/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { userEvent } from "vitest/browser";

import { dragPoint } from "./drag/session";
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

describe("a press on a tab", () => {
  it("is the owner's to make a drag of, the tab chosen first", async () => {
    const calls: string[] = [];
    await renderInBrowser(
      <TabStrip
        onClose={() => undefined}
        onSelect={(key) => {
          calls.push(`select ${key}`);
        }}
        onTabPress={(key) => {
          calls.push(`press ${key}`);
        }}
        selectedKey="b"
        tabs={tabs}
      />,
    );
    const { left, top } = tab("c").getBoundingClientRect();
    tab("c").dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: left + 10,
        clientY: top + 4,
        isPrimary: true,
      }),
    );
    expect(calls).toEqual(["select c", "press c"]);
  });
});

describe("a tab's name", () => {
  const strip = (title: string) =>
    renderInBrowser(
      <div style={{ width: 300 }}>
        <TabStrip
          onClose={() => undefined}
          onSelect={() => undefined}
          selectedKey="one"
          tabs={[{ icon: <span />, key: "one", title }]}
        />
      </div>,
    );

  it("fades out before its close button starts when it is too long", async () => {
    await strip("A name far too long to fit in any tab there could ever be");
    const title = tab("one").querySelector(".title-fade");
    const close = tab("one").querySelector("button");
    if (!title || !close) {
      throw new Error("no title or close button");
    }
    const stops = [
      ...getComputedStyle(title).maskImage.matchAll(
        /calc\(100% - ([\d.]+)px\)/g,
      ),
    ].map((stop) => Number(stop[1]));
    expect(stops).toHaveLength(2);
    const gone = title.getBoundingClientRect().right - Math.min(...stops);
    expect(gone).toBeLessThan(close.getBoundingClientRect().left);
  });

  it("shows whole, unfaded, when it fits", async () => {
    await strip("Short");
    const title = tab("one").querySelector(".title-fade");
    expect(title && getComputedStyle(title).maskImage).toBe("none");
  });
});

describe("a tab let go after passing other tabs", () => {
  it("settles from where it stood", async () => {
    let takeBack = () => undefined as void;
    let pass = (_left: number) => undefined as void;
    function Passed() {
      const [isHeld, setHeld] = useState(false);
      const [order, setOrder] = useState(tabs);
      takeBack = () => {
        setOrder(tabs);
        setHeld(false);
      };
      pass = (at) => {
        dragPoint.x = at;
        setOrder([tabs[0], tabs[2], tabs[1]].flatMap((each) => each ?? []));
        setHeld(true);
      };
      return (
        <TabStrip
          heldAt={isHeld ? { grabX: 0, key: "b" } : undefined}
          onClose={() => undefined}
          onSelect={() => undefined}
          selectedKey="b"
          tabs={order}
        />
      );
    }
    await renderInBrowser(<Passed />);
    const box = () => tab("b").getBoundingClientRect();
    const { left: home, width } = box();
    onTestFinished(() => {
      MotionGlobalConfig.useManualTiming = false;
    });

    const stood = home + width + 20;
    pass(stood);
    await expect.poll(() => box().left).toBeCloseTo(stood, 0);

    // With Motion's clock stopped the settle stays at its first frame, however slow
    // the machine: what is drawn then is where it starts from.
    MotionGlobalConfig.useManualTiming = true;
    flushSync(takeBack);
    for (let frame = 0; frame < 2; frame += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
    }
    expect(box().left).toBeCloseTo(stood, 0);

    MotionGlobalConfig.useManualTiming = false;
    await expect.poll(() => box().left).toBeCloseTo(home, 0);
  });
});

describe("a tab held over a strip from elsewhere", () => {
  const orderedTabs = (keys: string[]) =>
    keys.map((key) => ({ icon: <span />, key, title: key }));

  // The pointer stands at the window's left edge, and the tab's left edge
  // at `left` from it.
  beforeEach(() => {
    dragPoint.x = 0;
  });

  function Held({ left, order }: { left: number; order: string[] }) {
    return (
      <TabStrip
        heldAt={{ grabX: -left, key: "held" }}
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
    const Row = ({ carried, left }: { carried?: string; left?: number }) => {
      return (
        <div style={WIDE}>
          <TabStrip
            carriedKey={carried}
            heldAt={
              left === undefined ? undefined : { grabX: -left, key: "held" }
            }
            onClose={() => undefined}
            onSelect={() => undefined}
            selectedKey="held"
            tabs={orderedTabs(["a", "b", "c", "d", "held"])}
          />
        </div>
      );
    };
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

describe("a strip that scrolls", () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    icon: <span />,
    key: `t${index}`,
    title: `Tab ${index}`,
  }));
  function Scrolling({
    selectedKey,
    shown,
  }: {
    selectedKey: string;
    shown: typeof many;
  }) {
    return (
      <div style={{ width: 400 }}>
        <TabStrip
          onClose={() => undefined}
          onSelect={() => undefined}
          overflow="scroll"
          selectedKey={selectedKey}
          tabs={shown}
        />
      </div>
    );
  }
  const scroller = () => {
    const element = tab("t0").closest<HTMLElement>(".overflow-x-auto");
    if (!element) {
      throw new Error("no scroller");
    }
    return element;
  };

  it("keeps each tab at its width, and the tab up in view", async () => {
    const screen = await renderInBrowser(
      <Scrolling selectedKey="t0" shown={many} />,
    );
    const width = tab("t0").getBoundingClientRect().width;
    expect(tab("t11").getBoundingClientRect().width).toBe(width);
    expect(scroller().scrollWidth).toBeGreaterThan(scroller().clientWidth);

    await screen.rerender(<Scrolling selectedKey="t11" shown={many} />);
    await expect
      .poll(() => {
        const box = scroller().getBoundingClientRect();
        return tab("t11").getBoundingClientRect().right <= box.right;
      })
      .toBe(true);
  });

  it("grows a tab in and collapses one closed to nothing", async () => {
    const few = many.slice(0, 2);
    const screen = await renderInBrowser(
      <Scrolling selectedKey="t0" shown={few} />,
    );
    const whole = tab("t0").getBoundingClientRect().width;

    await screen.rerender(
      <Scrolling selectedKey="t0" shown={many.slice(0, 3)} />,
    );
    // The setup cuts CSS motion to nothing, so what is seen is the motion
    // being asked for and where it lands.
    expect(tab("t2").classList).toContain("pane-tab-arriving");
    await expect
      .poll(() => tab("t2").getBoundingClientRect().width)
      .toBe(whole);

    await screen.rerender(<Scrolling selectedKey="t0" shown={few} />);
    expect(tab("t2").getAttribute("aria-hidden")).toBe("true");
    await expect.poll(() => tab("t2").getBoundingClientRect().width).toBe(0);
  });
});

describe("a strip that squeezes", () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    icon: <span />,
    key: `t${index}`,
    title: `Tab ${index}`,
  }));
  function Squeezing({ count, width }: { count: number; width: number }) {
    return (
      <div style={{ width }}>
        <TabStrip
          onClose={() => undefined}
          onSelect={() => undefined}
          overflow="squeeze"
          selectedKey="t0"
          tabs={many.slice(0, count)}
        />
      </div>
    );
  }
  const scroller = () => document.querySelector(".overflow-x-auto");

  it("narrows its tabs before it scrolls", async () => {
    await renderInBrowser(<Squeezing count={8} width={400} />);
    expect(scroller()).toBeNull();
    expect(tab("t7").getBoundingClientRect().width).toBeLessThan(80);
  });

  it("scrolls its tabs as icons, the one up named, once icons no longer fit", async () => {
    await renderInBrowser(<Squeezing count={30} width={400} />);
    await expect.poll(() => scroller() !== null).toBe(true);
    expect(tab("t29").getBoundingClientRect().width).toBe(32);
    expect(tab("t0").getBoundingClientRect().width).toBeGreaterThan(32);
    const row = scroller();
    expect(row && row.scrollWidth > row.clientWidth).toBe(true);
  });
});

describe("a page tab's tooltip", () => {
  it("keeps a long address inside it", async () => {
    const address = `example.com/${"a-very-long-path-segment-".repeat(12)}?q=${"x".repeat(80)}`;
    await renderInBrowser(
      <TabStrip
        onClose={() => undefined}
        onSelect={() => undefined}
        selectedKey="a"
        tabs={[
          {
            icon: <span />,
            key: "a",
            title: "A page",
            tooltip: { detail: address, title: "A page" },
          },
        ]}
      />,
    );

    await userEvent.hover(tab("a"));
    const tooltip = () =>
      document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
    await expect.poll(tooltip).toBeTruthy();
    const content = tooltip();
    if (!content) {
      throw new Error("no tooltip");
    }
    const detail = [...content.querySelectorAll("div")].find(
      (element) => element.textContent === address,
    );
    if (!detail) {
      throw new Error("no address line");
    }

    expect(detail.scrollWidth).toBeLessThanOrEqual(detail.clientWidth);
    expect(detail.getBoundingClientRect().right).toBeLessThanOrEqual(
      content.getBoundingClientRect().right,
    );
  });
});
