// land: every landing. It reads source as text, which `vitest related` cannot
// trace to the change that breaks it, so scripts/land.sh always runs it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(import.meta.dirname, "../..");

/** The AI SDK calls that reach a model and take `telemetry`. */
const MODEL_CALL =
  /\b(?:generateText|streamText|generateObject|streamObject)\(/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name),
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** The text of the call starting at `start`, up to its closing parenthesis. */
function callText(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  return source.slice(start);
}

/**
 * Every model call names why it was made. One that passes no `telemetry` is
 * still recorded, by the fallback `registerActivityTelemetry` installs, but
 * as Other and with no connection, so the activity log can say neither what
 * it was for nor which provider answered.
 */
describe("model calls", () => {
  it("each pass activityTelemetry", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(MODEL_CALL)) {
        if (!/\btelemetry:/.test(callText(source, match.index))) {
          const line = source.slice(0, match.index).split("\n").length;
          missing.push(`${path.relative(SRC, file)}:${String(line)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
