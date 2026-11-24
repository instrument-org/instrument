import { describe, expect, it } from "vitest";

import { type ChatId } from "../../src/schemas/chat-id";
import { type Session } from "../../src/schemas/session";
import { BROWSER_PAGED_ORDERS_EVALS } from "./browser-paged-orders";

const mechanism = BROWSER_PAGED_ORDERS_EVALS[0]?.assertions?.[1];

interface Call {
  command?: string;
  exitCode?: number;
  /** Runs of `agent-browser` the call recorded. */
  ran?: number;
  /** Whether the shell itself ran `agent-browser`. */
  typed?: boolean;
  write?: { content: string; filePath: string };
}

/**
 * The assertion reads a few fields off each tool part, so a fixture carrying
 * those is the whole of what it sees. Cast because building a complete
 * `Session.WithMessagesAndParts` would be describing storage rather than the
 * thing under test.
 */
async function evidenceOf(...calls: Call[]) {
  const parts = calls.map((call) =>
    call.write
      ? { input: call.write, type: "tool-write_file" }
      : {
          input: { command: call.command },
          output: {
            commands: call.typed ? ["agent-browser"] : ["python"],
            exitCode: call.exitCode ?? 0,
            ran: call.ran ? [{ count: call.ran, name: "agent-browser" }] : [],
          },
          state: "output-available",
          type: "tool-bash",
        },
  );
  const result = await mechanism?.check({
    childSessions: () => Promise.resolve([]),
    sessions: [
      { messages: [{ parts, role: "assistant" }] },
    ] as unknown as Session.WithMessagesAndParts[],
    chatId: "browser-paged-orders" as ChatId,
  } as unknown as Parameters<NonNullable<typeof mechanism>["check"]>[0]);
  return result?.evidence.split("; ").slice(1, 3);
}

describe("browser-paged-orders' record of the route", () => {
  it("counts a script that died before its first browser command as the first attempt", async () => {
    expect(
      await evidenceOf(
        {
          command:
            "cat > scan/collect.py <<'EOF'\nimport instrument\ninstrument.browser('open', url)\nEOF\npython -I scan/collect.py",
          exitCode: 1,
        },
        { command: "python scan/collect.py", ran: 64 },
      ),
    ).toMatchInlineSnapshot(`
      [
        "calls running a script that drives the browser 2 (64 commands, 1 exited non-zero)",
        "first such call exited 1 after 0 commands",
      ]
    `);
  });

  it("follows a script written with write_file to the call that runs it", async () => {
    expect(
      await evidenceOf(
        {
          write: {
            content: "const rows = await instrument.browser('eval', js);",
            filePath: "scan/collect.mjs",
          },
        },
        { command: "node scan/collect.mjs", exitCode: 1 },
        { command: "node scan/collect.mjs", ran: 31 },
      ),
    ).toMatchInlineSnapshot(`
      [
        "calls running a script that drives the browser 2 (31 commands, 1 exited non-zero)",
        "first such call exited 1 after 0 commands",
      ]
    `);
  });

  it("counts no attempt for typed commands, a loop in the shell, or a script that parses a file", async () => {
    expect(
      await evidenceOf(
        { command: "agent-browser open http://x/orders", ran: 1, typed: true },
        {
          command:
            "for p in 1 2 3; do agent-browser eval --stdin < rows.js; done",
          ran: 3,
          typed: true,
        },
        {
          command:
            "python -c 'import json; print(len(json.load(open(\"rows.json\"))))'",
        },
      ),
    ).toMatchInlineSnapshot(`
      [
        "calls running a script that drives the browser 0 (0 commands, 0 exited non-zero)",
        "first such call none",
      ]
    `);
  });
});
