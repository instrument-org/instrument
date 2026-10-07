/**
 * Writes the agent's agent-browser guide from the installed release:
 * `src/lib/agent-browser-core-guide.generated.ts`, the core guide with the
 * sections `LEFT_OUT_SECTIONS` names removed, and its references. Run after
 * moving to a new agent-browser release; a test fails until it has been.
 *
 * Usage:
 *   pnpm --filter @instrument-org/workspace script:refresh-agent-browser-guide
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  coreGuideFrom,
  generatedGuideModule,
  installedAgentBrowser,
} from "../src/lib/agent-browser-guide-source";

const { coreDir, version } = installedAgentBrowser();
const target = path.resolve(
  import.meta.dirname,
  "../src/lib/agent-browser-core-guide.generated.ts",
);
writeFileSync(
  target,
  generatedGuideModule({ ...coreGuideFrom(coreDir), version }),
);
process.stdout.write(`Wrote the agent-browser ${version} guide to ${target}\n`);
