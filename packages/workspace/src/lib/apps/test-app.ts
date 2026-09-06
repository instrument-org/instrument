import { type AbsolutePath } from "../../schemas/paths";
import { getWorkspaceConfig } from "../workspace-config";
import { recordConnection } from "./connection";
import { APP_GUIDE_FILE_NAME, APP_MANIFEST_EXAMPLE } from "./manifest";
import { listMcpTools, withMcpClient } from "./mcp/client";
import { mcpConnectionConfig } from "./mcp/connection-config";
import { mcpAuthProviderForCommand } from "./mcp/tool-auth";
import { performAppRequest, redactCredential } from "./request";
import { scanAppFolder } from "./secret-scan";
import { loadApp, readAppGuide } from "./store";

export interface AppTestReport {
  checks: AppTestCheck[];
  passed: boolean;
  slug: string;
}

interface AppTestCheck {
  detail: string;
  name: AppTestCheckName;
  status: "fail" | "pass" | "skip";
}

type AppTestCheckName =
  | "canary"
  | "credential"
  | "guide"
  | "manifest"
  | "secret-scan";

/** The report as lines the agent reads: one per check, the verdict first. */
export function formatAppTestReport(report: AppTestReport): string {
  const lines = report.checks.map(
    (check) =>
      `${check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "SKIP"} ${check.name}: ${check.detail}`,
  );
  const summary = report.passed
    ? `App "${report.slug}" passed every check and is connected.`
    : `App "${report.slug}" failed. Fix what failed and run \`app test ${report.slug}\` again.`;
  return [summary, "", ...lines].join("\n");
}

/**
 * The red/green loop for an app folder: validate the manifest, require a
 * guide, confirm a credential is present when the auth mode needs one, scan
 * the folder for leaked secrets, and reach the service for real (an MCP app
 * connects and lists its tools; an API app hits its canary path). A pass
 * records the connection, pinned to this manifest; a failure records why, so
 * the card and the page can say.
 *
 * The only way an app becomes connected apart from finishing a sign-in, and
 * it runs outside every mount, so the agent iterates on the folder and this
 * decides.
 */
