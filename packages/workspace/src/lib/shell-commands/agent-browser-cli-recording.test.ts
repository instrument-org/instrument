import { describe, expect, it } from "vitest";

import { installedAgentBrowser } from "../agent-browser-guide-source";
import { AGENT_BROWSER_OUTPUT_RECORDED_FROM } from "./agent-browser-cli-output.generated";

// The tests that read the CLI's help and snapshots read a recording of them,
// so the only time a browser runs for them is when a new release is recorded.
describe("the recorded agent-browser output", () => {
  it("was recorded from the agent-browser release that is installed (run script:record-agent-browser-output)", () => {
    expect(AGENT_BROWSER_OUTPUT_RECORDED_FROM).toBe(
      installedAgentBrowser().version,
    );
  });
});
