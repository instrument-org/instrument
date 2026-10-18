import { describe, expect, it } from "vitest";

import { SessionMessageDataPart } from "./message-data-part";

describe("CADENCE", () => {
  it("names every part, so one added without a cadence does not compile", () => {
    expect(Object.keys(SessionMessageDataPart.CADENCE).toSorted()).toEqual(
      [...SessionMessageDataPart.NameSchema.options].toSorted(),
    );
  });

  it("calls the parts that carry a whole standing picture state", () => {
    const state = Object.entries(SessionMessageDataPart.CADENCE)
      .filter(([, cadence]) => cadence === "state")
      .map(([name]) => name)
      .toSorted();
    expect(state).toMatchInlineSnapshot(`
      [
        "backgroundProcesses",
        "browserStatus",
        "memory",
        "topic",
        "viewContext",
        "workspaceInstructions",
      ]
    `);
  });

  it("writes nothing under the three retired names", () => {
    const unwritten = Object.entries(SessionMessageDataPart.CADENCE)
      .filter(([, cadence]) => cadence === "unwritten")
      .map(([name]) => name)
      .toSorted();
    expect(unwritten).toEqual(["chatContext", "fileChanges", "unknown"]);
  });
});
