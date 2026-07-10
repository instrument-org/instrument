import { type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

import { type AbsolutePath } from "../../schemas/paths";
import {
  CONNECTOR_GUIDE_FILE_NAME,
  CONNECTOR_MANIFEST_EXAMPLE,
} from "./manifest";
import { type McpConnectorManifest } from "./manifest";
import { listMcpTools, withMcpClient } from "./mcp/client";
import { mcpConnectionConfig } from "./mcp/connection-config";
import { performConnectorRequest, redactCredential } from "./request";
import { scanConnectorFolder } from "./secret-scan";
import {
  loadConnector,
  readConnectorGuide,
  setConnectorEnabled,
} from "./store";

export interface ConnectorTestReport {
  checks: ConnectorTestCheck[];
  passed: boolean;
  slug: string;
}

interface ConnectorTestCheck {
  detail: string;
  name: ConnectorTestCheckName;
  status: "fail" | "pass" | "skip";
}

type ConnectorTestCheckName =
  | "canary-request"
  | "credential"
  | "guide"
  | "manifest"
  | "secret-scan"
  | "type";

/**
 * The red/green loop for a connector folder: validate the manifest, require a
 * usable guide, confirm a credential is present when the auth mode needs one,
 * scan the folder for leaked secrets, and hit the manifest's canary path with
 * real auth. This is the single enablement gate -- connector files are edited
 * freely through the /connectors mount, so nothing else validates them.
 */
export async function runConnectorTest({
  connectorsDir,
  getCredential,
  getMcpAuthProvider,
  signal,
  slug,
}: {
  connectorsDir: AbsolutePath;
  getCredential: (slug: string) => Promise<null | string>;
  // Supplies the OAuth provider for an oauth MCP connector (desktop app only).
  getMcpAuthProvider?: (
    slug: string,
    manifest: McpConnectorManifest,
  ) => OAuthClientProvider | undefined;
  signal: AbortSignal;
  slug: string;
}): Promise<ConnectorTestReport> {
  const checks: ConnectorTestCheck[] = [];
  const report = () => ({
    checks,
    passed: checks.every((check) => check.status !== "fail"),
    slug,
  });
  const skipRemaining = (names: ConnectorTestCheckName[], detail: string) => {
    for (const name of names) {
      checks.push({ detail, name, status: "skip" });
    }
    return report();
  };

  const loaded = await loadConnector(connectorsDir, slug);
  if (loaded.isErr()) {
    checks.push({
      detail: `${loaded.error.message}\nExpected manifest shape (auth kinds: bearer, header, query, none):\n${CONNECTOR_MANIFEST_EXAMPLE}`,
      name: "manifest",
      status: "fail",
    });
    return skipRemaining(
      ["type", "guide", "credential", "secret-scan", "canary-request"],
      "Skipped because the manifest is not valid.",
    );
  }
  const connector = loaded.value;
  checks.push(
    {
      detail: "connector.json parses and is valid.",
      name: "manifest",
      status: "pass",
    },
    {
      detail: `Connector type "${connector.manifest.type}" is supported.`,
      name: "type",
      status: "pass",
    },
  );

  const guide = await readConnectorGuide(connector.dir);
  checks.push(
    guide === null
      ? {
          detail: `${CONNECTOR_GUIDE_FILE_NAME} is missing or empty. Write it before enabling: it is the agent's only documentation for this API.`,
          name: "guide",
          status: "fail",
        }
      : {
          detail: `${CONNECTOR_GUIDE_FILE_NAME} is present.`,
          name: "guide",
          status: "pass",
        },
  );

  const credential = await getCredential(slug);
  if (connector.manifest.auth.kind === "none") {
    checks.push({
      detail: "No credential required (auth kind is none).",
      name: "credential",
      status: "skip",
    });
  } else if (connector.manifest.auth.kind === "oauth") {
    // OAuth tokens live in the OAuth store, not the header credential store;
    // the canary's connect proves whether the user has signed in.
    checks.push({
      detail: "OAuth connector -- sign-in is verified by the connect check.",
      name: "credential",
      status: "skip",
    });
  } else {
    checks.push(
      credential === null
        ? {
            detail:
              "No credential is stored for this connector. Request one with the connector_credential_prompt tool (users can also add it in Settings -> Connectors).",
            name: "credential",
            status: "fail",
          }
        : {
            detail: "A credential is stored for this connector.",
            name: "credential",
            status: "pass",
          },
    );
  }

  const findings = await scanConnectorFolder({
    credential,
    dir: connector.dir,
  });
  checks.push(
    findings.length > 0
      ? {
          detail: findings
            .map((finding) => `${finding.file}: ${finding.detail}`)
            .join(" "),
          name: "secret-scan",
          status: "fail",
        }
      : {
          detail: "No secret-shaped strings found in connector files.",
          name: "secret-scan",
          status: "pass",
        },
  );

  if (checks.some((check) => check.status === "fail")) {
    return skipRemaining(
      ["canary-request"],
      "Skipped because earlier checks failed.",
    );
  }

  // MCP connectors prove themselves by connecting and listing tools, not by an
  // HTTP canary.
  if (connector.manifest.type === "mcp") {
    const mcpResult = await withMcpClient({
      authProvider: getMcpAuthProvider?.(slug, connector.manifest),
      config: mcpConnectionConfig(connector.manifest, credential),
      run: (client) => listMcpTools(client),
      signal,
    });
    checks.push(
      mcpResult.isErr()
        ? {
            detail: mcpResult.error.message,
            name: "canary-request",
            status: "fail",
          }
        : {
            detail: `Connected to the MCP server; ${mcpResult.value.length} tool(s) available.`,
            name: "canary-request",
            status: "pass",
          },
    );
    return report();
  }

  const canaryMethod = connector.manifest.test.method ?? "GET";
  const canary = await performConnectorRequest({
    body: connector.manifest.test.body,
    credential,
    manifest: connector.manifest,
    method: canaryMethod,
    params: {},
    path: connector.manifest.test.path,
    signal,
  });
  if (canary.isErr()) {
    checks.push({
      detail: canary.error.message,
      name: "canary-request",
      status: "fail",
    });
  } else if (canary.value.status >= 200 && canary.value.status < 300) {
    checks.push({
      detail: `${canaryMethod} ${connector.manifest.test.path} returned ${canary.value.status}.`,
      name: "canary-request",
      status: "pass",
    });
  } else {
    checks.push({
      detail: `${canaryMethod} ${connector.manifest.test.path} returned ${canary.value.status}. ${
        canary.value.status === 401 || canary.value.status === 403
          ? "The stored credential was rejected -- it may be wrong, expired, or missing a scope."
          : `Expected a 2xx response; fix the test path or the connector config. Some APIs require static headers on every request (e.g. an API-version header) -- set them via the manifest's "headers" field. Response body: ${redactCredential(canary.value.bodyText, credential).slice(0, 400)}`
      }`,
      name: "canary-request",
      status: "fail",
    });
  }

  return report();
}

/**
 * Run the connector test and, on a green run, flip the manifest's `enabled`
 * flag. The single enablement path shared by the connector_test tool and the
 * settings UI's Test button.
 */
export async function runConnectorTestAndEnable(options: {
  connectorsDir: AbsolutePath;
  getCredential: (slug: string) => Promise<null | string>;
  getMcpAuthProvider?: (
    slug: string,
    manifest: McpConnectorManifest,
  ) => OAuthClientProvider | undefined;
  signal: AbortSignal;
  slug: string;
}): Promise<{ enabled: boolean; report: ConnectorTestReport }> {
  const report = await runConnectorTest(options);

  if (!report.passed) {
    return { enabled: false, report };
  }

  const loaded = await loadConnector(options.connectorsDir, options.slug);
  if (loaded.isErr()) {
    return { enabled: false, report };
  }
  if (!loaded.value.manifest.enabled) {
    await setConnectorEnabled(loaded.value, true);
  }
  return { enabled: true, report };
}
