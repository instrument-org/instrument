import { describe, expect, it } from "vitest";

import { BashTool } from "./bash";

describe("BashTool", () => {
  describe("toModelOutput", () => {
    it("includes exit code and duration on empty success", () => {
      const result = BashTool.toModelOutput({
        input: { command: "true", timeoutMs: 1000 },
        output: {
          command: "true",
          commands: ["true"],
          durationMs: 12,
          exitCode: 0,
          output: "",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Exit code: 0

        Duration: 12 ms",
        }
      `);
    });

    it("includes exit code, duration, and output on success", () => {
      const result = BashTool.toModelOutput({
        input: { command: "echo hi", timeoutMs: 1000 },
        output: {
          command: "echo hi",
          commands: ["echo"],
          durationMs: 8,
          exitCode: 0,
          output: "hi\n",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Exit code: 0

        Command output:

        hi

        Duration: 8 ms",
        }
      `);
    });

    it("uses error-text and shows nonzero exit code", () => {
      const result = BashTool.toModelOutput({
        input: { command: "false", timeoutMs: 1000 },
        output: {
          command: "false",
          commands: ["false"],
          durationMs: 5,
          exitCode: 1,
          output: "boom\n",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "error-text",
          "value": "Exit code: 1

        Command output:

        boom

        Duration: 5 ms",
        }
      `);
    });

    it("formats duration in seconds for longer commands", () => {
      const result = BashTool.toModelOutput({
        input: { command: "sleep 2", timeoutMs: 1000 },
        output: {
          command: "sleep 2",
          commands: ["sleep"],
          durationMs: 2150,
          exitCode: 0,
          output: "",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Exit code: 0

        Duration: 2 seconds",
        }
      `);
    });

    it("emits a rich truncation notice when output exceeds the cap", () => {
      const line = "x".repeat(199) + "\n";
      const longOutput = line.repeat(200);
      const result = BashTool.toModelOutput({
        input: { command: "yes", timeoutMs: 1000 },
        output: {
          command: "yes",
          commands: ["yes"],
          durationMs: 30,
          exitCode: 0,
          output: longOutput,
        },
        toolCallId: "1",
      });
      const value = (result as { value: string }).value;
      expect(value).toContain("Exit code: 0");
      expect(value).toContain(
        "Output truncated: showing last 29.3 KB of 39.1 KB",
      );
      expect(value).toContain("(201 lines total)");
      expect(value).toContain("Re-run with `tail`, `head`, or `grep`");
    });
  });
});
