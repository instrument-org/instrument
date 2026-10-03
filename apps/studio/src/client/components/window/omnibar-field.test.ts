import { describe, expect, it } from "vitest";

import {
  type OmnibarField,
  type OmnibarFieldEvent,
  initialOmnibarField,
  omnibarField,
} from "./omnibar-field";

/** A field mid-edit: a row picked and a completion allowed, so every reset shows. */
const editing: OmnibarField = {
  canComplete: true,
  highlight: 2,
  isEditing: true,
  isFocused: true,
  query: "git",
};

const run = (state: OmnibarField, ...events: OmnibarFieldEvent[]) =>
  events.reduce(omnibarField, state);

describe("omnibarField", () => {
  it("writes only what each event names", () => {
    const cases = {
      clear: [editing, { type: "clear" }],
      focus: [initialOmnibarField("~/code", false), { type: "focus" }],
      highlight: [editing, { index: 3, type: "highlight" }],
      "input, a letter at the end": [
        editing,
        { canComplete: true, query: "gith", type: "input" },
      ],
      "input, a letter taken away": [
        editing,
        { canComplete: false, query: "gi", type: "input" },
      ],
      revert: [editing, { type: "revert" }],
      take: [editing, { query: "github.com", type: "take" }],
    } satisfies Record<string, [OmnibarField, OmnibarFieldEvent]>;
    expect(
      Object.fromEntries(
        Object.entries(cases).map(([name, [state, event]]) => [
          name,
          omnibarField(state, event),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "clear": {
          "canComplete": true,
          "highlight": 2,
          "isEditing": true,
          "isFocused": true,
          "query": "",
        },
        "focus": {
          "canComplete": false,
          "highlight": 0,
          "isEditing": true,
          "isFocused": true,
          "query": "~/code",
        },
        "highlight": {
          "canComplete": true,
          "highlight": 3,
          "isEditing": true,
          "isFocused": true,
          "query": "git",
        },
        "input, a letter at the end": {
          "canComplete": true,
          "highlight": 0,
          "isEditing": true,
          "isFocused": true,
          "query": "gith",
        },
        "input, a letter taken away": {
          "canComplete": false,
          "highlight": 0,
          "isEditing": true,
          "isFocused": true,
          "query": "gi",
        },
        "revert": {
          "canComplete": false,
          "highlight": 0,
          "isEditing": true,
          "isFocused": true,
          "query": "git",
        },
        "take": {
          "canComplete": false,
          "highlight": 0,
          "isEditing": true,
          "isFocused": true,
          "query": "github.com",
        },
      }
    `);
  });

  it("puts a place's name back in the box when the caret leaves", () => {
    expect(omnibarField(editing, { place: "~/code", type: "blur" }))
      .toMatchInlineSnapshot(`
        {
          "canComplete": false,
          "highlight": 0,
          "isEditing": false,
          "isFocused": false,
          "query": "~/code",
        }
      `);
  });

  it("keeps a new tab's words when the caret leaves", () => {
    expect(omnibarField(editing, { type: "blur" })).toMatchInlineSnapshot(`
      {
        "canComplete": false,
        "highlight": 0,
        "isEditing": false,
        "isFocused": false,
        "query": "git",
      }
    `);
  });

  it("leaves a new tab empty new tab empty after it is put away", () => {
    expect(run(editing, { type: "clear" }, { type: "blur" }).query).toBe("");
  });

  it("opens a new tab for typing before it has focus", () => {
    expect(initialOmnibarField("", true)).toMatchInlineSnapshot(`
      {
        "canComplete": false,
        "highlight": 0,
        "isEditing": true,
        "isFocused": false,
        "query": "",
      }
    `);
  });
});
