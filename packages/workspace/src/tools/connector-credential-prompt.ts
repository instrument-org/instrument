import ms from "ms";
import { dedent } from "radashi";
import { z } from "zod";

import { TOOL_EXPLANATION_PARAM_NAME } from "../constants";
import { executeError } from "../lib/execute-error";
import { CONNECTORS_MOUNT_POINT } from "../lib/workspace-fs-layout";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Interactive tool: asks the user to provide a credential for a connector.
 * Like `choose`, it is never executed -- the agent machine parks it as a
 * pending tool call, the UI renders a secure entry field, and the renderer
 * stores the value via the connectors RPC before resolving the call with
 * only granted/denied. The secret never passes through the model.
 */
export const ConnectorCredentialPrompt = setupTool({
  inputSchema: BaseInputSchema.extend({
    /* eslint-disable perfectionist/sort-objects */
    slug: z.string().meta({
      description: `The connector needing a credential (its folder name under ${CONNECTORS_MOUNT_POINT}/). Generate this after ${TOOL_EXPLANATION_PARAM_NAME}.`,
    }),
    reason: z.string().meta({
      description:
        "One or two sentences shown to the user: why the credential is needed and exactly where to get it (e.g. a URL to the provider's token page).",
    }),
    /* eslint-enable perfectionist/sort-objects */
  }),
  name: "connector_credential_prompt",
  outputSchema: z.object({
    slug: z.string(),
    state: z.enum(["granted", "denied"]),
  }),
}).create({
  description: dedent`
    Ask the user to provide an API credential for a connector. A secure entry
    field is shown in the conversation; the value is stored encrypted by the
    app and you never see it. Use this instead of asking the user to paste a
    key into the chat or to open Settings.

    You only learn whether the user granted or declined. After a grant, run
    connector_test to verify the credential works.
  `,
  execute: () => {
    // Interactive tools are diverted to pendingToolCalls by the agent machine
    // and resolved via the resolveInteractiveToolCall RPC; this never runs.
    return Promise.resolve(executeError("Not implemented"));
  },
  readOnly: true,
  timeoutMs: ms("1 second"),
  toModelOutput: ({ output }) => {
    if (output.state === "granted") {
      return {
        type: "text",
        value: `The user saved a credential for connector "${output.slug}". It is stored securely and injected automatically at request time. Run connector_test to verify it works.`,
      };
    }
    return {
      type: "error-text",
      value: `The user declined to provide a credential for connector "${output.slug}". Do not ask again unless they change their mind; continue without this connector or ask how they'd like to proceed.`,
    };
  },
});
