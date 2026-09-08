import { MOUNT } from "../../mount-points";
import { type AbsolutePath } from "../../schemas/paths";
import { APP_COMMAND } from "../shell-commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import { recordConnection } from "./connection";
import {
  APP_GUIDE_FILE_NAME,
  APP_MANIFEST_EXAMPLE,
  isMcpManifest,
} from "./manifest";
import { listMcpTools } from "./mcp/client";
import { withAppMcpClient } from "./mcp/run";
import { mcpAuthProviderForCommand } from "./mcp/tool-auth";
import { performAppRequest, redactCredential } from "./request";
import { scanAppFolder } from "./secret-scan";
import { guidePlaceholdersLeft, loadApp, readAppGuide } from "./store";

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
  // A guide still carrying the skeleton's prompts is worse than none: it
  // passes as "present", and then the first request in a task is answered with
  // the blank form instead of the endpoint it asked about. The prompts left in
  // it are the questions about this service nobody wrote down.
  const unanswered = guide === null ? [] : guidePlaceholdersLeft(guide);
  checks.push(
    guide === null
      ? {
          name: "guide",
          ...failure(
            `${APP_GUIDE_FILE_NAME} is missing or empty. Write it before connecting: what the service is for, and for an API app the endpoints and conventions a request needs.`,
          ),
        }
      : unanswered.length > 0
        ? {
            name: "guide",
            ...failure(
              `${MOUNT.apps}/${slug}/${APP_GUIDE_FILE_NAME} is still the skeleton \`${APP_COMMAND.name} new\` wrote: ${unanswered.length} of its prompts are unanswered. Answer them from what you know about the service before connecting, since this file is what the first request in a task is handed instead of its answer. Still there: ${unanswered.map((prompt) => `"${prompt}"`).join(" ")}`,
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
  let missing: "approval" | "key" | "sign-in" | undefined;
  if (app.manifest.auth.kind === "none") {
    checks.push({
      detail: "No credential required (auth kind is none).",
      name: "credential",
      status: "skip",
    });
  } else if (app.manifest.type === "mcp-local" && credential === null) {
    missing = "key";
    checks.push({
      name: "credential",
      ...failure(
        `No key is stored for this app; its server reads one from ${app.manifest.auth.envVar}. Ask the user for one with connect_app, then test again.`,
      ),
    });
  } else if (app.manifest.auth.kind === "oauth") {
    // OAuth tokens live in the OAuth store, not the credential store. The
    // connect check cannot stand in for this: a server that answers a
    // stranger's tools/list passes it with no sign-in behind it.
    if (apps.oauth === undefined) {
      checks.push({
        detail: "OAuth app: no sign-in is possible in this context.",
        name: "credential",
        status: "skip",
      });
    } else if ((await apps.oauth.store.getTokens(slug)) === undefined) {
      missing = "sign-in";
      checks.push({
        name: "credential",
        ...failure(
          "No sign-in is stored for this app. Ask the user to sign in with connect_app; the app connects on its own when they do.",
        ),
      });
    } else {
      checks.push({
        detail: "A sign-in is stored for this app.",
        name: "credential",
        status: "pass",
      });
    }
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

  if (isMcpManifest(app.manifest)) {
    const manifest = app.manifest;
    if (
      manifest.type === "mcp" &&
      manifest.auth.kind === "oauth" &&
      mcpAuthProviderForCommand(slug, manifest) === undefined
    ) {
      checks.push({
        name: "canary",
        ...failure("Sign-in is not available in this context."),
      });
      return finish(report());
    }
    const mcpResult = await withAppMcpClient({
      credential,
      manifest,
      manifestHash: app.manifestHash,
      run: (client) => listMcpTools(client),
      signal,
      slug,
    });
    if (mcpResult.isErr()) {
      if (mcpResult.error.reason === "unapproved") {
        missing = "approval";
      } else if (
        manifest.type === "mcp" &&
        manifest.auth.kind === "oauth" &&
        mcpResult.error.reason === "unauthorized"
      ) {
        missing = "sign-in";
      }
      checks.push({ name: "canary", ...failure(mcpResult.error.message) });
      return finish(report());
    }
    checks.push({
      detail:
        manifest.type === "mcp-local"
          ? `Started the server and listed its tools; ${mcpResult.value.length} available.`
          : `Connected to the MCP server; ${mcpResult.value.length} tools available.`,
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
            ? // A key the service would accept is refused exactly like a wrong
              // one when it rides in the wrong place, and the placement is the
              // thing the agent chose and can change. Naming only the key sends
              // it back to the card for a key that was right all along.
              `The key was refused. That is as often the wrong placement as the wrong key: a service that documents Basic credentials, an \`X-Api-Key\`, or an \`api_key\` query parameter refuses a bearer token just like this. Try the placements the manifest can take (bearer, basic, basic:<user>, header:<Name>, query:<param>) with \`${APP_COMMAND.name} new ${slug} ... --force\`, then \`${APP_COMMAND.name} test ${slug}\`, which reuses the stored key and does not ask the user. Only once every one is refused is the key itself in question: ask for it again with connect_app, saying what was wrong.`
            : `Expected a 2xx response; fix the test path or the manifest. Some APIs require static headers on every request (an API-version header, say): set them in the manifest's "headers".`
        } Response body: ${redactCredential(canary.value.bodyText, credential).slice(0, 400)}`,
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
            : missing === "approval"
              ? "needs-approval"
              : "failed",
    });
    return result;
  }
}

function failure(detail: string) {
  return { detail, status: "fail" as const };
}
