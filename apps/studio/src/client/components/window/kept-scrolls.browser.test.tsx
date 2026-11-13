import { forgetTab } from "@/client/lib/kept-by-tab";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { KeptScrolls } from "./kept-scrolls";

const DOCUMENT = "/files?file=%2Fhome%2Fnotes.md";

/** A group tab's screen with a document to scroll, drawn or put away as its tab is up or not. */
async function drawGroup() {
  const screen = (tabId: string, href: string) => (
    <KeptScrolls href={href} key={tabId} tabId={tabId}>
      <div data-scroller="" style={{ height: 200, overflow: "auto" }}>
        <div style={{ height: 3000 }} />
      </div>
    </KeptScrolls>
  );
  const rendered = await renderInBrowser(screen("tab-1", DOCUMENT));
  const scroller = () => {
    const found = document.querySelector("[data-scroller]");
    if (!found) {
      throw new Error("no scroller");
    }
    return found;
  };
  const show = async (tabId: string, href = DOCUMENT) => {
    await rendered.rerender(screen(tabId, href));
  };
  return { scroller, show };
}

/** Once what was scrolled has said so, and once what came back has been laid out and put back. */
const nextFrames = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

describe("a group tab's screen drawn again as its tab comes back up", () => {
  it("is scrolled where it was left", async () => {
    const group = await drawGroup();
    group.scroller().scrollTop = 900;
    await nextFrames();

    await group.show("tab-2");
    expect(group.scroller().scrollTop).toBe(0);
    await group.show("tab-1");
    await nextFrames();

    expect(group.scroller().scrollTop).toBe(900);
    forgetTab("tab-1");
  });

  it("starts at the top once the tab was sent somewhere else", async () => {
    const group = await drawGroup();
    group.scroller().scrollTop = 900;
    await nextFrames();

    await group.show("tab-2");
    await group.show("tab-1", "/files?file=%2Fhome%2Fother.md");
    await nextFrames();

    expect(group.scroller().scrollTop).toBe(0);
    forgetTab("tab-1");
  });

  it("starts at the top once its tab was closed and its id is let go", async () => {
    const group = await drawGroup();
    group.scroller().scrollTop = 900;
    await nextFrames();

    await group.show("tab-2");
    forgetTab("tab-1");
    await group.show("tab-1");
    await nextFrames();

    expect(group.scroller().scrollTop).toBe(0);
  });
});
