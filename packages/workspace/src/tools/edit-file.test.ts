import mockFs from "mock-fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockChatConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-chat-config";
import { runTool } from "../test/helpers/run-tool";
import { TOOLS } from "./all";

const model = createMockAIGatewayModel();
const chatId = createMockChatConfig(ChatIdSchema.parse("test"), {
  model,
});

const GREP_FILE_CONTENT = `This is a test file for grep functionality.

It contains multiple lines with various patterns to test:
- async functions
- regular expressions
- file system operations
- error handling

The grep tests will look for:
1. Specific keywords like "async" and "function"
2. Regular expressions like "test.*file"
3. Error messages and patterns

This file should help verify that the grep implementation:
- Finds all matches in a file
- Handles multiple matches correctly
- Returns empty array when no matches found
- Properly handles special characters

Some example patterns to search for:
async function testGrep() {
  console.log("Testing grep functionality");
  throw new Error("Test error message");
}

// Some JSX
export function HelloWorld() {
  return <div>Hello World</div>;
}
`;

function makeExecuteArgs(
  input: Parameters<typeof TOOLS.EditFile.execute>[0]["input"],
) {
  return {
    input,
    model,
    signal: AbortSignal.timeout(10_000),
    chatId,
  };
}

function setupMockFs(files: NonNullable<Parameters<typeof mockFs>[0]> = {}) {
  mockFs({
    [MOCK_WORKSPACE_DIRS.work]: {
      [chatId]: {
        "grep-test.txt": GREP_FILE_CONTENT,
        ...files,
      },
    },
  });
}

const readBack = (name: string) =>
  fs.readFile(path.join(MOCK_WORKSPACE_DIRS.work, chatId, name), "utf8");

