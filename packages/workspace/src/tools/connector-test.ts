import ms from "ms";
import { ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { TOOL_EXPLANATION_PARAM_NAME } from "../constants";
import {
  CONNECTOR_GUIDE_FILE_NAME,
  CONNECTOR_MANIFEST_EXAMPLE,
  CONNECTOR_MANIFEST_FILE_NAME,
} from "../lib/connectors/manifest";
import { mcpAuthProviderForTool } from "../lib/connectors/mcp/tool-auth";
import { runConnectorTestAndEnable } from "../lib/connectors/test-connector";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { CONNECTORS_MOUNT_POINT } from "../lib/workspace-fs-layout";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const CheckSchema = z.object({
  detail: z.string(),
  name: z.string(),
  status: z.enum(["fail", "pass", "skip"]),
});

export const ConnectorTest = setupTool({
  inputSchema: BaseInputSchema.extend({
    slug: z.string().meta({
      description: `The connector to test (its folder name under ${CONNECTORS_MOUNT_POINT}/). Generate this after ${TOOL_EXPLANATION_PARAM_NAME}.`,
    }),
  }),
  name: "connector_test",
  outputSchema: z.object({
    checks: z.array(CheckSchema),
    enabled: z.boolean(),
    passed: z.boolean(),
    slug: z.string(),
  }),
}).create({
  description: dedent`
    Validate a connector folder end to end: manifest schema, guide presence,
    stored credential, a scan for secrets accidentally written into connector
    files, and a live canary request against the service using the manifest's
    test path.

    A passing run enables the connector automatically. Use this as a
    red/green loop while creating or repairing a connector at
    ${CONNECTORS_MOUNT_POINT}/<slug>/ (${CONNECTOR_MANIFEST_FILE_NAME} + ${CONNECTOR_GUIDE_FILE_NAME}):
    edit, test, fix what failed, and test again.

    ${CONNECTOR_MANIFEST_FILE_NAME} format (strict -- unknown keys are rejected;
    auth kinds: bearer, header (with "header" name), query (with "param"), none;
    "headers" holds static non-secret headers sent with every request; the
    credential itself is stored by the app, never in files):
    ${CONNECTOR_MANIFEST_EXAMPLE}
  `,
  execute: async ({ input, signal }) => {
    const config = getWorkspaceConfig();

    const { enabled, report } = await runConnectorTestAndEnable({
      connectorsDir: config.connectorsDir,
      getCredential: (slug) => config.connectors.getCredential(slug),
      getMcpAuthProvider: mcpAuthProviderForTool,
      signal,
      slug: input.slug,
    });

    return ok({
      checks: report.checks,
      enabled,
      passed: report.passed,
      slug: report.slug,
    });
  },
  readOnly: false,
  timeoutMs: ms("1 minute"),
  toModelOutput: ({ output }) => {
    const lines = output.checks.map(
      (check) =>
        `${check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "SKIP"} ${check.name}: ${check.detail}`,
    );

    const summary = output.passed
      ? `Connector "${output.slug}" passed all checks and is ${output.enabled ? "enabled" : "ready"}.`
      : `Connector "${output.slug}" failed. Fix the failing checks and run connector_test again.`;

    return {
      type: output.passed ? "text" : "error-text",
      value: [summary, "", ...lines].join("\n"),
    };
  },
});
