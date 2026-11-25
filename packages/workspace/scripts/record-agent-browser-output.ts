/**
 * Records what the installed agent-browser prints (its help, and a snapshot of
 * a page in a headless browser) into
 * `src/lib/shell-commands/agent-browser-cli-output.generated.ts`. Run after
 * moving to a new agent-browser release; a test fails until it has been.
 *
 * Usage:
 *   pnpm --filter @instrument-org/workspace script:record-agent-browser-output
 */

import "./lib/define-globals-apply";

import { writeFileSync } from "node:fs";
import path from "node:path";

import { agentBrowserPath } from "../src/lib/agent-browser";
import { installedAgentBrowser } from "../src/lib/agent-browser-guide-source";
import {
  generatedRecordingModule,
  recordAgentBrowserOutput,
} from "../src/lib/shell-commands/agent-browser-cli-recording";

const { version } = installedAgentBrowser();
const target = path.resolve(
  import.meta.dirname,
  "../src/lib/shell-commands/agent-browser-cli-output.generated.ts",
);
writeFileSync(
  target,
  generatedRecordingModule(
    recordAgentBrowserOutput(agentBrowserPath(), version),
  ),
);
process.stdout.write(`Wrote agent-browser ${version}'s output to ${target}\n`);
