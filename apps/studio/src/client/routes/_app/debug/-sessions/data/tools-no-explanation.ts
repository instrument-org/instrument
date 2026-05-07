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
        builder.textPart("Run some tools without explanations.", userMessageId),
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
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            choices: ["React", "Vue"],
            question: "Which framework?",
          },
          output: {
            selectedChoice: "React",
          },
          type: "tool-choose",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            name: "react",
          },
          output: {
            content:
              '<skill_content name="react">\n# React Skill\n</skill_content>',
            name: "react",
          },
          type: "tool-load_skill",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            prompt: "Find TypeScript config files.",
            subagent_type: "retrieval",
          },
          output: {
            result: "Found tsconfig.json.",
            sessionId: StoreId.newSessionId(),
            status: "done",
            summary: "read 1 file",
          },
          type: "tool-task",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            pattern: "src/**/*.ts",
          },
          output: {
            files: ["src/app.ts"],
            totalFiles: 1,
            truncated: false,
          },
          type: "tool-glob",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
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
            ],
            totalMatches: 1,
            truncated: false,
          },
          type: "tool-grep",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            filePath: "./src/app.ts",
          },
          output: {
            content: `export const app = "hello";`,
            displayedLines: 1,
            filePath: "./src/app.ts",
            hasMoreLines: false,
            offset: 1,
            state: "exists",
            totalLines: 1,
            truncatedByBytes: false,
          },
          type: "tool-read_file",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            filePath: "./src/app.ts",
            newString: `export const app = "world";`,
            oldString: `export const app = "hello";`,
          },
          output: {
            diff: `--- ./src/app.ts\n+++ ./src/app.ts\n@@ -1 +1 @@\n-export const app = "hello";\n+export const app = "world";`,
            filePath: "./src/app.ts",
          },
          type: "tool-edit_file",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            content: `export const app = "world";`,
            filePath: "./src/app.ts",
          },
          output: {
            filePath: "./src/app.ts",
          },
          type: "tool-write_file",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            command: "echo hello",
            timeoutMs: 5000,
          },
          output: {
            command: "echo hello",
            commands: ["echo"],
            durationMs: 50,
            exitCode: 0,
            output: "hello",
          },
          type: "tool-bash",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
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
        builder.toolPart(assistantMessageId, "output-available", {
          input: {},
          output: {},
          type: "tool-unavailable",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            query: "Vitest best practices 2025",
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
                title: "Vitest - Getting Started",
                url: "https://vitest.dev/guide/",
              },
            ],
            state: "success",
            text: "Use `vitest.config.ts` and enable globals.",
            usage: {
              inputTokens: 50,
              outputTokens: 80,
              totalTokens: 130,
            },
          },
          type: "tool-web_search",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            filePath: "./assets/icon",
            prompt: "A minimal flat vector icon.",
          },
          output: {
            images: [
              {
                filePath: "./assets/icon.png",
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
      ],
      role: "assistant",
    },
  ],
  name: "Tools: No Explanation",
});
