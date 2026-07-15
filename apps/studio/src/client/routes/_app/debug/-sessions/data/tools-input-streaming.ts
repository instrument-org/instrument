import { StoreId } from "@instrument-org/workspace/client";

import { registerSession, SessionBuilder } from "../helpers";

const builder = new SessionBuilder();
const sessionId = builder.getSessionId();

const assistantMessageId = StoreId.newMessageId();

registerSession({
  messages: [
    builder.userMessage("Do everything, but stream it all."),
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
        builder.textPart("Calling choose...", assistantMessageId),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            choices: ["React", "Vue", "Svelte"],
            question: "Which framework should we use?",
          },
          type: "tool-choose",
        }),

        // Partial filePath — tests FileChip appearing mid-stream
        builder.textPart(
          "Calling edit_file (partial path)...",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Update greeting message",
            filePath: "./src/hel",
            newString: "",
            oldString: "",
          },
          type: "tool-edit_file",
        }),

        // Full filePath — tests FileChip fully resolved while still streaming
        builder.textPart(
          "Calling edit_file (full path)...",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Refactor auth middleware to use JWT",
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

        builder.textPart("Calling generate_image...", assistantMessageId),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Generate a sunset image",
            filePath: "./images/sunset.png",
            parameters: {
              aspectRatio: "16:9",
              background: "opaque",
              quality: "high",
            },
            prompt: "A beautiful sunset over mountains",
          },
          type: "tool-generate_image",
        }),
        builder.textPart("Calling load_skill...", assistantMessageId),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Load the React skill for best practices",
            name: "re",
          },
          type: "tool-load_skill",
        }),
        builder.textPart("Calling glob...", assistantMessageId),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Find all TypeScript files",
            pattern: "src/**/*.ts",
          },
          type: "tool-glob",
        }),
        builder.textPart("Calling grep...", assistantMessageId),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Search for formatDate usages",
            pattern: "formatDate",
          },
          type: "tool-grep",
        }),

        // Partial filePath — tests FileChip appearing mid-stream
        builder.textPart(
          "Calling read_file (partial path)...",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Read the helpers file",
            filePath: "./src/utils/hel",
          },
          type: "tool-read_file",
        }),

        // Full filePath — tests FileChip fully resolved while still streaming
        builder.textPart(
          "Calling read_file (full path)...",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Read the helpers file",
            filePath: "./src/utils/helpers.ts",
          },
          type: "tool-read_file",
        }),

        builder.textPart("Calling bash...", assistantMessageId),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            command: "npm test -- helpers.test.ts",
            explanation: "Run tests for helpers module",
            timeoutMs: 30_000,
          },
          type: "tool-bash",
        }),

        builder.textPart("Calling unavailable...", assistantMessageId),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {},
          type: "tool-unavailable",
        }),
        builder.textPart("Calling web_search...", assistantMessageId),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            explanation: "Search for Vitest best practices",
            query: "Vitest configuration best practices 2025",
          },
          type: "tool-web_search",
        }),

        // Partial filePath — tests FileChip appearing mid-stream
        builder.textPart(
          "Calling write_file (partial path)...",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            content: "",
            explanation: "Create a hello function",
            filePath: "./src/hel",
          },
          type: "tool-write_file",
        }),

        // Full filePath — tests FileChip fully resolved while still streaming
        builder.textPart(
          "Calling write_file (full path)...",
          assistantMessageId,
        ),
        builder.toolPart(assistantMessageId, "input-streaming", {
          input: {
            content: `import QRCode from "qr-code";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = "./output/qr-codes";

interface QROptions {
  url: string;
  filename: string;
  size?: number;
  margin?: number;
}

async function generateQR({
  url,
  filename,
  size = 512,
  margin = 2,
}: QROptions): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, filename);

  await QRCode.toFile(outputPath, url, {
    type: "png",
    width: size,
    margin,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "H",
  });

  console.log(\`QR code saved to \${outputPath}\`);
}

const codes: QROptions[] = [
  { url: "https://tryinstrument.com", filename: "instrument.png" },
  { url: "https://github.com/instrument-org", filename: "github.png", size: 256 },
];

for (const code of codes) {
  await generateQR(code);
}`,
            explanation: "Generate QR codes for all task URLs",
            filePath: "./src/generate-qr.ts",
          },
          type: "tool-write_file",
        }),
      ],
      role: "assistant",
    },
  ],
  name: "Tools: Input Streaming",
});
