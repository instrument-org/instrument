import { describe, expect, it } from "vitest";

import {
  continueFor,
  footerLabelFor,
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

  it("reads as allowed once a refusal is turned on in the system's settings", () => {
    const state = run(
      { type: "allow" },
      { granted: false, type: "answered" },
      { type: "turnedOn" },
    );
    expect(state).toBe("allowed");
    expect(continueFor(state)).toBe("primary");
    expect(run({ type: "turnedOn" })).toBe("ask");
  });

  it("keeps waiting on a click that never came, with Continue still there", () => {
    const state = run({ type: "allow" }, { granted: true, type: "answered" });
    expect(state).toBe("sent");
    expect(continueFor(state)).toBe("quiet");
  });

  it("tells a refusal with no prompt shown from a person's no", () => {
    const state = run(
      { type: "allow" },
      { blocked: true, granted: false, type: "answered" },
    );
    expect(state).toBe("blocked");
    expect(footerLabelFor(state)).toBe("Skip");
    expect(
      run(
        { type: "allow" },
        { blocked: true, granted: false, type: "answered" },
        { type: "turnedOn" },
      ),
    ).toBe("allowed");
  });

  it("labels the footer Continue once notifications are on", () => {
    expect(footerLabelFor("sent")).toBe("Continue");
    expect(footerLabelFor("allowed")).toBe("Continue");
    expect(footerLabelFor("asking")).toBe("Skip");
    expect(footerLabelFor("off")).toBe("Skip");
  });

  it("ignores a click before anything was sent and a late prompt answer", () => {
    expect(run({ type: "clicked" })).toBe("ask");
    expect(run({ granted: true, type: "answered" })).toBe("ask");
  });
});
