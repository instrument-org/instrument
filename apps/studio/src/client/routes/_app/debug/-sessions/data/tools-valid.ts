import { StoreId } from "@instrument-org/workspace/client";

import { registerSession, SessionBuilder } from "../helpers";

const builder = new SessionBuilder();
const sessionId = builder.getSessionId();

const userMessageId = StoreId.newMessageId();
const assistantMessageId = StoreId.newMessageId();

registerSession({
  messages: [
    {
      id: userMessageId,
      metadata: {
        createdAt: builder.nextTime(),
        sessionId,
      },
      parts: [
        builder.textPart(
          "Help me explore and refactor the codebase. I need to find files, read them, search for patterns, run diagnostics, make some changes, search the web, and generate an image.",
          userMessageId,
        ),
      ],
      role: "user",
    },
    {
      id: assistantMessageId,
      metadata: {
        createdAt: builder.nextTime(),
        finishReason: "stop",
        modelId: "claude-sonnet-4.5",
        providerId: "anthropic",
        sessionId,
      },
      parts: [
        builder.textPart(
          "I'll help you with all of that. Let me start by asking which framework to use.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            choices: ["React", "Vue", "Svelte"],
            explanation: "Ask user which frontend framework to use",
            question: "Which frontend framework should we use?",
          },
          output: {
            selectedChoice: "React",
          },
          type: "tool-choose",
        }),
        builder.textPart(
          "Great, React it is. Let me load the relevant skill first.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Load the React skill for best practices",
            name: "react",
          },
          output: {
            content:
              '<skill_content name="react">\n# React Skill\n\nBest practices for building React applications...\n</skill_content>',
            name: "react",
          },
          type: "tool-load_skill",
        }),
        builder.textPart(
          "Skill loaded. Now let me launch a retrieval agent to search attached folders.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Launch retrieval agent to search external folder",
            prompt:
              "Search the attached folder for any existing TypeScript config files and report what you find.",
            subagent_type: "retrieval",
          },
          output: {
            result:
              "Found tsconfig.json and tsconfig.build.json in the root of the attached folder. The base config targets ES2022 with strict mode enabled.",
            sessionId: StoreId.newSessionId(),
            status: "done",
            summary: "read 2 files, 1 search",
          },
          type: "tool-task",
        }),
        builder.textPart(
          "Retrieval complete. Now let me find relevant files using glob.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Find all TypeScript files in the src directory",
            pattern: "src/**/*.ts",
          },
          output: {
            files: [
              "src/utils/helpers.ts",
              "src/utils/validation.ts",
              "src/config.ts",
              "src/app.ts",
            ],
            totalFiles: 4,
            truncated: false,
          },
          type: "tool-glob",
        }),
        builder.textPart(
          "Found TypeScript files. Now let me search for usages of formatDate using grep.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Search for all usages of the formatDate function",
            pattern: "formatDate",
          },
          output: {
            matches: [
              {
                lineNum: 1,
                lineText: "export function formatDate(date: Date): string {",
                modifiedAt: 1_704_067_200_000,
                path: "src/utils/helpers.ts",
              },
              {
                lineNum: 5,
                lineText: "import { formatDate } from './utils/helpers';",
                modifiedAt: 1_704_067_300_000,
                path: "src/app.ts",
              },
              {
                lineNum: 12,
                lineText: "  const formatted = formatDate(new Date());",
                modifiedAt: 1_704_067_300_000,
                path: "src/app.ts",
              },
            ],
            totalMatches: 3,
            truncated: false,
          },
          type: "tool-grep",
        }),
        builder.textPart(
          "Found usages. Let me run diagnostics to check for any issues.",
          assistantMessageId,
        ),
        builder.textPart(
          "Found errors. Let me read the helpers file to understand the issue better.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation:
              "Read the helpers file to understand the implementation",
            filePath: "./src/utils/helpers.ts",
          },
          output: {
            content:
              "     1\texport function formatDate(date: Date): string {\n     2\t  return date.toISOString();\n     3\t}\n     4\t\n     5\texport function parseJSON(str: string): unknown {\n     6\t  return JSON.parse(str);\n     7\t}",
            filePath: "./src/utils/helpers.ts",
          },
          type: "tool-read_file",
        }),
        builder.textPart(
          "I can see the issue. Let me fix the parseJSON function by adding a generic type parameter.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Add generic type parameter to parseJSON function",
            filePath: "./src/utils/helpers.ts",
            newString:
              "export function parseJSON<T = unknown>(str: string): T {\n  return JSON.parse(str) as T;\n}",
            oldString:
              "export function parseJSON(str: string): unknown {\n  return JSON.parse(str);\n}",
          },
          output: {
            diff: "Index: ./src/utils/helpers.ts\n===================================================================\n--- ./src/utils/helpers.ts\n+++ ./src/utils/helpers.ts\n@@ -4,6 +4,6 @@\n \n-export function parseJSON(str: string): unknown {\n-  return JSON.parse(str);\n+export function parseJSON<T = unknown>(str: string): T {\n+  return JSON.parse(str) as T;\n }",
            filePath: "./src/utils/helpers.ts",
          },
          type: "tool-edit_file",
        }),
        builder.textPart(
          "Now let me create a new test file to verify the changes.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            content:
              'import { describe, expect, it } from "vitest";\nimport { formatDate, parseJSON } from "./helpers";\n\ndescribe("helpers", () => {\n  it("should format date", () => {\n    const date = new Date("2024-01-01");\n    expect(formatDate(date)).toBe("2024-01-01T00:00:00.000Z");\n  });\n\n  it("should parse JSON with type inference", () => {\n    const result = parseJSON<{ name: string }>(\'{"name":"test"}\');\n    expect(result.name).toBe("test");\n  });\n});',
            explanation: "Create test file to verify the parseJSON changes",
            filePath: "./src/utils/helpers.test.ts",
          },
          output: {
            filePath: "./src/utils/helpers.test.ts",
          },
          type: "tool-write_file",
        }),
        builder.textPart(
          "Let me run tests to verify everything works.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            command: "npm test -- helpers.test.ts",
            explanation: "Run tests for helpers module",
            timeoutMs: 30_000,
          },
          output: {
            command: "npm test -- helpers.test.ts",
            commands: ["npm"],
            durationMs: 1200,
            exitCode: 0,
            output:
              "PASS src/utils/helpers.test.ts\n  helpers\n    ✓ should format date (2ms)\n    ✓ should parse JSON (1ms)\n\nTest Suites: 1 passed, 1 total\nTests:       2 passed, 2 total",
          },
          type: "tool-bash",
        }),
        builder.textPart(
          "Now let me copy some files from the attached folder into the project.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Copy TypeScript config from attached folder",
            path: "/Users/user/external-project",
            pattern: "tsconfig*.json",
          },
          output: {
            errors: [],
            files: [
              {
                destinationPath: "./.instrument-retrieved/tsconfig.json",
                size: 512,
                sourcePath: "/Users/user/external-project/tsconfig.json",
              },
            ],
            truncatedCount: 0,
            truncationReason: null,
          },
          type: "tool-copy_to_project",
        }),
        builder.textPart(
          "Now let me try an unavailable tool to show the fallback.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {},
          output: {},
          type: "tool-unavailable",
        }),
        builder.textPart(
          "Let me search the web for the latest Vitest configuration best practices.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation:
              "Search for the latest Vitest configuration best practices",
            query: "Vitest configuration best practices 2025",
          },
          output: {
            modelId: "gpt-4o-search-preview",
            provider: {
              displayName: "OpenAI",
              id: "openai-default",
              type: "openai",
            },
            sources: [
              {
                title: "Vitest - Getting Started | Guide",
                url: "https://vitest.dev/guide/",
              },
              {
                title:
                  "Vitest Configuration Reference | Best Practices for 2025",
                url: "https://vitest.dev/config/",
              },
              {
                title: "Testing with Vitest - Dev.to",
                url: "https://dev.to/testing-vitest-best-practices",
              },
            ],
            state: "success",
            text: "## Vitest Configuration Best Practices\n\nVitest is a blazing-fast unit testing framework powered by Vite. Here are the recommended best practices for configuration:\n\n1. **Use `vitest.config.ts`** - Keep your test config separate from your Vite config for clarity.\n2. **Enable globals** - Set `globals: true` to avoid importing `describe`, `it`, `expect` in every file.\n3. **Configure coverage** - Use `@vitest/coverage-v8` for fast, reliable coverage reports.\n4. **Use workspace mode** - For monorepos, define a `vitest.workspace.ts` to run tests across packages.\n5. **Set `testTimeout`** - Always set a reasonable timeout to catch hanging tests early.",
            usage: {
              inputTokens: 150,
              outputTokens: 420,
              totalTokens: 570,
            },
          },
          type: "tool-web_search",
        }),
        builder.textPart(
          "Now let me generate an icon for the project.",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Generate a project icon for the helpers library",
            filePath: "./assets/helpers-icon",
            prompt:
              "A minimal flat vector icon representing a code utility library. Features interlocking gear and wrench symbols in a modern blue gradient style on a transparent background.",
          },
          output: {
            images: [
              {
                filePath: "./assets/helpers-icon.png",
                height: 1024,
                sizeBytes: 245_760,
                width: 1024,
              },
            ],
            modelId: "gpt-5-image",
            provider: {
              displayName: "OpenAI",
              id: "openai-default",
              type: "openai",
            },
            state: "success",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
          },
          type: "tool-generate_image",
        }),
        builder.textPart(
          "Perfect! I've successfully demonstrated all the tools:\n1. Asked a multiple-choice question using choose\n2. Loaded a skill using load_skill\n3. Launched a retrieval agent using task\n4. Found TypeScript files using glob\n5. Searched for formatDate usages with grep\n6. Read file contents using read_file\n7. Edited the file using edit_file\n8. Created a new test file using write_file\n9. Ran tests using bash\n10. Copied files from an attached folder using copy_to_project\n11. Showed an unavailable tool fallback\n12. Searched the web for best practices using web_search\n13. Generated a project icon using generate_image",
          assistantMessageId,
        ),
      ],
      role: "assistant",
    },
  ],
  name: "Tools: Valid",
});
