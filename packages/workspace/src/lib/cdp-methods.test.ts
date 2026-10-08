import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import {
  CDP_METHODS,
  CDP_METHODS_READ_FROM,
  cdpHandlingOf,
  cdpMethodsHandled,
  isKnownCdpMethod,
} from "./cdp-methods";

describe("the table of CDP methods", () => {
  // The table lists what one agent-browser release sends, read from its
  // source. A new release can send a command nobody has decided about, so
  // moving to one fails here until its commands are read again and the table
  // and CDP_METHODS_READ_FROM move with it.
  it("was read from the agent-browser release that is installed", () => {
    const installed = createRequire(import.meta.url)(
      "agent-browser/package.json",
    ) as { version: string };
    expect(installed.version).toBe(CDP_METHODS_READ_FROM);
  });

  it("names each command as Domain.command", () => {
    for (const method of Object.keys(CDP_METHODS)) {
      expect(method).toMatch(/^[A-Z][A-Za-z]*\.[a-z][A-Za-z]*$/);
    }
  });

  it("says why for every command a side does not pass through", () => {
    const unexplained = Object.keys(CDP_METHODS)
      .filter(isKnownCdpMethod)
      .filter(
        (method) =>
          (["main", "session", "task"] as const).some(
            (side) => cdpHandlingOf(method, side) !== "passthrough",
          ) && !("why" in CDP_METHODS[method]),
      );
    expect(unexplained).toEqual([]);
  });

  it("lets the task endpoint fall back to what a session does", () => {
    expect(cdpHandlingOf("Page.navigate", "task")).toBe("wrapped");
    expect(cdpHandlingOf("Page.bringToFront", "session")).toBe("passthrough");
    expect(cdpHandlingOf("Page.bringToFront", "task")).toBe("override");
  });

  it("lists what the main process answers itself", () => {
    expect(cdpMethodsHandled("main", "override")).toMatchInlineSnapshot(`
      [
        "Browser.getWindowForTarget",
        "Browser.setContentsSize",
        "Browser.setDownloadBehavior",
        "Emulation.clearDeviceMetricsOverride",
        "Emulation.setDeviceMetricsOverride",
        "Page.captureScreenshot",
        "Page.printToPDF",
        "Page.reload",
        "Page.screencastFrameAck",
        "Page.startScreencast",
        "Page.stopScreencast",
      ]
    `);
  });
});
