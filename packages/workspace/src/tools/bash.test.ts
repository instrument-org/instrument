import { describe, expect, it } from "vitest";

import { RelativePathSchema } from "../schemas/paths";
import { BashTool } from "./bash";

type Output = Parameters<typeof BashTool.toModelOutput>[0]["output"];

const BASE_OUTPUT = {
  command: "",
  commands: [],
  durationMs: 0,
  exitCode: 0,
  omittedBytes: 0,
  output: "",
} satisfies Output;

const render = (output: Partial<Output>) =>
  BashTool.toModelOutput({
    input: { command: output.command ?? "", yieldMs: 1000 },
    output: { ...BASE_OUTPUT, ...output },
    toolCallId: "1",
  });

/** The rendered text, for an output that renders as text alone. */
function renderedText(output: Partial<Output>): string {
  const result = render(output);
  if (result.type !== "text" && result.type !== "error-text") {
    throw new TypeError(`Expected text output, got ${result.type}`);
  }
  return result.value;
}

/** What a promoted command says before the note every promoted command shares. */
const promotedLead = (output: Partial<Output>) =>
  renderedText(output).split("\n<instrument-system-note>")[0] ?? "";

const LONG_OUTPUT = ("x".repeat(199) + "\n").repeat(300);

describe("BashTool toModelOutput", () => {
  it("says a command printed nothing, with its duration in ms or seconds", () => {
    expect({
      quick: render({ commands: ["true"], durationMs: 12 }),
      slow: render({ commands: ["sleep"], durationMs: 2150 }),
    }).toMatchInlineSnapshot(`
      {
        "quick": {
          "type": "text",
          "value": "Exit code: 0

      The command produced no output on stdout or stderr.

      Duration: 12 ms",
        },
        "slow": {
          "type": "text",
          "value": "Exit code: 0

      The command produced no output on stdout or stderr.

      Duration: 2 seconds",
        },
      }
    `);
  });

  it("shows the output, and marks a nonzero exit as an error", () => {
    expect({
      failed: render({ durationMs: 5, exitCode: 1, output: "boom\n" }),
      succeeded: render({ durationMs: 8, output: "hi\n" }),
    }).toMatchInlineSnapshot(`
      {
        "failed": {
          "type": "error-text",
          "value": "Exit code: 1

      Command output:

      boom

      Duration: 5 ms",
        },
        "succeeded": {
          "type": "text",
          "value": "Exit code: 0

      Command output:

      hi

      Duration: 8 ms",
        },
      }
    `);
  });

  it("leaves what answered each command out of the model's view", () => {
    const output = { command: "sort a", commands: ["sort"], output: "a\n" };
    expect(
      render({
        ...output,
        ran: [{ count: 1, name: "sort", source: "bundled" }],
      }),
    ).toEqual(render(output));
  });

  it("keeps the head and tail of output over the byte cap and names the file holding it", () => {
    const value = renderedText({
      output: LONG_OUTPUT,
      spillFilePath: RelativePathSchema.parse(".tool-output/part-123.log"),
    });
    expect(
      value.slice(value.indexOf("[Output truncated"), value.indexOf("]\n") + 1),
    ).toMatchInlineSnapshot(`
      "[Output truncated: showing first 10.0 KB and last 10.0 KB of 58.6 KB (300 lines total, 198 omitted).
      Output saved to: .tool-output/part-123.log]"
    `);
    expect(value).toContain("[... ");
  });

  it("shows the start and end of one line over the byte cap", () => {
    const value = renderedText({
      output: `{"a":"${"x".repeat(30 * 1024)}"}`,
    });
    expect(
      value.split("\n").find((line) => line.startsWith("[Output truncated")),
    ).toMatchInlineSnapshot(
      `"[Output truncated: showing first 10.0 KB and last 10.0 KB of 30.0 KB (1 lines total, 0 omitted).]"`,
    );
    expect(value).toContain(`{"a":"xxxx`);
    expect(value).toContain(`xxxx"}`);
  });

  it("shows output inside the limits whole", () => {
    const output = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const value = renderedText({ output });
    expect(value).not.toContain("truncated");
    expect(value).toContain(output);
  });

  it("ends with the page a browser action left behind", () => {
    expect(
      renderedText({
        commands: ["agent-browser"],
        durationMs: 120,
        output: "✓ Done\n",
        pageAfter: { after: "click", kind: "unchanged", text: "" },
      })
        .split("\n\n")
        .at(-1),
    ).toMatchInlineSnapshot(
      `"Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is compared only where the page announces it (below, when it did); read the rest with \`get text\` if the action should have changed it."`,
    );
  });

  describe("screenshots", () => {
    const screenshot = {
      base64Data: "iVBORw0KGgo=",
      height: 1600,
      mimeType: "image/png",
      viewHeight: 800,
      viewWidth: 1280,
      width: 2560,
    };

    it("shows the screenshot a browser command took", () => {
      const result = render({
        commands: ["agent-browser"],
        durationMs: 300,
        output: "✓ Screenshot saved to screenshots/shot.png\n",
        screenshot,
      });
      expect(result.type).toBe("content");
      expect(result.type === "content" && result.value).toMatchObject([
        {
          text: expect.stringContaining(
            "The screenshot the call took, as `read_file` would show it (shown to you at 1280x800 px; the file on disk is 2560x1600).",
          ),
          type: "text",
        },
        {
          data: { data: screenshot.base64Data, type: "data" },
          mediaType: "image/png",
          type: "file",
        },
      ]);
    });

    it("leaves the screenshot out of a call that failed", () => {
      const result = render({
        commands: ["agent-browser"],
        exitCode: 1,
        output:
          "✓ Screenshot saved to screenshots/shot.png\n✗ Unknown ref: e9\n",
        screenshot,
      });
      expect(result).toMatchObject({
        type: "error-text",
        value: expect.not.stringContaining("The screenshot the call took"),
      });
    });
  });

  describe("promoted commands", () => {
    const promoted = {
      exitCode: undefined,
      logFilePath: RelativePathSchema.parse(".tool-output/bg_1.log"),
      processId: "bg_1",
    };

    it("hands back the process id and live output when a command is promoted", () => {
      expect(
        render({
          ...promoted,
          durationMs: 1002,
          output: "listening on 3000\n",
        }),
      ).toMatchInlineSnapshot(`
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

    it("announces a trailing `&` the way a shell announces a job", () => {
      expect(
        promotedLead({
          ...promoted,
          backgrounded: true,
          durationMs: 310,
          pids: [4242],
          processId: "bg_3",
        }),
      ).toMatchInlineSnapshot(`
        "[3] bg_3 4242

        No output yet.
        "
      `);
    });

    it("says a message moved it to the background, not its yield", () => {
      expect(
        promotedLead({
          ...promoted,
          durationMs: 4000,
          movedForMessageFrom: "user",
        }),
      ).toMatchInlineSnapshot(`
        "The user sent you a message while this was running, so it moved to the background after 4 seconds for you to read the message. It was not stopped and is still running.
        Process id: bg_1

        No output yet.
        "
      `);
    });

    it("reports output dropped before the log file existed as gone", () => {
      // The log file did not exist yet, so it must not be offered as a
      // recovery path for output dropped before promotion.
      expect(
        promotedLead({
          ...promoted,
          omittedBytes: 77_000,
          output: "tail line\n",
        }),
      ).toContain(
        "[75.2 KB of earlier output was dropped: the command wrote faster than this call could hold, and this happened before the log file existed, so it is gone.",
      );
    });
  });
});
