import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import {
  foregroundBrowser,
  registerForegroundBrowser,
} from "./foreground-browser-registry";

const TARGET_ID = "task_1/session_1" as BrowserTargetId;

describe("the foreground browser", () => {
  it("is the panel registered, until it lets go", () => {
    const panel = { openFind: vi.fn(), targetId: TARGET_ID };
    const unregister = registerForegroundBrowser(panel);
    expect(foregroundBrowser()).toBe(panel);

    unregister();
    expect(foregroundBrowser()).toBeNull();
  });

  it("keeps the newly-registered panel when the outgoing one unregisters late", () => {
    const outgoing = { openFind: vi.fn(), targetId: TARGET_ID };
    const unregisterOutgoing = registerForegroundBrowser(outgoing);
    const incoming = { openFind: vi.fn(), targetId: TARGET_ID };
    registerForegroundBrowser(incoming);
    unregisterOutgoing();

    expect(foregroundBrowser()).toBe(incoming);
  });
});
