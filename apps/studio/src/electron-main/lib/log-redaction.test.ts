import log from "electron-log/node";
import { describe, expect, it } from "vitest";

import { guardLogger } from "./log-guards";
import { redactLogger } from "./log-redaction";

const TOKEN = `ghp_${"aB3dE5gH7j".repeat(3)}aB3dE5`;

function createRedactedLogger() {
  const logger = log.create({ logId: "log-redaction" });
  logger.transports.file.level = false;
  logger.transports.console.level = false;
  const lines: unknown[][] = [];
  const capture = (message: { data: unknown[] }) => {
    lines.push(message.data);
  };
  logger.transports.first = Object.assign(capture, {
    level: "silly" as const,
    transforms: [],
  });
  logger.transports.second = Object.assign(capture, {
    level: "silly" as const,
    transforms: [],
  });
  guardLogger(logger, { streams: [] });
  redactLogger(logger);
  return { lines, logger };
}

describe("redactLogger", () => {
  it("takes secrets and queries out of strings, errors and objects", () => {
    const { lines, logger } = createRedactedLogger();
    const error = new TypeError(`push failed with ${TOKEN}`, {
      cause: new Error("GET https://api.example.com/v1?key=abc failed"),
    });
    logger.info(
      "Failed to load URL: https://sync.example.com/start?uid=0f93d1df",
      error,
      { headers: { authorization: `Bearer ${TOKEN}` }, path: "/v1/items" },
    );
    const [text, logged, object] = lines[0] ?? [];
    expect(logged).toBeInstanceOf(TypeError);
    expect({
      cause: logged instanceof Error && String(logged.cause),
      message: logged instanceof Error && logged.message,
      object,
      stackStart: logged instanceof Error && logged.stack?.split("\n")[0],
      text,
    }).toMatchInlineSnapshot(`
      {
        "cause": "Error: GET https://api.example.com/v1?[query] failed",
        "message": "push failed with [secret: GitHub token]",
        "object": {
          "headers": {
            "authorization": "Bearer [secret: GitHub token]",
          },
          "path": "/v1/items",
        },
        "stackStart": "TypeError: push failed with [secret: GitHub token]",
        "text": "Failed to load URL: https://sync.example.com/start?[query]",
      }
    `);
    expect(error.message).toContain(TOKEN);
  });

  it("hands every transport the same line, so the repeat limit counts it once", () => {
    const { lines, logger } = createRedactedLogger();
    for (let index = 0; index < 25; index += 1) {
      logger.info(`same line ${TOKEN}`);
    }
    // 20 repeats per line pass the guard, to each of the two transports.
    expect(lines).toHaveLength(40);
  });
});