export async function runAppTest({
  appsDir,
  signal,
  slug,
}: {
  appsDir: AbsolutePath;
  signal: AbortSignal;
  slug: string;
}): Promise<AppTestReport> {
  const checks: AppTestCheck[] = [];
  const report = () => ({
    checks,
    passed: checks.every((check) => check.status !== "fail"),
    slug,
  });
  const skipRemaining = (names: AppTestCheckName[], detail: string) => {
    for (const name of names) {
      checks.push({ detail, name, status: "skip" });
    }
    return report();
  };

  const loaded = await loadApp(appsDir, slug);
  if (loaded.isErr()) {
    checks.push({
      name: "manifest",
      ...failure(
        `${loaded.error.message}\nExpected manifest shape:\n${APP_MANIFEST_EXAMPLE}`,
      ),
    });
    return skipRemaining(
      ["guide", "credential", "secret-scan", "canary"],
      "Skipped because the manifest is not valid.",
    );
  }
  const app = loaded.value;
  checks.push({
    detail: `app.json parses: a ${app.manifest.type} app named "${app.manifest.name}".`,
    name: "manifest",
    status: "pass",
  });

  const guide = await readAppGuide(app.dir);
  checks.push(
    guide === null
      ? {
          name: "guide",
          ...failure(
            `${APP_GUIDE_FILE_NAME} is missing or empty. Write it before connecting: what the service is for, and for an API app the endpoints and conventions a request needs.`,
          ),
        }
      : {
          detail: `${APP_GUIDE_FILE_NAME} is present.`,
          name: "guide",
          status: "pass",
        },
  );

  const { apps } = getWorkspaceConfig();
  const credential = await apps.getCredential(slug);
  let missing: "key" | "sign-in" | undefined;
  if (app.manifest.auth.kind === "none") {
    checks.push({
      detail: "No credential required (auth kind is none).",
      name: "credential",
      status: "skip",
    });
  } else if (app.manifest.auth.kind === "oauth") {
    // OAuth tokens live in the OAuth store, not the credential store; the
    // connect check is what proves whether the user has signed in.
    checks.push({
      detail: "OAuth app: the sign-in is verified by the connect check.",
      name: "credential",
      status: "skip",
    });
  } else if (credential === null) {
    missing = "key";
    checks.push({
      name: "credential",
      ...failure(
        "No key is stored for this app. Ask the user for one with connect_app, then test again.",
      ),
    });
  } else {
    checks.push({
      detail: "A key is stored for this app.",
      name: "credential",
      status: "pass",
    });
  }

  const findings = await scanAppFolder({ credential, dir: app.dir });
  checks.push(
    findings.length > 0
      ? {
          name: "secret-scan",
          ...failure(
            findings
              .map((finding) => `${finding.file}: ${finding.detail}`)
              .join(" "),
          ),
        }
      : {
          detail: "No secret-shaped strings in the app's files.",
          name: "secret-scan",
          status: "pass",
        },
  );

  if (checks.some((check) => check.status === "fail")) {
    return finish(
      skipRemaining(["canary"], "Skipped because earlier checks failed."),
    );
  }

  if (app.manifest.type === "mcp") {
    const manifest = app.manifest;
    const authProvider = mcpAuthProviderForCommand(slug, manifest);
    if (manifest.auth.kind === "oauth" && authProvider === undefined) {
      checks.push({
        name: "canary",
        ...failure("Sign-in is not available in this context."),
      });
      return finish(report());
    }
    const mcpResult = await withMcpClient({
      authProvider,
      config: mcpConnectionConfig(manifest, credential),
      run: (client) => listMcpTools(client),
      signal,
    });
    if (mcpResult.isErr()) {
      if (
        manifest.auth.kind === "oauth" &&
        mcpResult.error.reason === "unauthorized"
      ) {
        missing = "sign-in";
      }
      checks.push({ name: "canary", ...failure(mcpResult.error.message) });
      return finish(report());
    }
    checks.push({
      detail: `Connected to the MCP server; ${mcpResult.value.length} tools available.`,
      name: "canary",
      status: "pass",
    });
    return finish(report(), mcpResult.value.length);
  }

  const manifest = app.manifest;
  const canaryMethod = manifest.test.method ?? "GET";
  const canary = await performAppRequest({
    body: manifest.test.body,
    credential,
    manifest,
    method: canaryMethod,
    params: {},
    path: manifest.test.path,
    signal,
  });
  if (canary.isErr()) {
    checks.push({ name: "canary", ...failure(canary.error.message) });
  } else if (canary.value.status >= 200 && canary.value.status < 300) {
    checks.push({
      detail: `${canaryMethod} ${manifest.test.path} returned ${canary.value.status}.`,
      name: "canary",
      status: "pass",
    });
  } else {
    const rejected = canary.value.status === 401 || canary.value.status === 403;
    checks.push({
      name: "canary",
      ...failure(
        `${canaryMethod} ${manifest.test.path} returned ${canary.value.status}. ${
          rejected
            ? "The stored key was rejected: it may be wrong, expired, or missing a scope. Ask for it again with connect_app."
            : `Expected a 2xx response; fix the test path or the manifest. Some APIs require static headers on every request (an API-version header, say): set them in the manifest's "headers". Response body: ${redactCredential(canary.value.bodyText, credential).slice(0, 400)}`
        }`,
      ),
    });
  }
  return finish(report());

  async function finish(result: AppTestReport, toolCount?: number) {
    if (result.passed) {
      await recordConnection(slug, {
        connectedAt: Date.now(),
        error: undefined,
        manifestHash: app.manifestHash,
        status: "connected",
        ...(toolCount === undefined ? {} : { toolCount }),
      });
      return result;
    }
    const firstFailure = result.checks.find((check) => check.status === "fail");
    await recordConnection(slug, {
      error: firstFailure?.detail.split("\n")[0]?.slice(0, 300),
      status:
        missing === "key"
          ? "needs-key"
          : missing === "sign-in"
            ? "needs-sign-in"
            : "failed",
    });
    return result;
  }
}

function failure(detail: string) {
  return { detail, status: "fail" as const };
}
