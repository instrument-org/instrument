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
  isAsked: true,
  isEditing: true,
  isFocused: true,
  place: "",
  query: "git",
};

const run = (state: OmnibarField, ...events: OmnibarFieldEvent[]) =>
  events.reduce(omnibarField, state);

describe("omnibarField", () => {
  it("writes only what each event names", () => {
    const cases = {
      clear: [editing, { type: "clear" }],
      edit: [
        { ...initialOmnibarField("~/code", false), isFocused: true },
        { type: "edit" },
      ],
      focus: [
        initialOmnibarField("~/code", false),
        { edits: true, type: "focus" },
      ],
      "focus, on a page gone on in itself": [
        initialOmnibarField("file:///Users/casey/w.html", false),
        {
          edits: true,
          place: "file:///Users/casey/w.html?frame=2",
          type: "focus",
        },
      ],
      "focus, from the keyboard": [
        initialOmnibarField("~/code", false),
        { edits: false, type: "focus" },
      ],
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
          "isAsked": true,
          "isEditing": true,
          "isFocused": true,
          "place": "",
          "query": "",
        },
        "edit": {
          "canComplete": false,
          "highlight": 0,
          "isAsked": true,
          "isEditing": true,
          "isFocused": true,
          "place": "~/code",
          "query": "~/code",
        },
        "focus": {
          "canComplete": false,
          "highlight": 0,
          "isAsked": false,
          "isEditing": true,
          "isFocused": true,
          "place": "~/code",
          "query": "~/code",
        },
        "focus, from the keyboard": {
          "canComplete": false,
          "highlight": 0,
          "isAsked": false,
          "isEditing": false,
          "isFocused": true,
          "place": "~/code",
          "query": "~/code",
        },
        "focus, on a page gone on in itself": {
          "canComplete": false,
          "highlight": 0,
          "isAsked": false,
          "isEditing": true,
          "isFocused": true,
          "place": "file:///Users/casey/w.html?frame=2",
          "query": "file:///Users/casey/w.html?frame=2",
        },
        "highlight": {
          "canComplete": true,
          "highlight": 3,
          "isAsked": true,
          "isEditing": true,
          "isFocused": true,
          "place": "",
          "query": "git",
        },
        "input, a letter at the end": {
          "canComplete": true,
          "highlight": 0,
          "isAsked": true,
          "isEditing": true,
          "isFocused": true,
          "place": "",
          "query": "gith",
        },
        "input, a letter taken away": {
          "canComplete": false,
          "highlight": 0,
          "isAsked": true,
          "isEditing": true,
          "isFocused": true,
          "place": "",
          "query": "gi",
        },
        "revert": {
          "canComplete": false,
          "highlight": 0,
          "isAsked": true,
          "isEditing": true,
          "isFocused": true,
          "place": "",
          "query": "git",
        },
        "take": {
          "canComplete": false,
          "highlight": 0,
          "isAsked": true,
          "isEditing": true,
          "isFocused": true,
          "place": "",
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
          "isAsked": false,
          "isEditing": false,
          "isFocused": false,
          "place": "~/code",
          "query": "~/code",
        }
      `);
  });

  it("keeps a new tab's words when the caret leaves", () => {
    expect(omnibarField(editing, { type: "blur" })).toMatchInlineSnapshot(`
      {
        "canComplete": false,
        "highlight": 0,
        "isAsked": false,
        "isEditing": false,
        "isFocused": false,
        "place": "",
        "query": "git",
      }
    `);
  });

  it("leaves a new tab empty new tab empty after it is put away", () => {
    expect(run(editing, { type: "clear" }, { type: "blur" }).query).toBe("");
  });

  it("keeps the place on show for a caret the keyboard brought, until a letter is typed", () => {
    const tabbedTo = run(initialOmnibarField("", false), {
      edits: false,
      type: "focus",
    });
    expect(tabbedTo.isEditing).toBe(false);
    expect(
      omnibarField(tabbedTo, { canComplete: true, query: "t", type: "input" })
        .isEditing,
    ).toBe(true);
  });

  it("opens a new tab for typing before it has focus", () => {
    expect(initialOmnibarField("", true)).toMatchInlineSnapshot(`
      {
        "canComplete": false,
        "highlight": 0,
        "isAsked": false,
        "isEditing": true,
        "isFocused": false,
        "place": "",
        "query": "",
      }
    `);
  });
});
