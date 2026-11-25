import assert from "node:assert/strict";
import { test } from "node:test";

import { describeLook, menuLines } from "./look.mjs";

const tab = (title, isUp, kind = "screen", address = "/chats") => ({ address, id: title, isUp, kind, title });

test("the summary lists groups, sides with the keyboard, and what is up", () => {
  const text = describeLook(
    {
      groups: [
        { id: "a", isPinned: false, isUp: true, sides: [
          { hasKeyboard: false, tabs: [tab("Budget", true)] },
          { hasKeyboard: true, tabs: [tab("New Tab", false), tab("Example", true, "page", "https://example.com/")] },
        ] },
        { id: "b", isPinned: true, isUp: false, sides: [{ hasKeyboard: true, tabs: [tab("Notes", true)] }] },
      ],
      path: "/chats",
      project: null,
      sidebarOpen: true,
      theme: "light",
      window: { height: 800, width: 1200, zoom: 1 },
    },
    { dialogs: ["Rename"], toasts: ["Tab closed Undo"] },
  );
  assert.equal(
    text,
    [
      "window 1200x800, light, sidebar open",
      "groups:",
      "  ▶ Budget | Example",
      "      left: [Budget]",
      "      right (keyboard): New Tab [Example]",
      "    Notes (pinned)",
      "up: page https://example.com/",
      "dialog: Rename",
      "toast: Tab closed Undo",
    ].join("\n"),
  );
});

test("menu rows show checks, shortcuts and what is off", () => {
  assert.deepEqual(
    menuLines([
      { accelerator: "CmdOrCtrl+C", enabled: true, label: "Copy" },
      { checked: true, enabled: true, label: "Show Bookmarks Bar" },
      { enabled: false, label: "Paste" },
    ]),
    ["Copy  CmdOrCtrl+C", "✓ Show Bookmarks Bar", "Paste (disabled)"],
  );
});
