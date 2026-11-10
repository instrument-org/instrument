import { describe, expect, it } from "vitest";

import { setupChangesHeading } from "./setup-change-sentence";

describe("setupChangesHeading", () => {
  it.each([
    ["memory", ["added"]],
    ["memory", ["added", "added"]],
    ["memory", ["removed"]],
    ["memory", ["added", "changed", "removed"]],
    ["skill", ["added", "changed"]],
    ["skill", ["changed"]],
    ["app", ["added"]],
    ["app", ["removed", "removed"]],
  ] as const)("%s %j", (kind, done) => {
    expect(
      setupChangesHeading(
        kind,
        done.map((change) => ({ change })),
      ),
    ).toMatchSnapshot();
  });
});
