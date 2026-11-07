import { describe, expect, it } from "vitest";

import { captureTabView, restoreTabView } from "./tab-view-state";

function drawTab() {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-scroller style="height: 100px; overflow: auto">
      <div style="height: 1000px"><button>first</button><button>second</button></div>
    </div>`;
  document.body.append(root);
  return root;
}

const scroller = (root: HTMLElement) => {
  const element = root.querySelector("[data-scroller]");
  if (!element) {
    throw new Error("no scroller");
  }
  return element;
};

describe("a tab's view, carried to another window", () => {
  it("comes back with its keyboard and scrolling where they stood", async () => {
    const leaving = drawTab();
    scroller(leaving).scrollTop = 300;
    leaving.querySelectorAll("button")[1]?.focus({ preventScroll: true });
    const view = captureTabView(leaving);
    leaving.remove();
    expect(view?.scrolls.map(({ top }) => top)).toEqual([300]);

    const arriving = drawTab();
    await new Promise<void>((resolve) => {
      if (view) {
        restoreTabView(arriving, view, resolve);
      }
    });
    expect(scroller(arriving).scrollTop).toBe(300);
    expect(document.activeElement).toBe(arriving.querySelectorAll("button")[1]);
    arriving.remove();
  });

  it("waits for what it stood on to come in", async () => {
    const leaving = drawTab();
    leaving.querySelectorAll("button")[1]?.focus();
    const view = captureTabView(leaving);
    leaving.remove();

    const arriving = document.createElement("div");
    document.body.append(arriving);
    const done = new Promise<void>((resolve) => {
      if (view) {
        restoreTabView(arriving, view, resolve);
      }
    });
    arriving.innerHTML = `<div><div><button>first</button><button>second</button></div></div>`;
    await done;
    expect(document.activeElement).toBe(arriving.querySelectorAll("button")[1]);
    arriving.remove();
  });
});
