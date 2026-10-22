import { APP_NAME } from "@instrument-org/shared";

import { type AbsolutePath } from "../../schemas/paths";
import { APP_COMMAND } from "../shell-commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import { isConnected, readConnection, recordConnection } from "./connection";
import {
  credentialMovedMessage,
  lookupAppCredential,
  redactorFor,
} from "./credential-origin";
import { APP_FILE_NAME } from "./app-file";
import {
  APP_MANIFEST_EXAMPLE,
  isMcpManifest,
  type WebAppManifest,
} from "./manifest";
import { clientRefused, listMcpTools } from "./mcp/client";
import { withAppMcpClient } from "./mcp/run";
import { mcpAuthProviderForCommand } from "./mcp/tool-auth";
import { credentialOrigin } from "./origin-bound";
import { performSignedInRequest, SignInNeededError } from "./api-oauth";
import { webInsteadUrl } from "./site";
import { webInsteadCommand } from "./web-instead";
import { performAppRequest, redactCredential } from "./request";
import { scanAppFolder } from "./secret-scan";
import {
  type AppInfo,
  guidePlaceholdersLeft,
  loadApp,
  readAppGuide,
} from "./store";

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
    : `App "${report.slug}" failed. Fix what failed and run \`instrument app test ${report.slug}\` again.`;
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
 * The only way an app becomes connected apart from finishing a sign-in (for
 * a web app, the user saying on the card that they are signed in), and it
 * runs outside every mount, so the agent iterates on the folder and this
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
    detail: `${APP_FILE_NAME} parses: a ${app.manifest.type} app named "${app.name}".`,
    name: "manifest",
    status: "pass",
  });

  if (app.manifest.type === "web") {
    return finishWeb(
      await testWebApp({ app: { ...app, manifest: app.manifest }, checks }),
    );
  }

  const guide = await readAppGuide(app.dir);
  // A guide still carrying the skeleton's prompts is worse than none: it
  // passes as "present", and then the first request in a task is answered with
  // the blank form instead of the endpoint it asked about. The prompts left in
  // it are the questions about this service nobody wrote down. Only an API
  // app's guide is handed to a request; an MCP app's tools describe
  // themselves.
  const unanswered =
    guide === null ? [] : guidePlaceholdersLeft(app.manifest, guide);
  const write = `Write it with \`${APP_COMMAND.name} guide ${slug} <<'EOF'\`, the whole file on stdin.`;
  checks.push(
    app.manifest.type === "api"
      ? guide === null
        ? {
            name: "guide",
            ...failure(
              `The guide is missing: there is nothing under the front matter in ${APP_FILE_NAME}. An API app needs one before connecting: what the service is for, the endpoints a request needs, and its conventions. ${write}`,
            ),
          }
        : unanswered.length > 0
          ? {
              name: "guide",
              ...failure(
                `The guide in ${shellPath(app.dir)}/${APP_FILE_NAME} still has prompts \`${APP_COMMAND.name} new\` left: ${unanswered.length} unanswered. Answer them from what you know about the service before connecting, since the guide is what the first request in a task is handed instead of its answer. ${write} Still there: ${unanswered.map((prompt) => `"${prompt}"`).join(" ")}`,
              ),
            }
          : {
              detail: "The guide is written.",
              name: "guide",
              status: "pass",
            }
      : {
          detail:
            guide === null
              ? "No guide; an MCP app's tools describe themselves."
              : "The guide is written.",
          name: "guide",
          status: "pass",
        },
  );

  const { apps } = getWorkspaceConfig();
  // A key goes only to the origin it was saved for; a manifest pointed
  // elsewhere since gets none, and the user is asked again.
  const lookup = await lookupAppCredential(slug, app.manifest);
  const credential = lookup.kind === "ok" ? lookup.value : null;
  let missing: "approval" | "key" | "sign-in" | undefined;
  if (app.manifest.auth.kind === "none") {
    checks.push({
      detail: "No credential required (auth kind is none).",
      name: "credential",
      status: "skip",
    });
  } else if (lookup.kind === "moved" && app.manifest.auth.kind !== "oauth") {
    missing = "key";
    checks.push({
      name: "credential",
      ...failure(credentialMovedMessage({ noun: "key", ...lookup })),
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
    const signIn = await apps.oauth?.store.getTokens(slug);
    const origin = credentialOrigin(app.manifest);
    if (apps.oauth === undefined) {
      checks.push({
        detail: "OAuth app: no sign-in is possible in this context.",
        name: "credential",
        status: "skip",
      });
    } else if (signIn === undefined) {
      missing = "sign-in";
      checks.push({
        name: "credential",
        ...failure(
          "No sign-in is stored for this app. Ask the user to sign in with connect_app; the app connects on its own when they do.",
        ),
      });
    } else if (signIn.origin !== origin) {
      missing = "sign-in";
      checks.push({
        name: "credential",
        ...failure(
          credentialMovedMessage({
            noun: "sign-in",
            savedFor: signIn.origin,
            sendsTo: origin,
          }),
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

  // A failure's text reaches the agent, and a local server's stderr or a
  // service's answer can repeat the key it was handed.
  const redact = await redactorFor(slug, app.manifest, credential);

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
      // A server that refuses the sign-in client itself refuses every new
      // sign-in the same way, so the web is the way on.
      const refusedClient =
        manifest.type === "mcp" &&
        manifest.auth.kind === "oauth" &&
        clientRefused(mcpResult.error.cause);
      checks.push({
        name: "canary",
        ...failure(
          `${redact(mcpResult.error.message)}${
            refusedClient
              ? ` The server refuses ${APP_NAME}'s sign-in client, so signing in again meets the same refusal. Sign in on the web instead: \`${webInsteadCommand(slug, webInsteadUrl(slug, manifest))}\`, then connect_app.`
              : ""
          }`,
        ),
      });
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
  const canaryRequest = {
    body: manifest.test.body,
    manifest,
    method: canaryMethod,
    params: {},
    path: manifest.test.path,
    signal,
  };
  const signedIn = manifest.auth.kind === "oauth";
  // A signed-in API's request carries its access token, refreshed when the
  // API refuses it; whatever it sent is kept out of the report.
  let sent = credential;
  let canary: Awaited<ReturnType<typeof performAppRequest>>;
  if (signedIn) {
    try {
      const signed = await performSignedInRequest({ ...canaryRequest, slug });
      canary = signed.result;
      sent = signed.token;
    } catch (error) {
      if (error instanceof SignInNeededError) {
        missing = "sign-in";
      }
      checks.push({
        name: "canary",
        ...failure(error instanceof Error ? error.message : String(error)),
      });
      return finish(report());
    }
  } else {
    canary = await performAppRequest({ ...canaryRequest, credential });
  }
  if (canary.isErr()) {
    checks.push({ name: "canary", ...failure(redact(canary.error.message)) });
  } else if (canary.value.status >= 200 && canary.value.status < 300) {
    checks.push({
      detail: `${canaryMethod} ${manifest.test.path} returned ${canary.value.status}.`,
      name: "canary",
      status: "pass",
    });
  } else {
    const rejected = canary.value.status === 401 || canary.value.status === 403;
    if (signedIn && canary.value.status === 401) {
      missing = "sign-in";
    }
    checks.push({
      name: "canary",
      ...failure(
        `${canaryMethod} ${manifest.test.path} returned ${canary.value.status}. ${
          signedIn && canary.value.status === 401
            ? `The sign-in was refused even after a refresh. Ask the user to sign in again with connect_app; if that sign-in fails or is refused, sign in on the web instead: \`${webInsteadCommand(slug, webInsteadUrl(slug, manifest))}\`, then connect_app.`
            : signedIn && rejected
              ? `The API knows the signed-in account and refuses it this request: the account, or what the sign-in asked for, lacks a permission it needs.`
              : rejected
                ? // A key the service would accept is refused exactly like a wrong
                  // one when it rides in the wrong place, and the placement is the
                  // thing the agent chose and can change. Naming only the key sends
                  // it back to the card for a key that was right all along.
                  `The key was refused. That is as often the wrong placement as the wrong key: a service that documents Basic credentials, an \`X-Api-Key\`, or an \`api_key\` query parameter refuses a bearer token just like this. Try the placements the manifest can take (bearer, basic, basic:<user>, header:<Name>, query:<param>) with \`${APP_COMMAND.name} new ${slug} ... --force\`, then \`${APP_COMMAND.name} test ${slug}\`, which reuses the stored key and does not ask the user. Only once every one is refused is the key itself in question: ask for it again with connect_app, saying what was wrong.`
                : `Expected a 2xx response; fix the test path or the manifest. Some APIs require static headers on every request (an API-version header, say): set them in the manifest's "headers".`
        } Response body: ${redactCredential(redact(canary.value.bodyText), sent).slice(0, 400)}`,
      ),
    });
  }
  return finish(report());

  // A web app's record is the user's word that they are signed in, which only
  // the card writes: a pass leaves it as it stands, and a failure says what
  // is missing.
  async function finishWeb(result: AppTestReport) {
    if (!result.passed) {
      const firstFailure = result.checks.find(
        (check) => check.status === "fail",
      );
      await recordConnection(slug, {
        error: firstFailure?.detail.split("\n")[0]?.slice(0, 300),
        status:
          firstFailure?.name === "credential" ? "needs-sign-in" : "failed",
      });
    }
    return result;
  }

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

/**
 * A web app's checks: there is no credential to find and no service to call,
 * so what passes is the user's own word, recorded by the card, that they are
 * signed in to the site in the window's browser, on the manifest as it
 * stands. Whether that session still holds shows only when a page loads.
 */
async function testWebApp({
  app,
  checks,
}: {
  app: AppInfo & { manifest: WebAppManifest };
  checks: AppTestCheck[];
}): Promise<AppTestReport> {
  const { manifest, manifestHash, name, slug } = app;
  const guide = await readAppGuide(app.dir);
  checks.push({
    detail:
      guide === null
        ? "No guide; a web app is worked on its own pages."
        : "The guide is written.",
    name: "guide",
    status: "pass",
  });
  const connection = await readConnection(slug);
  const recorded = isConnected(connection, manifestHash);
  checks.push(
    recorded
      ? {
          detail: `The user said they are signed in to ${name} in ${APP_NAME}'s browser.`,
          name: "credential",
          status: "pass",
        }
      : {
          name: "credential",
          ...failure(
            connection?.status === "connected"
              ? `The manifest changed since the user said they were signed in, so the sign-in may be for another site. Ask them again with connect_app.`
              : `The user has not said they are signed in to ${name}. Ask them with connect_app: the card opens ${manifest.signIn ?? manifest.url} in ${APP_NAME}'s browser, and the app connects when they say they are signed in.`,
          ),
        },
  );
  const findings = await scanAppFolder({ credential: null, dir: app.dir });
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
  checks.push({
    detail: `This test cannot check the session itself: whether the user is still signed in shows only when a page of the site loads. Work it in the browser: open ${manifest.url} in a tab, where the sign-in holds, or use a tab already open there. \`${APP_COMMAND.name} call\` and \`${APP_COMMAND.name} request\` do not reach a web app.`,
    name: "canary",
    status: "skip",
  });
  return {
    checks,
    passed: checks.every((check) => check.status !== "fail"),
    slug,
  };
}

function failure(detail: string) {
  return { detail, status: "fail" as const };
}
