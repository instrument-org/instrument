import { OUR_MODELS } from "@instrument-org/shared";
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
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Load the React skill for best practices",
            name: "react",
          },
          output: {
            content:
              "# React Skill\n\nBest practices for building React applications...",
            files: ["skills/react/SKILL.md"],
            name: "react",
            state: "success",
            truncated: false,
          },
          type: "tool-load_skill",
        }),
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
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation:
              "Read the helpers file to understand the implementation",
            filePath: "./src/utils/helpers.ts",
          },
          output: {
            content: `import { format, parseISO } from "date-fns";

export function formatDate(date: Date, pattern = "yyyy-MM-dd"): string {
  return format(date, pattern);
}

export function formatDateTime(date: Date): string {
  return format(date, "yyyy-MM-dd HH:mm:ss");
}

export function parseDate(str: string): Date {
  return parseISO(str);
}

export function parseJSON<T = unknown>(str: string): T {
  return JSON.parse(str) as T;
}

export function safeParseJSON<T = unknown>(
  str: string,
  fallback: T,
): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[s-]/g, "")
    .replace(/[_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}`,
            displayedLines: 36,
            filePath: "./src/utils/helpers.ts",
            hasMoreLines: false,
            offset: 1,
            state: "exists",
            totalLines: 36,
            truncatedByBytes: false,
          },
          type: "tool-read_file",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Refactor auth middleware to use JWT verification",
            filePath: "./src/middleware/auth.ts",
            newString: `import { verify } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verify(token, JWT_SECRET);
    (req as Request & { user: unknown }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}`,
            oldString: `import type { Request, Response, NextFunction } from "express";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}`,
          },
          output: {
            diff: `Index: ./src/middleware/auth.ts
===================================================================
--- ./src/middleware/auth.ts
+++ ./src/middleware/auth.ts
@@ -1,14 +1,24 @@
-import type { Request, Response, NextFunction } from "express";
+import { verify } from "jsonwebtoken";
+import type { Request, Response, NextFunction } from "express";
+
+const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
 
 export function authMiddleware(
   req: Request,
   res: Response,
   next: NextFunction,
 ): void {
-  const apiKey = req.headers["x-api-key"];
-  if (!apiKey || apiKey !== process.env.API_KEY) {
-    res.status(401).json({ error: "Unauthorized" });
+  const authHeader = req.headers.authorization;
+  if (!authHeader?.startsWith("Bearer ")) {
+    res.status(401).json({ error: "Missing or invalid Authorization header" });
     return;
   }
-  next();
+
+  const token = authHeader.slice(7);
+  try {
+    const payload = verify(token, JWT_SECRET);
+    (req as Request & { user: unknown }).user = payload;
+    next();
+  } catch {
+    res.status(401).json({ error: "Invalid or expired token" });
+  }
 }`,
            filePath: "./src/middleware/auth.ts",
          },
          type: "tool-edit_file",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            content: `import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  parseDate,
  parseJSON,
  safeParseJSON,
  slugify,
} from "./helpers";

describe("formatDate", () => {
  it("formats with default pattern", () => {
    const date = new Date("2024-03-15T00:00:00.000Z");
    expect(formatDate(date)).toBe("2024-03-15");
  });

  it("formats with custom pattern", () => {
    const date = new Date("2024-03-15T00:00:00.000Z");
    expect(formatDate(date, "MM/dd/yyyy")).toBe("03/15/2024");
  });
});

describe("parseJSON", () => {
  it("parses with type inference", () => {
    const result = parseJSON<{ name: string }>('{"name":"test"}');
    expect(result.name).toBe("test");
  });
});

describe("safeParseJSON", () => {
  it("returns fallback on invalid JSON", () => {
    const result = safeParseJSON("not json", { name: "fallback" });
    expect(result.name).toBe("fallback");
  });
});

describe("slugify", () => {
  it("converts to slug", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
});`,
            explanation: "Create comprehensive test file for helpers module",
            filePath: "./src/utils/helpers.test.ts",
          },
          output: {
            filePath: "./src/utils/helpers.test.ts",
          },
          type: "tool-write_file",
        }),
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
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            command:
              "agent-browser navigate https://github.com/vitest-dev/vitest" +
              " && agent-browser click #readme" +
              " && agent-browser navigate https://vitest.dev/guide/",
            explanation: "Browse the Vitest GitHub repo and docs",
            timeoutMs: 30_000,
          },
          output: {
            command:
              "agent-browser navigate https://github.com/vitest-dev/vitest" +
              " && agent-browser click #readme" +
              " && agent-browser navigate https://vitest.dev/guide/",
            commands: ["agent-browser"],
            durationMs: 4800,
            exitCode: 0,
            output:
              "Navigated to https://github.com/vitest-dev/vitest\n" +
              "Clicked #readme\n" +
              "Navigated to https://vitest.dev/guide/",
          },
          type: "tool-bash",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            command: "agent-browser navigate https://npmjs.com/package/vitest",
            explanation: "Check the Vitest npm package page",
            timeoutMs: 15_000,
          },
          output: {
            command: "agent-browser navigate https://npmjs.com/package/vitest",
            commands: ["agent-browser"],
            durationMs: 1600,
            exitCode: 0,
            output: "Navigated to https://www.npmjs.com/package/vitest",
          },
          type: "tool-bash",
        }),
        builder.toolPart(assistantMessageId, "output-available", {
          input: {},
          output: {},
          type: "tool-unavailable",
        }),
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
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation: "Generate a task icon for the helpers library",
            filePath: "./assets/helpers-icon",
            parameters: {
              background: "opaque",
              quality: "high",
            },
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
            modelId: OUR_MODELS.image.id,
            provider: {
              displayName: "Instrument",
              id: OUR_MODELS.providerType,
              type: OUR_MODELS.providerType,
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
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation:
              "Generate a dark variant of the icon based on the existing light version",
            filePath: "./assets/helpers-icon-dark",
            prompt:
              "A dark-theme variant of the helpers library icon. Same interlocking gear and wrench motif but with a deep navy background and glowing cyan accents.",
            sourceImages: ["./assets/helpers-icon.png"],
          },
          output: {
            images: [
              {
                filePath: "./assets/helpers-icon-dark.png",
                height: 1024,
                sizeBytes: 198_432,
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
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            explanation:
              "Compose a banner combining all icon variants into a cohesive marketing asset",
            filePath: "./assets/helpers-banner",
            prompt:
              "A wide marketing banner for the helpers library. Arrange the light and dark icon variants side by side with the library name in bold sans-serif typography. Clean white background with subtle grid texture.",
            sourceImages: [
              "./assets/helpers-icon.png",
              "./assets/helpers-icon-dark.png",
            ],
          },
          output: {
            images: [
              {
                filePath: "./assets/helpers-banner.png",
                height: 630,
                sizeBytes: 312_144,
                width: 1200,
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
  name: "Tools: Valid",
});
