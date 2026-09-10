import { describe, expect, it } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { taskEventModelNote } from "./task-event-model-text";

const TASK_ID = TaskIdSchema.parse("2026-09-08-find-the-vault");

describe("taskEventModelNote", () => {
  it("names what a finished task left running, with each command cut to fit", () => {
    const note = taskEventModelNote({
      events: [
        {
          activeMs: 203_590,
          files: ["/mnt/Instrument/output/report.md"],
          running: [
            {
              command:
                "rg -l --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/Library/Caches/**' -i 'obsidian|appId|vault' /mnt/Home 2>/dev/null | head -200",
              id: "bg_1",
              runningForMs: 431_000,
            },
            {
              command: "node work/server.js",
              id: "bg_2",
              runningForMs: 61_000,
            },
          ],
          status: "done",
          summary: "Located the note.",
          taskId: TASK_ID,
          title: "Find project status note",
          tokens: 424_546,
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A task you created has finished:
      - 2026-09-08-find-the-vault ("Find project status note") finished a turn (3 minutes of work, 425K tokens so far). It last said: "Located the note."
        It wrote: /mnt/Instrument/output/report.md
        It left running in the background: bg_1 \`rg -l --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/Li…\` (7 minutes), bg_2 \`node work/server.js\` (1 minute). Stop what the user does not need with \`task kill 2026-09-08-find-the-vault <bg id>\`, or all of it with \`task kill 2026-09-08-find-the-vault\`; a server they are using stays.
      Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
  });

  it("says nothing about the background when nothing was left there", () => {
    const note = taskEventModelNote({
      events: [{ status: "done", taskId: TASK_ID, title: "hey" }],
    });
    expect(note).not.toContain("background");
  });
});
