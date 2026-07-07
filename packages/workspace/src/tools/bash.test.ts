import { describe, expect, it } from "vitest";

import { RelativePathSchema } from "../schemas/paths";
import { BashTool } from "./bash";

const BASE_OUTPUT = {
  command: "",
  commands: [],
  durationMs: 0,
  exitCode: 0,
  output: "",
};

describe("BashTool", () => {
  describe("toModelOutput", () => {
    it("includes exit code and duration on empty success", () => {
      const result = BashTool.toModelOutput({
        input: { command: "true", timeoutMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "true",
          commands: ["true"],
          durationMs: 12,
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
          ...BASE_OUTPUT,
          command: "echo hi",
          commands: ["echo"],
          durationMs: 8,
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
          ...BASE_OUTPUT,
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
          ...BASE_OUTPUT,
          command: "sleep 2",
          commands: ["sleep"],
          durationMs: 2150,
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

    it("truncates output exceeding byte cap and shows head+tail notice", () => {
      // 300 lines × 200 chars ≈ 58 KB, exceeds 10+10 KB combined budget
      const line = "x".repeat(199) + "\n";
      const longOutput = line.repeat(300);
      const result = BashTool.toModelOutput({
        input: { command: "yes", timeoutMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "yes",
          commands: ["yes"],
          durationMs: 30,
          output: longOutput,
        },
        toolCallId: "1",
      });
      const value = (result as { value: string }).value;
      expect(value).toContain("Exit code: 0");
      expect(value).toContain("Output truncated:");
      expect(value).toContain("lines omitted");
      expect(value).toContain("lines total");
      expect(value).toContain("[... ");
    });

    it("includes spillFilePath in truncation notice when provided", () => {
      const line = "x".repeat(199) + "\n";
      const longOutput = line.repeat(300);
      const result = BashTool.toModelOutput({
        input: { command: "yes", timeoutMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "yes",
          commands: ["yes"],
          durationMs: 30,
          output: longOutput,
          spillFilePath: RelativePathSchema.parse(
            ".instrument/tool-output/part-123.log",
          ),
        },
        toolCallId: "1",
      });
      const value = (result as { value: string }).value;
      expect(value).toContain(".instrument/tool-output/part-123.log");
    });

    it("notes that the shell session ends when cd is used", () => {
      const result = BashTool.toModelOutput({
        input: { command: "cd subdir && ls", timeoutMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "cd subdir && ls",
          commands: ["cd", "ls"],
          durationMs: 5,
          output: "file.txt\n",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Exit code: 0

        Command output:

        file.txt

        <instrument-system-note>
        This shell session ends when this command completes. The next
        \`bash\` call starts fresh at the task root, not the directory this
        \`cd\` moved to -- prefix that call with \`cd\` again if you need it.
        </instrument-system-note>

        Duration: 5 ms",
        }
      `);
    });

    it("does not truncate output that fits within limits", () => {
      const output = Array.from({ length: 10 }, (_, i) => `line ${i}`).join(
        "\n",
      );
      const result = BashTool.toModelOutput({
        input: { command: "ls", timeoutMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "ls",
          commands: ["ls"],
          durationMs: 5,
          output,
        },
        toolCallId: "1",
      });
      const value = (result as { value: string }).value;
      expect(value).not.toContain("truncated");
      expect(value).toContain("line 9");
    });
  });
});
