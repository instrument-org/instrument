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
      - 2026-09-08-find-the-vault ("Find project status note") finished a turn (3 minutes of work, 425K tokens so far). It said:
            Located the note.
        It wrote: /mnt/Instrument/output/report.md
        It left running in the background: bg_1 \`rg -l --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/Li…\` (7 minutes), bg_2 \`node work/server.js\` (1 minute). Stop what the user does not need with \`task kill 2026-09-08-find-the-vault <bg id>\`, or all of it with \`task kill 2026-09-08-find-the-vault\`; a server they are using stays.
      Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
  });

  it("says how a turn ended in place of the words it did not say", () => {
    const note = taskEventModelNote({
      events: [
        {
          activeMs: 120_000,
          ended: "Stopped while locating any bundled QuickJS runtime",
          status: "done",
          taskId: TASK_ID,
          title: "Demonstrate the JavaScript runner",
          tokens: 40_000,
        },
        {
          ended: "Stopped at the 200-step limit",
          status: "done",
          taskId: TaskIdSchema.parse("2026-09-11-audit-the-vault"),
          title: "Audit the vault",
        },
        {
          ended: "Model is busy",
          status: "error",
          taskId: TaskIdSchema.parse("2026-09-11-draft-the-brief"),
          title: "Draft the brief",
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Tasks you created have finished:
      - 2026-09-08-find-the-vault ("Demonstrate the JavaScript runner") was stopped while locating any bundled QuickJS runtime (2 minutes of work, 40K tokens so far).
      - 2026-09-11-audit-the-vault ("Audit the vault") was stopped at the 200-step limit.
      - 2026-09-11-draft-the-brief ("Draft the brief") stopped with an error, "Model is busy".
      Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
    expect(note).not.toContain("said nothing");
  });

  it("says nothing about the background when nothing was left there", () => {
    const note = taskEventModelNote({
      events: [{ status: "done", taskId: TASK_ID, title: "hey" }],
    });
    expect(note).not.toContain("background");
  });

  // An overdue note is read to decide whether to stop the task, so it carries
  // where the turn has been going and what it has to show, and names the
  // cache share of a total that would otherwise read as full-price spend.
  it("gives an overdue task's steps, files, and cache share", () => {
    const note = taskEventModelNote({
      events: [
        {
          activeMs: 409_602,
          cachedTokens: 2_950_000,
          files: [],
          status: "overdue",
          steps: [
            "Scoping commits without running runtime tests",
            "Tracing runtime commits, entry points, and policy",
            "Checking whether the shell exposes worker cleanup",
          ],
          summary: "Checking whether the shell exposes worker cleanup",
          taskId: TASK_ID,
          title: "Audit execution environment changes",
          tokens: 3_271_239,
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A task you created is taking a while:
      - 2026-09-08-find-the-vault ("Audit execution environment changes") is still working (7 minutes of work, 3271K tokens so far, 90% of them cached reads). Its steps this turn, latest last: "Scoping commits without running runtime tests", "Tracing runtime commits, entry points, and policy", "Checking whether the shell exposes worker cleanup".
        It has written nothing yet.
      Nothing has gone wrong that anyone has said; this is the clock. Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
  });

  it("falls back to the latest step for an overdue turn that set no activity", () => {
    const note = taskEventModelNote({
      events: [
        {
          files: ["/mnt/Instrument/runtime-audit.md"],
          status: "overdue",
          summary: "Reading the sandbox environment factory",
          taskId: TASK_ID,
          title: "Audit",
        },
      ],
    });
    expect(note).toContain(
      'Its latest step: "Reading the sandbox environment factory"',
    );
    expect(note).toContain(
      "It has written so far: /mnt/Instrument/runtime-audit.md",
    );
  });
});