describe("EditFile", () => {
  afterEach(() => {
    mockFs.restore();
  });

  it("refuses a missing file, a directory, and an oldString it finds no times or twice, leaving the file as it was", async () => {
    setupMockFs();
    const refusal = async (filePath: string, oldString: string) =>
      (
        await runTool(
          TOOLS.EditFile,
          makeExecuteArgs({ filePath, newString: "new text", oldString }),
        )
      )._unsafeUnwrapErr().message;

    expect({
      directory: await refusal("./", "old text"),
      missingFile: await refusal("./non-existent-file.txt", "old text"),
      notFound: await refusal(
        "./grep-test.txt",
        "this text does not exist in the file",
      ),
      twice: await refusal("./grep-test.txt", "grep"),
    }).toMatchInlineSnapshot(`
        {
          "directory": "Path is a directory, not a file: ./",
          "missingFile": "File ./non-existent-file.txt not found",
          "notFound": "Failed to edit file ./grep-test.txt: oldString not found in content",
          "twice": "Failed to edit file ./grep-test.txt: Found multiple matches for oldString. Include more surrounding code lines in oldString to uniquely identify which occurrence to replace.",
        }
      `);
    await expect(readBack("grep-test.txt")).resolves.toBe(GREP_FILE_CONTENT);
  });

  it("replaces the one match and tells the model only that it succeeded", async () => {
    setupMockFs({ "index.ts": "const x = 1;\nconst y = 1;\n" });

    const input = {
      filePath: "./index.ts",
      newString: "const x = 2;",
      oldString: "const x = 1;",
    };
    const output = (
      await runTool(TOOLS.EditFile, makeExecuteArgs(input))
    )._unsafeUnwrap();

    await expect(readBack("index.ts")).resolves.toBe(
      "const x = 2;\nconst y = 1;\n",
    );
    expect(TOOLS.EditFile.toModelOutput({ input, output, toolCallId: "test" }))
      .toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "Successfully edited file ./index.ts",
      }
    `);
  });

  it("replaces every match with replaceAll", async () => {
    setupMockFs();

    const result = await runTool(
      TOOLS.EditFile,
      makeExecuteArgs({
        filePath: "./grep-test.txt",
        newString: "GREP",
        oldString: "grep",
        replaceAll: true,
      }),
    );

    expect(result.isOk()).toBe(true);
    const edited = await readBack("grep-test.txt");
    expect(edited).not.toContain("grep");
    expect(edited.match(/GREP/g)).toHaveLength(4);
  });

  it.each([
    {
      description: "smart double quotes",
      fileContent: 'const msg = "Hello world";',
      newString: 'const msg = "Goodbye world";',
      oldString: "const msg = \u201CHello world\u201D;",
    },
    {
      description: "smart single quotes",
      fileContent: "const msg = 'Hello world';",
      newString: "const msg = 'Goodbye world';",
      oldString: "const msg = \u2018Hello world\u2019;",
    },
    {
      description: "an em dash",
      fileContent: "// range: 1-10",
      newString: "// range: 1-100",
      oldString: "// range: 1\u201410",
    },
    {
      description: "a non-breaking space",
      fileContent: "const x = 1;",
      newString: "const x = 2;",
      oldString: "const\u00A0x = 1;",
    },
  ])(
    "matches plain text an oldString wrote with $description",
    async ({ fileContent, newString, oldString }) => {
      setupMockFs({ "unicode-test.ts": fileContent });

      const result = await runTool(
        TOOLS.EditFile,
        makeExecuteArgs({
          filePath: "./unicode-test.ts",
          newString,
          oldString,
        }),
      );

      expect(result.isOk()).toBe(true);
      await expect(readBack("unicode-test.ts")).resolves.toBe(newString);
    },
  );

  describe("empty oldString", () => {
    it("refuses to replace an existing file and leaves it untouched", async () => {
      const original = "const x = 1;\nconst y = 2;\n";
      setupMockFs({ "index.ts": original });

      const result = await runTool(
        TOOLS.EditFile,
        makeExecuteArgs({
          filePath: "./index.ts",
          newString: "const z = 3;\n",
          oldString: "",
        }),
      );

      expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
        `"oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write_file for an intentional full-file replacement."`,
      );
      await expect(readBack("index.ts")).resolves.toBe(original);
    });

    it("creates the file when it does not exist, with a diff from nothing", async () => {
      setupMockFs({});

      const result = await runTool(
        TOOLS.EditFile,
        makeExecuteArgs({
          filePath: "./created.ts",
          newString: "const z = 3;\n",
          oldString: "",
        }),
      );

      expect(result._unsafeUnwrap().diff).toMatchInlineSnapshot(`
        "Index: ./created.ts
        ===================================================================
        --- ./created.ts
        +++ ./created.ts
        @@ -0,0 +1,1 @@
        +const z = 3;
        "
      `);
      await expect(readBack("created.ts")).resolves.toBe("const z = 3;\n");
    });
  });

  describe("block anchor guard rails", () => {
    // Every real source file has a blank line in it, and the block anchors
    // are what answers when the model's oldString is close but not exact,
    // which is the only reason they exist.
    it("replaces a near-miss block with blank lines around it", async () => {
      const around = ["const first = 1;", ""];
      const after = ["", "const last = 2;"];
      setupMockFs({
        "blanks.ts": [
          ...around,
          "function keep() {",
          "  doWork(1);",
          "}",
          ...after,
        ].join("\n"),
      });

      const result = await runTool(
        TOOLS.EditFile,
        makeExecuteArgs({
          filePath: "./blanks.ts",
          newString: ["function keep() {", "  done();", "}"].join("\n"),
          // The anchors match and the middle is near enough to accept, which
          // is the block anchors doing their job.
          oldString: ["function keep() {", "  doWork(2);", "}"].join("\n"),
        }),
      );

      expect(result.isOk()).toBe(true);
      await expect(readBack("blanks.ts")).resolves.toBe(
        [...around, "function keep() {", "  done();", "}", ...after].join("\n"),
      );
    });

    it.each([
      {
        // Two anchors with one line between them: a search block of two lines
        // is all anchors and no middle, so nothing checks what sits between.
        content: "foo();\n  const keep = 1;\nbar();\n",
        name: "a two-line oldString rather than eat the line between",
        oldString: "foo();\nbar();\n",
      },
      {
        content: [
          "function run() {",
          "  const a = 1;",
          "  const b = 2;",
          "  const c = 3;",
          "}",
        ].join("\n"),
        name: "a block whose first and last lines match around an unrelated middle",
        oldString: [
          "function run() {",
          "  totally different content here;",
          "  nothing like the real body;",
          "  not even close;",
          "}",
        ].join("\n"),
      },
      {
        content: [
          "start",
          ...Array.from({ length: 40 }, (_, i) => `  line ${i};`),
          "end",
        ].join("\n"),
        name: "to stretch a small search block across a much larger span",
        oldString: ["start", "  line 0;", "end"].join("\n"),
      },
    ])("refuses $name", async ({ content, oldString }) => {
      setupMockFs({ "anchors.ts": content });

      const result = await runTool(
        TOOLS.EditFile,
        makeExecuteArgs({
          filePath: "./anchors.ts",
          newString: "REPLACED",
          oldString,
        }),
      );

      expect(result.isErr()).toBe(true);
      await expect(readBack("anchors.ts")).resolves.toBe(content);
    });

    // The context matcher takes a block of the same lines when half the
    // middle matches, whatever the other half holds: here 900 bytes of data
    // the model never sent. Only the size check stands between that and a
    // replacement that deletes it.
    it("refuses a match many times longer than oldString", async () => {
      const content = [
        "function run() {",
        "  const a = 1;",
        `  const data = [${"1, ".repeat(300)}];`,
        "}",
      ].join("\n");
      setupMockFs({ "context.ts": content });

      const result = await runTool(
        TOOLS.EditFile,
        makeExecuteArgs({
          filePath: "./context.ts",
          newString: "REPLACED",
          oldString: [
            "function run() {",
            "  const a = 1;",
            "  const data = [];",
            "}",
          ].join("\n"),
        }),
      );

      expect(result._unsafeUnwrapErr().message).toContain(
        "matched span is much larger than oldString",
      );
      await expect(readBack("context.ts")).resolves.toBe(content);
    });

    // A model that escapes its arguments twice sends `\n` as two characters
    // in newString too, so replacing on an unescaped match would write
    // backslashes into the file. Not found sends it back to read the file.
    it.each([2, 4])(
      "refuses a %i-line oldString sent with its newlines escaped",
      async (count) => {
        const content = ["a();", "b();", "c();", "d();"].join("\n") + "\n";
        setupMockFs({ "escaped.ts": content });
        const lines = content.split("\n").slice(0, count);

        const result = await runTool(
          TOOLS.EditFile,
          makeExecuteArgs({
            filePath: "./escaped.ts",
            newString: lines.map((line) => `// ${line}`).join(String.raw`\n`),
            oldString: lines.join(String.raw`\n`),
          }),
        );

        expect(result._unsafeUnwrapErr().message).toContain("not found");
        await expect(readBack("escaped.ts")).resolves.toBe(content);
      },
    );
  });
});
