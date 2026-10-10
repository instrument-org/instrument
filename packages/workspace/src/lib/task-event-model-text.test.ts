import { describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { taskEventModelNote } from "./task-event-model-text";

const TASK_ID = StoreId.SessionSchema.parse("ses_01K4M7V0A7T2B9S6QH4Z3X1C5D");

describe("taskEventModelNote", () => {
  it("carries the receipt as a block, and names what the task left running with each command cut to fit", () => {
    const note = taskEventModelNote({
      events: [
        {
          activeMs: 203_590,
          files: ["/mnt/Instrument/report.md"],
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
          summary:
            "Located the note and wrote the report beside it.\n\n```files\n/mnt/Instrument/report.md\n```",
          sessionId: TASK_ID,
          title: "Find project status note",
          tokens: 424_546,
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A task you created has finished:
      - ses_01K4M7V0A7T2B9S6QH4Z3X1C5D ("Find project status note") finished a turn (3 minutes of work, 425K tokens so far). It said:
            Located the note and wrote the report beside it.

            \`\`\`files
            /mnt/Instrument/report.md
            \`\`\`
        It left running in the background: bg_1 \`rg -l --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/Li…\` (7 minutes), bg_2 \`node work/server.js\` (1 minute). Stop what the user does not need with \`task stop ses_01K4M7V0A7T2B9S6QH4Z3X1C5D <bg id>\`, or all of it with \`task stop ses_01K4M7V0A7T2B9S6QH4Z3X1C5D --all\`; a server they are using stays.
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
          sessionId: TASK_ID,
          title: "Demonstrate the JavaScript runner",
          tokens: 40_000,
        },
        {
          ended: "Stopped at the 200-step limit",
          status: "done",
          sessionId: StoreId.SessionSchema.parse(
            "ses_01K4W2N8E5G0P3R7KJ6Y1T9M4F",
          ),
          title: "Audit the vault",
        },
        {
          ended: "Model is busy",
          status: "error",
          sessionId: StoreId.SessionSchema.parse(
            "ses_01K4W2Q3H6D8V5C1NX0B7R2T9A",
          ),
          title: "Draft the brief",
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Tasks you created have finished:
      - ses_01K4M7V0A7T2B9S6QH4Z3X1C5D ("Demonstrate the JavaScript runner") was stopped while locating any bundled QuickJS runtime (2 minutes of work, 40K tokens so far).
      - ses_01K4W2N8E5G0P3R7KJ6Y1T9M4F ("Audit the vault") was stopped at the 200-step limit.
      - ses_01K4W2Q3H6D8V5C1NX0B7R2T9A ("Draft the brief") stopped with an error, "Model is busy".
      Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
    expect(note).not.toContain("said nothing");
  });

  it("says nothing about the background when nothing was left there", () => {
    const note = taskEventModelNote({
      events: [{ status: "done", sessionId: TASK_ID, title: "hey" }],
    });
    expect(note).not.toContain("background");
  });

  it("names the pages a task left open by the tab ids `tab show` takes", () => {
    const note = taskEventModelNote({
      events: [
        {
          status: "done",
          summary: "The cart is ready.",
          tabs: [
            {
              id: "ses_01M48PS7HWJZEM6M3D3PA0CS8Z",
              openedBy: "task",
              url: "https://unscentedco.com/cart",
            },
            { id: "ses_01M48PS7HWJZEM6M3D3PA0CS90", openedBy: "handed" },
          ],
          sessionId: TASK_ID,
          title: "Optimize the cart",
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A task you created has finished:
      - ses_01K4M7V0A7T2B9S6QH4Z3X1C5D ("Optimize the cart") finished a turn. It said:
            The cart is ready.
        Its pages still open in the window: https://unscentedco.com/cart (tab ses_01M48PS7HWJZEM6M3D3PA0CS8Z), a blank page (tab ses_01M48PS7HWJZEM6M3D3PA0CS90, handed to it).
      Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
  });

  // An overdue note is read to decide whether to stop the task, so it carries
  // where the turn has been going, and names the cache share of a total that
  // would otherwise read as full-price spend.
  it("gives an overdue task's steps and cache share", () => {
    const note = taskEventModelNote({
      events: [
        {
          activeMs: 409_602,
          cachedTokens: 2_950_000,
          status: "overdue",
          steps: [
            "Scoping commits without running runtime tests",
            "Tracing runtime commits, entry points, and policy",
            "Checking whether the shell exposes worker cleanup",
          ],
          summary: "Checking whether the shell exposes worker cleanup",
          sessionId: TASK_ID,
          title: "Audit execution environment changes",
          tokens: 3_271_239,
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A task you created is taking a while:
      - ses_01K4M7V0A7T2B9S6QH4Z3X1C5D ("Audit execution environment changes") is still working (7 minutes of work, 3271K tokens so far, 90% of them cached reads). Its steps this turn, latest last: "Scoping commits without running runtime tests", "Tracing runtime commits, entry points, and policy", "Checking whether the shell exposes worker cleanup".
      Nothing has gone wrong that anyone has said; this is the clock. Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
  });

  it("falls back to the latest step for an overdue turn that set no activity", () => {
    const note = taskEventModelNote({
      events: [
        {
          status: "overdue",
          summary: "Reading the sandbox environment factory",
          sessionId: TASK_ID,
          title: "Audit",
        },
      ],
    });
    expect(note).toContain(
      'Its latest step: "Reading the sandbox environment factory"',
    );
  });

  // The latest step's label says what the step set out to do; the Now line
  // says whether it is still doing it, which is what tells stuck from busy.
  it("measures an overdue task's step in flight", () => {
    const note = taskEventModelNote({
      events: [
        {
          activeMs: 360_000,
          inFlight:
            "working 6m · last tool call 5m 40s ago · writing for 5m 35s: ~4.1K tokens, no tool call",
          status: "overdue",
          steps: ["bash: Searching pnpm source"],
          sessionId: TASK_ID,
          title: "Find the pnpm store",
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A task you created is taking a while:
      - ses_01K4M7V0A7T2B9S6QH4Z3X1C5D ("Find the pnpm store") is still working (6 minutes of work). Its steps this turn, latest last: "bash: Searching pnpm source".
        Now: working 6m · last tool call 5m 40s ago · writing for 5m 35s: ~4.1K tokens, no tool call.
      Nothing has gone wrong that anyone has said; this is the clock. Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
  });

  it("reports a task that ended on a needs fence as waiting, its needs listed", () => {
    const note = taskEventModelNote({
      events: [
        {
          activeMs: 95_000,
          needs: [
            "folder: Desktop, to save the confirmation there",
            "answer: which of the two Lisbon hotels?",
          ],
          status: "done",
          summary: "I found both hotels but cannot book without a choice.",
          sessionId: TASK_ID,
          title: "Book the Lisbon hotel",
          tokens: 61_000,
        },
      ],
    });
    expect(note).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A task you created is waiting on you:
      - ses_01K4M7V0A7T2B9S6QH4Z3X1C5D ("Book the Lisbon hotel") is waiting on you (2 minutes of work, 61K tokens so far). It said:
            I found both hotels but cannot book without a choice.
        It cannot go on without:
            folder: Desktop, to save the confirmation there
            answer: which of the two Lisbon hotels?
      Nobody typed anything; this note is why you are awake.
      </instrument-system-note>"
    `);
  });
});
