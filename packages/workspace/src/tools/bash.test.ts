import { describe, expect, it } from "vitest";

import { RelativePathSchema } from "../schemas/paths";
import { BashTool } from "./bash";

const BASE_OUTPUT = {
  command: "",
  commands: [],
  durationMs: 0,
  exitCode: 0,
  omittedBytes: 0,
  output: "",
};

describe("BashTool", () => {
  describe("toModelOutput", () => {
    it("includes exit code and duration on empty success", () => {
      const result = BashTool.toModelOutput({
        input: { command: "true", yieldMs: 1000 },
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

        The command produced no output on stdout or stderr.

        Duration: 12 ms",
        }
      `);
    });

    it("leaves what answered each command out of the model's view", () => {
      const output = {
        ...BASE_OUTPUT,
        command: "sort a",
        commands: ["sort"],
        output: "a\n",
      };
      const view = (
        ran?: { count: number; name: string; source: "bundled" }[],
      ) =>
        BashTool.toModelOutput({
          input: { command: "sort a", yieldMs: 1000 },
          output: { ...output, ...(ran ? { ran } : {}) },
          toolCallId: "1",
        });
      expect(view([{ count: 1, name: "sort", source: "bundled" }])).toEqual(
        view(),
      );
    });

    it("announces a trailing `&` the way a shell announces a job", () => {
      const result = BashTool.toModelOutput({
        input: { command: "pnpm dev &", yieldMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          backgrounded: true,
          command: "pnpm dev &",
          durationMs: 310,
          exitCode: undefined,
          logFilePath: RelativePathSchema.parse(".tool-output/bg_3.log"),
          pids: [4242],
          processId: "bg_3",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "[3] bg_3 4242

        No output yet.

        <instrument-system-note>
        bg_3 is still running. Follow it with \`fg bg_3\`, which prints what it has written since your last read and exits with its exit code once it finishes, and stop it with \`kill bg_3\`. \`jobs\` lists everything still running. Its bounded process log is at .tool-output/bg_3.log.
        Do not start a second copy of a process that is already running. A process you leave running stays running after your turn ends, so kill anything the user does not need -- but leave a server running if they still want to reach it.
        </instrument-system-note>",
        }
      `);
    });

    it("includes exit code, duration, and output on success", () => {
      const result = BashTool.toModelOutput({
        input: { command: "echo hi", yieldMs: 1000 },
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
        input: { command: "false", yieldMs: 1000 },
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

    it("ends with the page a browser action left behind", () => {
      const result = BashTool.toModelOutput({
        input: { command: "agent-browser click @e2", yieldMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "agent-browser click @e2",
          commands: ["agent-browser"],
          durationMs: 120,
          output: "✓ Done\n",
          pageAfter: { after: "click", kind: "unchanged", text: "" },
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Exit code: 0

        Command output:

        ✓ Done

        Duration: 120 ms

        Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is compared only where the page announces it (below, when it did); read the rest with \`get text\` if the action should have changed it.",
        }
      `);
    });

    it("shows the screenshot a browser command took", () => {
      const result = BashTool.toModelOutput({
        input: { command: "agent-browser screenshot", yieldMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "agent-browser screenshot",
          commands: ["agent-browser"],
          durationMs: 300,
          output: "✓ Screenshot saved to screenshots/shot.png\n",
          screenshot: {
            base64Data: "iVBORw0KGgo=",
            height: 1600,
            mimeType: "image/png",
            viewHeight: 800,
            viewWidth: 1280,
            width: 2560,
          },
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "content",
          "value": [
            {
              "text": "Exit code: 0

        Command output:

        ✓ Screenshot saved to screenshots/shot.png

        Duration: 300 ms

        The screenshot the call took, as \`read_file\` would show it (shown to you at 1280x800 px; the file on disk is 2560x1600). Small text and closely spaced lines may not survive at that size; read it again with a \`region\` to magnify part of it. A region's corners are pixels in that 1280x800 space, not in the file's larger one:",
              "type": "text",
            },
            {
              "data": {
                "data": "iVBORw0KGgo=",
                "type": "data",
              },
              "mediaType": "image/png",
              "type": "file",
            },
          ],
        }
      `);
    });

    it("leaves the screenshot out of a call that failed", () => {
      const result = BashTool.toModelOutput({
        input: {
          command: "agent-browser screenshot && agent-browser click @e9",
          yieldMs: 1000,
        },
        output: {
          ...BASE_OUTPUT,
          command: "agent-browser screenshot && agent-browser click @e9",
          commands: ["agent-browser"],
          durationMs: 300,
          exitCode: 1,
          output:
            "✓ Screenshot saved to screenshots/shot.png\n✗ Unknown ref: e9\n",
          screenshot: {
            base64Data: "iVBORw0KGgo=",
            height: 800,
            mimeType: "image/png",
            viewHeight: 800,
            viewWidth: 1280,
            width: 1280,
          },
        },
        toolCallId: "1",
      });
      expect(result.type).toBe("error-text");
    });

    it("formats duration in seconds for longer commands", () => {
      const result = BashTool.toModelOutput({
        input: { command: "sleep 2", yieldMs: 1000 },
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

        The command produced no output on stdout or stderr.

        Duration: 2 seconds",
        }
      `);
    });

    it("truncates output exceeding byte cap and shows head+tail notice", () => {
      // 300 lines × 200 chars ≈ 58 KB, exceeds 10+10 KB combined budget
      const line = "x".repeat(199) + "\n";
      const longOutput = line.repeat(300);
      const result = BashTool.toModelOutput({
        input: { command: "yes", yieldMs: 1000 },
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

    it("shows the start and end of one line over the byte cap", () => {
      const result = BashTool.toModelOutput({
        input: { command: "curl", yieldMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "curl",
          commands: ["curl"],
          durationMs: 30,
          output: `{"a":"${"x".repeat(30 * 1024)}"}`,
        },
        toolCallId: "1",
      });
      const value = (result as { value: string }).value;
      expect(
        value.split("\n").find((line) => line.startsWith("[Output truncated")),
      ).toMatchInlineSnapshot(
        `"[Output truncated: showing first 10.0 KB and last 10.0 KB of 30.0 KB (1 lines total, 0 omitted).]"`,
      );
      expect(value).toContain(`{"a":"xxxx`);
      expect(value).toContain(`xxxx"}`);
    });

    it("includes spillFilePath in truncation notice when provided", () => {
      const line = "x".repeat(199) + "\n";
      const longOutput = line.repeat(300);
      const result = BashTool.toModelOutput({
        input: { command: "yes", yieldMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "yes",
          commands: ["yes"],
          durationMs: 30,
          output: longOutput,
          spillFilePath: RelativePathSchema.parse(".tool-output/part-123.log"),
        },
        toolCallId: "1",
      });
      const value = (result as { value: string }).value;
      expect(value).toContain(".tool-output/part-123.log");
    });

    it("does not truncate output that fits within limits", () => {
      const output = Array.from({ length: 10 }, (_, i) => `line ${i}`).join(
        "\n",
      );
      const result = BashTool.toModelOutput({
        input: { command: "ls", yieldMs: 1000 },
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

    it("hands back the process id and live output when a command is promoted", () => {
      const result = BashTool.toModelOutput({
        input: { command: "node work/server.js", yieldMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "node work/server.js",
          durationMs: 1002,
          exitCode: undefined,
          logFilePath: RelativePathSchema.parse(".tool-output/bg_1.log"),
          output: "listening on 3000\n",
          processId: "bg_1",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Still running after 1 second, so it moved to the background.
        Process id: bg_1

        Live subprocess output so far:

        listening on 3000

        <instrument-system-note>
        bg_1 is still running. Follow it with \`fg bg_1\`, which prints what it has written since your last read and exits with its exit code once it finishes, and stop it with \`kill bg_1\`. \`jobs\` lists everything still running. Its bounded process log is at .tool-output/bg_1.log.
        Do not start a second copy of a process that is already running. A process you leave running stays running after your turn ends, so kill anything the user does not need -- but leave a server running if they still want to reach it.
        </instrument-system-note>",
        }
      `);
    });

    it("says a message moved it to the background, not its yield", () => {
      const result = BashTool.toModelOutput({
        input: { command: "sleep 90", yieldMs: 120_000 },
        output: {
          ...BASE_OUTPUT,
          command: "sleep 90",
          durationMs: 4000,
          exitCode: undefined,
          logFilePath: RelativePathSchema.parse(".tool-output/bg_1.log"),
          movedForMessageFrom: "user",
          processId: "bg_1",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "The user sent you a message while this was running, so it moved to the background after 4 seconds for you to read the message. It was not stopped and is still running.
        Process id: bg_1

        No output yet.

        <instrument-system-note>
        bg_1 is still running. Follow it with \`fg bg_1\`, which prints what it has written since your last read and exits with its exit code once it finishes, and stop it with \`kill bg_1\`. \`jobs\` lists everything still running. Its bounded process log is at .tool-output/bg_1.log.
        Do not start a second copy of a process that is already running. A process you leave running stays running after your turn ends, so kill anything the user does not need -- but leave a server running if they still want to reach it.
        </instrument-system-note>",
        }
      `);
    });

    it("says so when a promoted command has not written anything yet", () => {
      const result = BashTool.toModelOutput({
        input: { command: "node work/quiet.js", yieldMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "node work/quiet.js",
          durationMs: 1001,
          exitCode: undefined,
          logFilePath: RelativePathSchema.parse(".tool-output/bg_2.log"),
          processId: "bg_2",
        },
        toolCallId: "1",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Still running after 1 second, so it moved to the background.
        Process id: bg_2

        No output yet.

        <instrument-system-note>
        bg_2 is still running. Follow it with \`fg bg_2\`, which prints what it has written since your last read and exits with its exit code once it finishes, and stop it with \`kill bg_2\`. \`jobs\` lists everything still running. Its bounded process log is at .tool-output/bg_2.log.
        Do not start a second copy of a process that is already running. A process you leave running stays running after your turn ends, so kill anything the user does not need -- but leave a server running if they still want to reach it.
        </instrument-system-note>",
        }
      `);
    });

    it("reports output dropped while a promoted command outran the buffer", () => {
      const result = BashTool.toModelOutput({
        input: { command: "node work/flood.js", yieldMs: 1000 },
        output: {
          ...BASE_OUTPUT,
          command: "node work/flood.js",
          durationMs: 1000,
          exitCode: undefined,
          logFilePath: RelativePathSchema.parse(".tool-output/bg_3.log"),
          omittedBytes: 77_000,
          output: "tail line\n",
          processId: "bg_3",
        },
        toolCallId: "1",
      });
      const value = (result as { value: string }).value;
      expect(value).toContain("75.2 KB of earlier output was dropped");
      // The log file did not exist yet, so it must not be offered as a recovery
      // path for output dropped before promotion.
      expect(value).toContain("it is gone");
    });
  });
});
