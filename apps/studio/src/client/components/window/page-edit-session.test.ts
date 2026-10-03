import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, fromCallback } from "xstate";

import {
  ATTACH_RETRIES,
  COVER_HOLD_MS,
  COVER_TIMEOUT_MS,
  pageEditSessionMachine,
  type PageEditServeEvent,
} from "./page-edit-session";

function createHarness({ attachAfter = 0 }: { attachAfter?: number } = {}) {
  let looks = 0;
  const stops: string[] = [];
  let report: (event: PageEditServeEvent) => void = () => {};
  const actor = createActor(
    pageEditSessionMachine.provide({
      actors: {
        serve: fromCallback<{ type: "none" }, void, PageEditServeEvent>(
          ({ sendBack }) => {
            report = sendBack;
            return () => stops.push("serve");
          },
        ),
      },
      guards: { hasGuest: () => looks++ >= attachAfter },
    }),
  ).start();
  return {
    actor,
    cover: () => actor.getSnapshot().context.cover,
    guest: (state: "attaching" | "serving" | "unattached") =>
      actor.getSnapshot().matches({ guest: state }),
    looks: () => looks,
    report: (event: PageEditServeEvent) => {
      report(event);
    },
    stops,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("page edit session", () => {
  it("serves a guest that is already attached", () => {
    const h = createHarness();
    expect(h.guest("serving")).toBe(true);
  });

  it("looks again until the guest attaches", () => {
    const h = createHarness({ attachAfter: 3 });
    expect(h.guest("attaching")).toBe(true);
    vi.advanceTimersByTime(250 * 3);
    expect(h.guest("serving")).toBe(true);
  });

  it("stops looking after the last retry", () => {
    const h = createHarness({ attachAfter: Number.POSITIVE_INFINITY });
    vi.advanceTimersByTime(250 * (ATTACH_RETRIES + 5));
    expect(h.guest("unattached")).toBe(true);
    expect(h.looks()).toBe(ATTACH_RETRIES + 1);
  });

  it("holds the cover until a moment after the reloaded editor says hello", () => {
    const h = createHarness();
    h.report({ cover: "data:picture", type: "coverCaptured" });
    expect(h.cover()).toBe("data:picture");

    h.report({ type: "guestReady" });
    vi.advanceTimersByTime(COVER_HOLD_MS - 1);
    expect(h.cover()).toBe("data:picture");
    vi.advanceTimersByTime(1);
    expect(h.cover()).toBeNull();
  });

  it("drops the cover at once when the editor fails", () => {
    const h = createHarness();
    h.report({ cover: "data:picture", type: "coverCaptured" });
    h.report({ type: "editorFailed" });
    expect(h.cover()).toBeNull();
  });

  it("drops a cover that a reload never reports back on", () => {
    const h = createHarness();
    h.report({ cover: "data:picture", type: "coverCaptured" });
    vi.advanceTimersByTime(COVER_TIMEOUT_MS);
    expect(h.cover()).toBeNull();
  });

  it("restarts the hold for a reload that lands while the last cover is going", () => {
    const h = createHarness();
    h.report({ cover: "data:first", type: "coverCaptured" });
    h.report({ type: "guestReady" });
    h.report({ cover: "data:second", type: "coverCaptured" });
    vi.advanceTimersByTime(COVER_HOLD_MS);
    expect(h.cover()).toBe("data:second");
  });

  it("ends serving and every timer when stopped", () => {
    const h = createHarness();
    h.report({ cover: "data:picture", type: "coverCaptured" });
    h.actor.stop();
    expect(h.stops).toEqual(["serve"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
