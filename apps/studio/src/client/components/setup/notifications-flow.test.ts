import { describe, expect, it } from "vitest";

import {
  continueFor,
  type NotificationsEvent,
  notificationsStep,
  type NotificationsState,
} from "./notifications-flow";

const run = (...events: NotificationsEvent[]) =>
  events.reduce<NotificationsState>(notificationsStep, "ask");

describe("notificationsStep", () => {
  it("goes from Allow to the test notification to allowed", () => {
    expect(
      run(
        { type: "allow" },
        { granted: true, type: "answered" },
        {
          type: "clicked",
        },
      ),
    ).toBe("allowed");
    expect(continueFor("allowed")).toBe("primary");
  });

  it("says the system refused, and leaves Continue as a skip", () => {
    const state = run({ type: "allow" }, { granted: false, type: "answered" });
    expect(state).toBe("off");
    expect(continueFor(state)).toBe("quiet");
  });

  it("keeps waiting on a click that never came, with Continue still there", () => {
    const state = run({ type: "allow" }, { granted: true, type: "answered" });
    expect(state).toBe("sent");
    expect(continueFor(state)).toBe("quiet");
  });

  it("ignores a click before anything was sent and a late prompt answer", () => {
    expect(run({ type: "clicked" })).toBe("ask");
    expect(run({ granted: true, type: "answered" })).toBe("ask");
  });
});
