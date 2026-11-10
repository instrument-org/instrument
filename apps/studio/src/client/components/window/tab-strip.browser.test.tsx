import { renderInBrowser } from "@/tests/render-browser";
import { MotionGlobalConfig } from "motion/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { describe, expect, it, onTestFinished } from "vitest";
import { userEvent } from "vitest/browser";

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

describe("a tab's long name", () => {
  it("is gone before its close button starts", async () => {
    await renderInBrowser(
      <div style={{ width: 800 }}>
        <TabStrip
          onClose={() => undefined}
          onSelect={() => undefined}
          selectedKey="long"
          tabs={[
            {
              icon: <span />,
              key: "long",
              title:
                "A name far too long to fit in any tab there could ever be",
            },
          ]}
        />
      </div>,
    );
    const title = tab("long").querySelector(".tab-title-fade");
    const close = tab("long").querySelector("button");
    if (!title || !close) {
      throw new Error("no title or close button");
    }
    const stops = [
      ...getComputedStyle(title).maskImage.matchAll(
        /calc\(100% - ([\d.]+)px\)/g,
      ),
    ].map((stop) => Number(stop[1]));
    const gone = title.getBoundingClientRect().right - Math.min(...stops);
    expect(gone).toBeLessThan(close.getBoundingClientRect().left);
  });
});

describe("a drag's start", () => {
  it("says how far the pointer had come from the press by then", async () => {
    const started: number[] = [];
    await renderInBrowser(
      <TabStrip
        onClose={() => undefined}
        onSelect={() => undefined}
        onTabDragStart={(_key, _event, moved) => {
          started.push(moved);
        }}
        selectedKey="b"
        tabs={tabs}
      />,
    );
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
    window.dispatchEvent(new PointerEvent("pointermove", at(left + 40)));
    await expect.poll(() => started.length).toBe(1);
    expect(started[0]).toBe(30);
    window.dispatchEvent(new PointerEvent("pointerup", at(left + 40)));
  });
});

describe("a tab taken out of the hand with the button still down", () => {
  it("settles from where it stood, having passed other tabs", async () => {
    let takeBack = () => undefined as void;
    let pass = (_left: number) => undefined as void;
    let isGoing = false;
    function Passed() {
      const [left, setLeft] = useState<number>();
      const [order, setOrder] = useState(tabs);
      takeBack = () => {
        setOrder(tabs);
        setLeft(undefined);
      };
      pass = (at) => {
        setOrder([tabs[0], tabs[2], tabs[1]].flatMap((each) => each ?? []));
        setLeft(at);
      };
      return (
        <TabStrip
          heldAt={left === undefined ? undefined : { key: "b", left }}
          onClose={() => undefined}
          onSelect={() => undefined}
          onTabDragStart={() => {
            isGoing = true;
          }}
          selectedKey="b"
          tabs={order}
        />
      );
    }
    await renderInBrowser(<Passed />);
    const box = () => tab("b").getBoundingClientRect();
    const { left: home, top, width } = box();
    const at = (clientX: number) => ({
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY: top + 4,
      isPrimary: true,
      pointerId: 1,
    });
    onTestFinished(() => {
      MotionGlobalConfig.useManualTiming = false;
      window.dispatchEvent(new PointerEvent("pointerup", at(home + 50)));
    });
    tab("b").dispatchEvent(new PointerEvent("pointerdown", at(home + 10)));
    window.dispatchEvent(new PointerEvent("pointermove", at(home + 50)));
    await expect.poll(() => isGoing).toBe(true);

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

  it("goes home and stays there, through more movement and the release", async () => {
    let takeBack = () => undefined as void;
    function Canceled() {
      const [left, setLeft] = useState<number>();
      const [isCanceled, setIsCanceled] = useState(false);
      takeBack = () => {
        setIsCanceled(true);
        setLeft(undefined);
      };
      return (
        <TabStrip
          heldAt={left === undefined ? undefined : { key: "b", left }}
          onClose={() => undefined}
          onSelect={() => undefined}
          onTabDrag={(_key, event) => {
            if (!isCanceled) {
              setLeft(event.clientX - 10);
            }
          }}
          selectedKey="b"
          tabs={tabs}
        />
      );
    }
    await renderInBrowser(<Canceled />);
    const leftOf = () => tab("b").getBoundingClientRect().left;
    const home = leftOf();
    const { top } = tab("b").getBoundingClientRect();
    const at = (clientX: number) => ({
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY: top + 4,
      isPrimary: true,
      pointerId: 1,
    });
    const nextFrame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve)),
      );
    tab("b").dispatchEvent(new PointerEvent("pointerdown", at(home + 10)));
    window.dispatchEvent(new PointerEvent("pointermove", at(home + 90)));
    await expect.poll(leftOf).toBeCloseTo(home + 80, 0);

    takeBack();
    await expect.poll(leftOf).toBeCloseTo(home, 0);

    window.dispatchEvent(new PointerEvent("pointermove", at(home + 200)));
    const seen: number[] = [];
    for (let frames = 0; frames < 6; frames += 1) {
      await nextFrame();
      seen.push(leftOf());
    }
    window.dispatchEvent(new PointerEvent("pointerup", at(home + 200)));
    for (let frames = 0; frames < 12; frames += 1) {
      await nextFrame();
      seen.push(leftOf());
    }

    expect(Math.max(...seen.map((left) => Math.abs(left - home)))).toBeLessThan(
      1,
    );
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
          onReorder={() => undefined}
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
          onReorder={() => undefined}
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
