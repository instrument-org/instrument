import { describe, expect, it } from "vitest";

import { viewContextModelNote } from "./view-context-model-text";

describe("viewContextModelNote", () => {
  it("names what was picked to go with the message after the screen", () => {
    expect(
      viewContextModelNote({
        chosen: [
          {
            kind: "file",
            mount: "/Users/casey/Notes/plan.md",
            name: "plan.md",
            path: "/Users/casey/Notes/plan.md",
          },
          { kind: "folder", name: "Backup", path: "/Volumes/Backup" },
        ],
        screen: "home",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      When the user sent this, the window showed a new tab: the box that opens any screen or asks you. Nothing in particular is in view.
      </instrument-system-note>
      <instrument-system-note>
      They chose to send these with the message: the file \`/Users/casey/Notes/plan.md\` (you reach it at \`/Users/casey/Notes/plan.md\`); the folder \`/Volumes/Backup\` (no folder you can reach covers it yet: reading it asks the person first). "This", "these" and "it" refer to them first, then to what was on screen.
      </instrument-system-note>"
    `);
  });

  it("names another chat the user had open, and nothing in it", () => {
    expect(
      viewContextModelNote({
        chat: { id: "2026-10-02-porto", title: "Porto trip" },
        screen: "chat",
        tabs: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      When the user sent this, the window showed another chat, "Porto trip" ([Porto trip](instrument://chat/2026-10-02-porto)): its pages and tabs are that chat's, not yours to read or hand to a task. "That chat" refers to it.
      </instrument-system-note>"
    `);
  });

  it("names every tab by its id, and the task at work in one", () => {
    expect(
      viewContextModelNote({
        screen: "home",
        tabs: [
          { at: "/new-tab", id: "screen-1", title: "New tab" },
          {
            at: "https://example.com/",
            heldBy: { id: "read-the-page", title: "Read the page" },
            id: "ses_01M3AX9RF3C2E9RTATMB602W0B",
            title: "Example",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      When the user sent this, the window showed a new tab: the box that opens any screen or asks you. Nothing in particular is in view.
      </instrument-system-note>
      Tabs open in the window: "New tab" at /new-tab (tab screen-1); "Example" at https://example.com/ (tab ses_01M3AX9RF3C2E9RTATMB602W0B, task read-the-page is working in it)."
    `);
  });

  it("marks the task at work in the page on screen and in the others", () => {
    expect(
      viewContextModelNote({
        page: {
          tab: "ses_01M3AX9RF3C2E9RTATMB602W0B",
          tabs: [
            {
              heldBy: { id: "read-the-page", title: "Read the page" },
              id: "ses_01M3AX9RF3C2E9RTATMB602W0B",
              title: "Example",
              url: "https://example.com/",
            },
            {
              heldBy: { id: "compare-prices", title: "Compare prices" },
              id: "ses_01M3AX9RF3C2E9RTATMB602W0C",
              title: "Shop",
              url: "https://shop.example/",
            },
          ],
          title: "Example",
          url: "https://example.com/",
        },
        screen: "browser",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      When the user sent this, the browser showed "Example" at https://example.com/ (tab ses_01M3AX9RF3C2E9RTATMB602W0B, task read-the-page is working in it). "This page", "this site", "this" and "here" refer to it.
      Other tabs open but not on screen: "Shop" at https://shop.example/ (tab ses_01M3AX9RF3C2E9RTATMB602W0C, task compare-prices is working in it).
      </instrument-system-note>"
    `);
  });
});
