import { describe, expect, it } from "vitest";

import { viewContextModelNote } from "./view-context-model-text";

describe("viewContextModelNote", () => {
  it("names what was picked to go with the message after the screen", () => {
    expect(
      viewContextModelNote({
        chosen: [
          {
            kind: "file",
            mount: "/mnt/Home/Notes/plan.md",
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
      They chose to send these with the message: the file \`/Users/casey/Notes/plan.md\` (you reach it at \`/mnt/Home/Notes/plan.md\`); the folder \`/Volumes/Backup\` (no folder you can reach covers it: ask for it with request_folder). "This", "these" and "it" refer to them first, then to what was on screen.
      </instrument-system-note>"
    `);
  });
});
