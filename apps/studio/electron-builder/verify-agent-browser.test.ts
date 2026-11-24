import { agentBrowserBinary } from "@instrument-org/shared/agent-browser-binary";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { verifyAgentBrowserBinary } from "./verify-agent-browser";

// The installed binary, found as the app finds it: the host's platform package,
// resolved from agent-browser's own folder.
function installedBinary() {
  const binary = agentBrowserBinary(platform(), arch());
  if (!binary) {
    throw new Error(`no agent-browser build for ${platform()}-${arch()}`);
  }
  const workspace = createRequire(
    createRequire(import.meta.url).resolve(
      "@instrument-org/workspace/package.json",
    ),
  );
  const manifest = createRequire(
    workspace.resolve("agent-browser/package.json"),
  ).resolve(`${binary.packageName}/package.json`);
  return path.join(path.dirname(manifest), binary.path);
}

describe("verifyAgentBrowserBinary", () => {
  it("accepts the installed binary and reports its version", () => {
    const { size, version } = verifyAgentBrowserBinary(installedBinary());
    expect(size).toBeGreaterThan(1_000_000);
    expect(version).toMatch(/^agent-browser \d+\.\d+\.\d+$/);
  });

  it("throws when the binary is too small to be complete", () => {
    const truncated = path.join(
      mkdtempSync(path.join(tmpdir(), "agent-browser-verify-")),
      "agent-browser",
    );
    writeFileSync(truncated, "not a real binary");
    expect(() => verifyAgentBrowserBinary(truncated)).toThrow(
      /expected a complete binary/,
    );
  });
});
