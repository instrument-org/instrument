import { describe, expect, it } from "vitest";

import { parseAppFile, renderAppFile, unusedAppName } from "./app-file";

const notion = [
  "---",
  "id: notion",
  "type: api",
  "url: https://api.notion.com/v1",
  "auth:",
  "  kind: bearer",
  "headers:",
  "  Notion-Version: 2022-06-28",
  "test:",
  "  path: /users/me",
  "service: notion",
  "account: jeremy@pileofturtles.com",
  "---",
  "",
  "What this app is for, and the endpoints the work needs.",
  "",
].join("\n");

describe("reading an app's file", () => {
  it("reads the manifest as front matter over the guide", () => {
    const read = parseAppFile(notion);

    expect(read).toMatchInlineSnapshot(`
      {
        "app": {
          "guide": "What this app is for, and the endpoints the work needs.",
          "id": "notion",
          "manifest": {
            "account": "jeremy@pileofturtles.com",
            "auth": {
              "kind": "bearer",
            },
            "headers": {
              "Notion-Version": "2022-06-28",
            },
            "service": "notion",
            "test": {
              "path": "/users/me",
            },
            "type": "api",
            "url": "https://api.notion.com/v1",
          },
        },
        "kind": "app",
      }
    `);
  });

  it("writes back what it read, byte for byte", () => {
    const read = parseAppFile(notion);

    expect(read.kind === "app" && renderAppFile(read.app)).toBe(notion);
  });

  it("keeps a key this build does not know where it was found", () => {
    const withNote = notion.replace(
      "service: notion",
      "service: notion\nmine:\n  - a note of my own",
    );

    const read = parseAppFile(withNote);

    expect(read.kind === "app" && read.app.others).toMatchInlineSnapshot(`
      {
        "mine": [
          "a note of my own",
        ],
      }
    `);
    expect(read.kind === "app" && renderAppFile(read.app)).toContain(
      "mine:\n  - a note of my own",
    );
  });

  it.each([
    ["no front matter", "Just a note I left in the folder.\n"],
    ["front matter naming no app", "---\nnote: mine\n---\n"],
    ["front matter that is not YAML", "---\n\tid: :\n---\n"],
  ])("reads %s as no app at all", (_what, text) => {
    expect(parseAppFile(text).kind).toBe("none");
  });

  it.each([
    ["an id no app could have", "---\nid: Notion\ntype: web\nurl: x\n---\n"],
    ["a setup it cannot read", "---\nid: notion\ntype: api\n---\n"],
  ])("reads %s as an app to say something about", (_what, text) => {
    expect(parseAppFile(text).kind).toBe("invalid");
  });
});

describe("the name a new app's folder takes", () => {
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
