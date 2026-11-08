import { describe, expect, it } from "vitest";

import { viewContextModelNote } from "./view-context-model-text";

describe("viewContextModelNote", () => {
  // What may be done with what is on screen is the permission rules' to say
  // when the agent tries, so the note names the thing and nothing more.
  it("names a file or folder on screen without saying what the agent may do with it", () => {
    const folder = { display: "~/Notes", selected: [] };
    expect([
      viewContextModelNote({
        file: { name: "plan.md", path: "/Users/casey/Notes/plan.md" },
        folder,
        screen: "file",
      }),
      viewContextModelNote({ folder, screen: "computer" }),
    ]).toMatchInlineSnapshot(`
      [
        "
      <instrument-system-note>
      When the user sent this, the folder view showed the file \`/Users/casey/Notes/plan.md\` open. "This file", "this" and "it" refer to it. It sits in \`~/Notes\`, which "this folder" means.
      </instrument-system-note>",
        "
      <instrument-system-note>
      When the user sent this, the folder view showed the folder \`~/Notes\`. "This folder", "here", "in here" and "these" refer to that.
      </instrument-system-note>",
      ]
    `);
  });

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
      They chose to send these with the message: the file \`/Users/casey/Notes/plan.md\`; the folder \`/Volumes/Backup\`. "This", "these" and "it" refer to them first, then to what was on screen.
      </instrument-system-note>"
    `);
  });

  it("says the conversation was all that was in view", () => {
    expect(viewContextModelNote({ screen: "conversation", tabs: [] }))
      .toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      When the user sent this, the window showed this conversation, with nothing else in view beside it.
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
            id: "tab_01M3AX9RF3C2E9RTATMB602W0B",
            title: "Example",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      When the user sent this, the window showed a new tab: the box that opens any screen or asks you. Nothing in particular is in view.
      </instrument-system-note>
      Tabs open in the window: "New tab" at /new-tab (tab screen-1); "Example" at https://example.com/ (tab tab_01M3AX9RF3C2E9RTATMB602W0B, task read-the-page is working in it)."
    `);
  });

  it("names a page of the user's own outside the chat by its tab, and the two ways to work in it", () => {
    expect(
      viewContextModelNote({
        page: {
          tab: "tab_01M5Q1ZK8AAAAAAAAAAAAAAAAA",
          tabs: [],
          theirs: true,
          title: "Amazon.com. Spend less. Smile more.",
          url: "https://www.amazon.com/?ref_=nav_signin",
        },
        screen: "browser",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      When the user sent this, the browser showed "Amazon.com. Spend less. Smile more." at https://www.amazon.com/?ref_=nav_signin, in their own tab tab_01M5Q1ZK8AAAAAAAAAAAAAAAAA, outside this chat. "This page", "this site", "this" and "here" refer to it. To work in it, open its address in a tab of your own, which has their sign-ins but not what they typed or scrolled to, or \`instrument window request tab_01M5Q1ZK8AAAAAAAAAAAAAAAAA\` asks them to move this tab into the chat as it stands.
      This chat has no tabs.
      </instrument-system-note>"
    `);
  });

  it("marks the task at work in the page on screen and in the others", () => {
    expect(
      viewContextModelNote({
        page: {
          tab: "tab_01M3AX9RF3C2E9RTATMB602W0B",
          tabs: [
            {
              heldBy: { id: "read-the-page", title: "Read the page" },
              id: "tab_01M3AX9RF3C2E9RTATMB602W0B",
              title: "Example",
              url: "https://example.com/",
            },
            {
              heldBy: { id: "compare-prices", title: "Compare prices" },
              id: "tab_01M3AX9RF3C2E9RTATMB602W0C",
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
      When the user sent this, the browser showed "Example" at https://example.com/ (this chat's tab tab_01M3AX9RF3C2E9RTATMB602W0B, task read-the-page is working in it). "This page", "this site", "this" and "here" refer to it.
      This chat's other tabs, not on screen: "Shop" at https://shop.example/ (tab tab_01M3AX9RF3C2E9RTATMB602W0C, task compare-prices is working in it).
      </instrument-system-note>"
    `);
  });

  // Stored as the shell spelled them when the message was sent, so a chat
  // sent from Windows reads the same on a Mac.
  it("names files by the path the message stored for the agent", () => {
    const windows = (hostPath: string) =>
      `/c/${hostPath.slice(3).replaceAll("\\", "/")}`;
    const data = {
      chosen: [
        {
          agentPath: "/c/Users/sam/a.txt",
          kind: "file" as const,
          name: "a.txt",
          path: "C:\\Users\\sam\\a.txt",
        },
      ],
      file: {
        agentPath: "/c/Users/sam/b.txt",
        name: "b.txt",
        path: "C:\\Users\\sam\\b.txt",
      },
      screen: "file" as const,
    };
    const onMac = viewContextModelNote(data);
    expect(onMac).toContain("`/c/Users/sam/b.txt`");
    expect(onMac).toContain("`/c/Users/sam/a.txt`");
    expect(viewContextModelNote(data, windows)).toBe(onMac);
  });
});
