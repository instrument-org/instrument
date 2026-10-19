import { afterEach, describe, expect, it, vi } from "vitest";

import { captureComponentError, captureOnce } from "./capture-exception";

describe("captureOnce", () => {
  const send = vi.fn(() => Promise.resolve({ fingerprint: "fp", id: "id" }));

  afterEach(() => {
    delete window.api.captureException;
    vi.restoreAllMocks();
  });

  it("sends an error once however often it is captured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.api.captureException = send;
    const error = new Error("shown on screen");

    const first = await captureOnce(error);
    const again = await captureOnce(error);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.lastCall).toMatchObject([
      { error: { type: "Error", value: "shown on screen" } },
    ]);
    expect(again).toBe(first);
  });

  it("names an error boundary and its component stack", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.api.captureException = send;

    captureComponentError(new Error("render"), { componentStack: "\n    at Row" });

    expect(send.mock.lastCall).toMatchObject([
      { context: { componentStack: "\n    at Row", mechanism: "error-boundary" } },
    ]);
  });
});
