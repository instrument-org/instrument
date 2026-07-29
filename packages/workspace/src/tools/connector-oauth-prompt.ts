import ms from "ms";
import { dedent } from "radashi";
import { z } from "zod";

import { TOOL_EXPLANATION_PARAM_NAME } from "../constants";
import { executeError } from "../lib/execute-error";
import { CONNECTORS_MOUNT_POINT } from "../lib/workspace-fs-layout";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Interactive tool: asks the user to sign in to an OAuth MCP connector. Like
 * `choose`/`connector_credential_prompt` it is never executed -- the agent
 * machine parks it, the UI renders a "Connect" button that opens the browser
 * sign-in, and the call resolves once the connector is connected (or declined).
 * The agent never handles tokens; it only learns connected/dismissed.
 */
export const ConnectorOAuthPrompt = setupTool({
  inputSchema: BaseInputSchema.extend({
    /* eslint-disable perfectionist/sort-objects */
    slug: z.string().meta({
      description: `The OAuth MCP connector to sign in to (its folder name under ${CONNECTORS_MOUNT_POINT}/). Generate this after ${TOOL_EXPLANATION_PARAM_NAME}.`,
    }),
    reason: z.string().meta({
      description:
        "One sentence shown to the user: what they're connecting and why. No URL or key needed -- it's a one-click browser sign-in.",
    }),
    /* eslint-enable perfectionist/sort-objects */
  }),
  name: "connector_oauth_prompt",
  outputSchema: z.object({
    slug: z.string(),
    state: z.enum(["connected", "dismissed"]),
  }),
}).create({
  description: dedent`
    Ask the user to sign in to an OAuth MCP connector. A "Connect" button is
    shown in the conversation; clicking it opens a browser sign-in and stores the
    tokens encrypted. Use this for connectors whose manifest is
    auth.kind: "oauth" instead of telling the user to open Settings.

    You only learn whether the user connected or declined. After they connect,
    the connector is enabled automatically -- use connector_mcp to list and call
    its tools.
  `,
  execute: () => {
    // Interactive: diverted to pendingToolCalls and resolved via the
    // resolveInteractiveToolCall RPC; this never runs.
    return Promise.resolve(executeError("Not implemented"));
  },
  readOnly: true,
  timeoutMs: ms("1 second"),
  toModelOutput: ({ output }) => {
    if (output.state === "connected") {
      return {
        type: "text",
        value: `The user signed in to connector "${output.slug}"; it is connected and enabled. Use connector_mcp (list_tools, then call_tool) to use it.`,
      };
    }
    return {
      type: "error-text",
      value: `The user declined to sign in to connector "${output.slug}". Continue without it or ask how they'd like to proceed.`,
    };
  },
});
