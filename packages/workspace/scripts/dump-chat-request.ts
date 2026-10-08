import "./lib/test-node-env";
import "./lib/define-globals-apply";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as z from "zod";

import { buildReportWorkspaceConfig } from "../evals/utils";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { instrumentAgent } from "../src/agents/instrument";

// The bash tool builds its description from the running workspace (mount paths,
// which commands exist), so a config has to be in place before it is read.
setWorkspaceConfig(
  buildReportWorkspaceConfig(path.join(os.tmpdir(), "chat-request-dump")),
);

/**
 * The tool half of what the chat's first turn actually sends.
 *
 * A latency or delegation sweep run straight against a provider needs the same
 * request the app builds, and the system half of it can be read off a recorded
 * session while this half only exists at request time. Dumping it once gives
 * those sweeps a fixture instead of a hand-written approximation, which would
 * be measuring a prompt nothing ships.
 */
const { values } = parseArgs({
  options: {
    out: { type: "string" },
  },
});

const tools = await Promise.all(
  Object.values(instrumentAgent.agentTools).map(async (agentTool) => ({
    function: {
      description:
        typeof agentTool.description === "function"
          ? await agentTool.description({
              model: undefined as never,
              taskId: undefined as never,
            })
          : agentTool.description,
      name: agentTool.name,
      parameters: z.toJSONSchema(agentTool.inputSchema, { io: "input" }),
    },
    type: "function" as const,
  })),
);

const payload = { agent: instrumentAgent.name, tools };
const text = `${JSON.stringify(payload, null, 2)}\n`;
if (values.out) {
  fs.writeFileSync(values.out, text);
  process.stderr.write(
    `Wrote ${tools.length} tool definitions to ${values.out}\n`,
  );
} else {
  process.stdout.write(text);
}
