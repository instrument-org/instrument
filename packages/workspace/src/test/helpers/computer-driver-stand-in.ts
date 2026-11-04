import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";

/** What the stand-in answers, by the driver's command word. */
export type DriverAnswers = Record<string, unknown>;

const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify(args) + "\\n");
const answers = JSON.parse(fs.readFileSync(path.join(dir, "answers.json"), "utf8"));
const answer = answers[args[0]];
process.stdout.write(JSON.stringify(answer ?? { ok: true, data: {} }));
`;

/**
 * An executable that answers as the desktop driver does and records every
 * call, set as this process's driver: the real spawn and the real parsing run
 * against it, and no app on the computer is touched.
 */
export function standInDriver(
  answers: DriverAnswers,
  { ready = true, enabled = true }: { enabled?: boolean; ready?: boolean } = {},
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "computer-driver-"));
  const binaryPath = path.join(dir, "agent-desktop");
  fs.writeFileSync(binaryPath, SCRIPT, { mode: 0o755 });
  const setAnswers = (next: DriverAnswers) => {
    fs.writeFileSync(path.join(dir, "answers.json"), JSON.stringify(next));
  };
  setAnswers(answers);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    computerUse: {
      binaryPath,
      isEnabled: () => enabled,
      isReady: () => ready,
      ownBundleId: "com.example.own",
      stateDir: () => dir,
    },
  });
  return {
    /** Every call so far, without the session the wrapper adds to each. */
    calls(): string[][] {
      const file = path.join(dir, "calls.jsonl");
      if (!fs.existsSync(file)) {
        return [];
      }
      return fs
        .readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[])
        .map((call) => call.slice(0, -2));
    },
    /** The calls that aren't how the wrapper finds its way around. */
    actions(): string[][] {
      return this.calls().filter(
        ([word]) => word !== "list-apps" && word !== "list-windows",
      );
    },
    setAnswers,
  };
}

export function ok(data: unknown) {
  return { command: "stand-in", data, ok: true, version: "2.6" };
}

export function refused(
  code: string,
  message: string,
  retry: "safe" | "unsafe" = "safe",
) {
  return {
    command: "stand-in",
    error: { code, disposition: { retry }, message },
    ok: false,
    version: "2.6",
  };
}
