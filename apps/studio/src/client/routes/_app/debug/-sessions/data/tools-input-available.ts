import { StoreId } from "@instrument-org/workspace/client";

import { registerSession, SessionBuilder } from "../helpers";

const builder = new SessionBuilder();
const sessionId = builder.getSessionId();

const assistantMessageId = StoreId.newMessageId();

registerSession({
  messages: [
    {
      id: assistantMessageId,
      metadata: {
        createdAt: builder.nextTime(),
        finishReason: "tool-calls",
        modelId: "claude-sonnet-4.5",
        providerId: "anthropic",
        sessionId,
      },
      parts: [
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            choices: ["React", "Vue", "Svelte"],
            explanation: "Ask user which frontend framework to use",
            question: "Which frontend framework should we use?",
          },
          type: "tool-choose",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            explanation: "Load the React skill for best practices",
            name: "react",
          },
          type: "tool-load_skill",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            explanation: "Launch retrieval agent to search external folder",
            prompt:
              "Search the attached folder for any existing TypeScript config files and report what you find.",
            subagent_type: "retrieval",
          },
          type: "tool-task",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            explanation: "Find all TypeScript files in the src directory",
            pattern: "src/**/*.ts",
          },
          type: "tool-glob",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            explanation: "Search for all usages of the formatDate function",
            pattern: "formatDate",
          },
          type: "tool-grep",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            explanation:
              "Read the helpers file to understand the implementation",
            filePath: "./src/utils/helpers.ts",
          },
          type: "tool-read_file",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
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
          type: "tool-edit_file",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
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
          type: "tool-write_file",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            command: "npm test -- helpers.test.ts",
            explanation: "Run tests for helpers module",
            timeoutMs: 30_000,
          },
          type: "tool-bash",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            command:
              "agent-browser navigate https://github.com/vitest-dev/vitest" +
              " && agent-browser click #readme" +
              " && agent-browser navigate https://vitest.dev/guide/",
            explanation: "Browse the Vitest GitHub repo and docs",
            timeoutMs: 30_000,
          },
          type: "tool-bash",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            command: "agent-browser navigate https://npmjs.com/package/vitest",
            explanation: "Check the Vitest npm package page",
            timeoutMs: 15_000,
          },
          type: "tool-bash",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            explanation: "Copy TypeScript config from attached folder",
            path: "/Users/user/external-project",
            pattern: "tsconfig*.json",
          },
          type: "tool-copy_to_project",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {},
          type: "tool-unavailable",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            explanation:
              "Search for the latest Vitest configuration best practices",
            query: "Vitest configuration best practices 2025",
          },
          type: "tool-web_search",
        }),
        builder.toolPart(assistantMessageId, "input-available", {
          input: {
            explanation: "Generate a project icon for the helpers library",
            filePath: "./assets/helpers-icon",
            prompt:
              "A minimal flat vector icon representing a code utility library. Features interlocking gear and wrench symbols in a modern blue gradient style on a transparent background.",
          },
          type: "tool-generate_image",
        }),
      ],
      role: "assistant",
    },
  ],
  name: "Tools: Input Available",
});
