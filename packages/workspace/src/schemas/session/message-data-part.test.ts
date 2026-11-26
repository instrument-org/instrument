import { describe, expect, it } from "vitest";

import { SessionMessageDataPart } from "./message-data-part";

describe("KINDS", () => {
  it("names every part, so one added without its answers does not compile", () => {
    expect(Object.keys(SessionMessageDataPart.KINDS).toSorted()).toEqual(
      [...SessionMessageDataPart.NameSchema.options].toSorted(),
    );
  });

  it("calls the parts that carry a whole standing picture state", () => {
    const state = Object.entries(SessionMessageDataPart.KINDS)
      .filter(([, { cadence }]) => cadence === "state")
      .map(([name]) => name)
      .toSorted();
    expect(state).toMatchInlineSnapshot(`
      [
        "browserStatus",
        "project",
        "viewContext",
        "workspaceInstructions",
      ]
    `);
  });

  it("writes nothing under the three retired names, or the mark a running turn keeps", () => {
    const unwritten = Object.entries(SessionMessageDataPart.KINDS)
      .filter(([, { cadence }]) => cadence === "unwritten")
      .map(([name]) => name)
      .toSorted();
    expect(unwritten).toEqual([
      "chatContext",
      "fileChanges",
      "summarizing",
      "unknown",
    ]);
  });

  it.each(["person", "chat", "app"] as const)(
    "says which parts make a message the %s's",
    (wanted) => {
      expect(
        Object.entries(SessionMessageDataPart.KINDS)
          .filter(([, { author }]) => author === wanted)
          .map(([name]) => name)
          .toSorted()
          .join(" "),
      ).toBe(
        {
          app: "appEvent branchedFrom jobEvent pageTakeover permissionAnswer questionAnswer signedIn taskEvent",
          chat: "fromChat",
          person: "asks attachments skillMentions",
        }[wanted],
      );
    },
  );
});
