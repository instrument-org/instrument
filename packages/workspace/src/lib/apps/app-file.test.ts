import { describe, expect, it } from "vitest";

import { appFileOf, unusedAppName } from "./app-file";

const notion = {
  account: "name@example.com",
  auth: { kind: "bearer" },
  headers: { "Notion-Version": "2022-06-28" },
  id: "notion",
  service: "notion",
  test: { path: "/users/me" },
  type: "api",
  url: "https://api.notion.com/v1",
};

describe("reading an app's record", () => {
  it("reads the manifest from the keys this build knows, beside the guide", () => {
    const read = appFileOf(notion, { guide: "What it is for.\n" });

    expect(read.kind === "app" && read.app.guide).toBe("What it is for.");
    expect(read.kind === "app" && read.app.manifest.type).toBe("api");
  });

  it("keeps a key this build does not know apart from the manifest", () => {
    const read = appFileOf({ ...notion, mine: ["a note of my own"] });

    expect(read.kind === "app" && read.app.others).toEqual({
      mine: ["a note of my own"],
    });
    expect(read.kind === "app" && "mine" in read.app.manifest).toBe(false);
  });

  it("reads a record naming no app as none", () => {
    expect(appFileOf({ note: "mine" }).kind).toBe("none");
  });

  it.each([
    ["an id no app could have", { ...notion, id: "Notion" }],
    ["a setup it cannot read", { id: "notion", type: "api" }],
  ])("reads %s as an app to say something about", (_what, record) => {
    expect(appFileOf(record).kind).toBe("invalid");
  });

  it("names the record in what it says about one it cannot read", () => {
    const read = appFileOf(
      { id: "notion", type: "api" },
      { what: "notion's setup" },
    );
    expect(read.kind === "invalid" && read.message).toMatch(
      /^notion's setup is invalid: /,
    );
  });
});

describe("the name a new app takes", () => {
  it.each([
    { expected: "Gmail", name: "Gmail", taken: [] as string[] },
    { expected: "Gmail 2", name: "Gmail", taken: ["Gmail"] },
    { expected: "Gmail 3", name: "Gmail", taken: ["Gmail", "gmail 2"] },
    { expected: "Google-Drive", name: "Google/Drive", taken: [] },
    { expected: "App", name: " . ", taken: [] },
  ])("is $expected for $name", ({ expected, name, taken }) => {
    expect(unusedAppName(name, taken)).toBe(expected);
  });
});
