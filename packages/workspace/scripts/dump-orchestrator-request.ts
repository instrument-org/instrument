import "./lib/test-node-env";
import "./lib/define-globals-apply";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as z from "zod";

import { buildReportWorkspaceConfig } from "../evals/utils";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { TOOLS } from "../src/tools/all";

// The bash tool builds its description from the running workspace (mount paths,
// which commands exist), so a config has to be in place before it is read.
setWorkspaceConfig(
  buildReportWorkspaceConfig(
    path.join(os.tmpdir(), "orchestrator-request-dump"),
  ),
);

/**
 * The tool half of what the orchestrator's first turn actually sends.
 *
 * A latency or delegation sweep run straight against a provider needs the same
 * request the app builds, and the system half of it can be read off a recorded
 * session while this half only exists at request time. Dumping it once gives
 * those sweeps a fixture instead of a hand-written approximation, which would
 * be measuring a prompt nothing ships.
 */
const ORCHESTRATOR_TOOL_NAMES = [
  "BashTool",
  "Choose",
  "ConnectApp",
  "RequestFolder",
] as const satisfies (keyof typeof TOOLS)[];

const { values } = parseArgs({
  options: {
    agent: { default: "instrument", type: "string" },
    out: { type: "string" },
  },
});

const tools = ORCHESTRATOR_TOOL_NAMES.map((name) => {
  const agentTool = TOOLS[name];
  const inputSchema =
    typeof agentTool.inputSchema === "function"
      ? agentTool.inputSchema(values.agent as never)
      : agentTool.inputSchema;
  return {
    function: {
      description:
        typeof agentTool.description === "function"
          ? agentTool.description({ agentName: values.agent } as never)
          : agentTool.description,
      name: agentTool.name,
      parameters: z.toJSONSchema(inputSchema, { io: "input" }),
    },
    type: "function" as const,
  };
});

const payload = { agent: values.agent, tools };
const text = `${JSON.stringify(payload, null, 2)}\n`;
if (values.out) {
  fs.writeFileSync(values.out, text);
  process.stderr.write(
    `Wrote ${tools.length} tool definitions to ${values.out}\n`,
  );
} else {
  process.stdout.write(text);
}
