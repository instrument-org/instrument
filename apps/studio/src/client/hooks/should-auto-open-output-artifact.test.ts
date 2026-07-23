import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { shouldAutoOpenOutputArtifact } from "./should-auto-open-output-artifact";

const sessionId = StoreId.newSessionId();

describe("shouldAutoOpenOutputArtifact", () => {
  it("opens a completed output for the selected session", () => {
    expect(
      shouldAutoOpenOutputArtifact({
        eventSessionId: sessionId,
        fileCount: 1,
        selectedSessionId: sessionId,
      }),
    ).toBe(true);
  });

  it("ignores output from a different session", () => {
    expect(
      shouldAutoOpenOutputArtifact({
        eventSessionId: StoreId.newSessionId(),
        fileCount: 1,
        selectedSessionId: sessionId,
      }),
    ).toBe(false);
  });

  it("opens the first file when multiple outputs are created", () => {
    expect(
      shouldAutoOpenOutputArtifact({
        eventSessionId: sessionId,
        fileCount: 2,
        selectedSessionId: sessionId,
      }),
    ).toBe(true);
  });

  it("ignores an event with no output files", () => {
    expect(
      shouldAutoOpenOutputArtifact({
        eventSessionId: sessionId,
        fileCount: 0,
        selectedSessionId: sessionId,
      }),
    ).toBe(false);
  });
});
