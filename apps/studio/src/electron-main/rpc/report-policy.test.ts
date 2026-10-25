// land: every landing. It reads source as text, which `vitest related` cannot
// trace to the change that breaks it, so scripts/land.sh always runs it.
import { ORPCError, ValidationError } from "@orpc/server";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isReportableRPCError, RPC_ERROR_CODES } from "./report-policy";

function fetchFailed() {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.example"), {
      code: "ENOTFOUND",
    }),
  });
}

describe("isReportableRPCError", () => {
  it.each([
    ["NOT_FOUND", new ORPCError("NOT_FOUND"), false],
    ["UNAUTHORIZED", new ORPCError("UNAUTHORIZED"), false],
    ["INVALID_INPUT", new ORPCError("INVALID_INPUT"), false],
    ["NAME_IN_USE", new ORPCError("NAME_IN_USE"), false],
    ["NOTHING_TO_UNDO", new ORPCError("NOTHING_TO_UNDO"), false],
    ["CONFLICT", new ORPCError("CONFLICT"), false],
    ["a BAD_REQUEST a route chose", new ORPCError("BAD_REQUEST"), false],
    [
      "a BAD_REQUEST from oRPC's input check",
      new ORPCError("BAD_REQUEST", {
        cause: new ValidationError({ issues: [], message: "bad input" }),
      }),
      true,
    ],
    ["UNKNOWN", new ORPCError("UNKNOWN"), true],
    ["STORAGE_ERROR", new ORPCError("STORAGE_ERROR"), true],
    ["CANNOT_WRITE", new ORPCError("CANNOT_WRITE"), true],
    ["INTERNAL_SERVER_ERROR", new ORPCError("INTERNAL_SERVER_ERROR"), true],
    ["a code nobody classified", new ORPCError("SOMETHING_NEW"), true],
    ["a plain Error", new Error("boom"), true],
    ["a bare fetch failure", fetchFailed(), false],
    [
      "a fault wrapping the person's network",
      new ORPCError("GATEWAY_FETCH_ERROR", { cause: fetchFailed() }),
      false,
    ],
    [
      "a platform API route answering 5xx",
      new ORPCError("API_ERROR", {
        cause: new ORPCError("INTERNAL_SERVER_ERROR", { status: 502 }),
      }),
      false,
    ],
    [
      "a platform API route answering 4xx",
      new ORPCError("API_ERROR", {
        cause: new ORPCError("BAD_REQUEST", { status: 400 }),
      }),
      true,
    ],
  ])("%s → reported: %s", (_, error, reported) => {
    expect(isReportableRPCError(error)).toBe(reported);
  });
});

// Every code a procedure can throw, read from the source of both routers:
// `errors.CODE(...)` from a declared map, and `new ORPCError("CODE")` thrown by
// name. A code missing from the table would be reported as a fault by default,
// which is how expected answers kept landing in the exception log.
function thrownCodes() {
  const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
  const roots = ["apps/studio/src/electron-main", "packages/workspace/src"];
  const pattern =
    /[eE]rrors\.([A-Z][A-Z0-9_]+)\(|ORPCError\(\s*"([A-Z0-9_]+)"/g;
  const codes = new Map<string, string>();
  for (const root of roots) {
    for (const file of fs.globSync("**/*.ts", {
      cwd: path.join(repoRoot, root),
    })) {
      if (file.endsWith(".test.ts") || file.endsWith(".d.ts")) {
        continue;
      }
      const source = fs.readFileSync(path.join(repoRoot, root, file), "utf8");
      for (const match of source.matchAll(pattern)) {
        const code = match[1] ?? match[2];
        if (code && !codes.has(code)) {
          codes.set(code, path.join(root, file));
        }
      }
    }
  }
  return codes;
}

describe("RPC_ERROR_CODES", () => {
  it("classifies every code a procedure throws", () => {
    const codes = thrownCodes();
    // The scan found the routers rather than an empty tree.
    expect(codes.get("NOT_FOUND")).toBeDefined();
    const unclassified = [...codes]
      .filter(([code]) => !Object.hasOwn(RPC_ERROR_CODES, code))
      .map(([code, file]) => `${code} (${file})`);
    expect(unclassified).toEqual([]);
  });
});
