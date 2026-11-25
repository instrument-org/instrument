import { TOOL_NAMES } from "../../tools/name";
import { APP_NAME } from "@instrument-org/shared";

import { APP_COMMAND } from "../../model-text/commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import { isConnected, readConnection, recordConnection } from "./connection";
import {
  credentialMovedMessage,
  hasNoKeyStored,
  lookupAppKeys,
  redactorFor,
} from "./credential-origin";
import {
  APP_MANIFEST_EXAMPLE,
  isMcpManifest,
  type WebAppManifest,
} from "./manifest";
import { clientRefused, listMcpTools } from "./mcp/client";
import { withAppMcpClient } from "./mcp/run";
import { mcpAuthProviderForCommand } from "./mcp/tool-auth";
import { bearerKey, type GivenKey, type PlacedKey } from "./keys";
import { credentialOrigin } from "./origin-bound";
import { performSignedInRequest, SignInNeededError } from "./api-oauth";
import { webInsteadUrl } from "./site";
import { webInsteadCommand } from "./web-instead";
import { performAppRequest, redactKeys } from "./request";
import { scanAppRecord } from "./secret-scan";
import {
  type AppInfo,
  guidePlaceholdersLeft,
  loadApp,
  readAppGuide,
  readAppSetup,
} from "./store";
import { SITE_SIGN_IN_WORDS } from "../screen-words";

export interface AppTestReport {
  checks: AppTestCheck[];
  /** Whether it failed because the service refused the keys. */
  keyRefused?: boolean;
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
 * The red/green loop for an app: validate the manifest, require a guide,
 * confirm a credential is present when the auth mode needs one, scan the
 * setup and guide for leaked secrets, and reach the service for real (an MCP app
 * connects and lists its tools; an API app hits its canary path). A pass
 * records the connection, pinned to this manifest; a failure records why, so
 * the card and the page can say.
 *
 * The only way an app becomes connected apart from finishing a sign-in (for
 * a web app, the user saying on the card that they are signed in), and it
 * runs outside every mount, so the agent iterates on the app and this
 * decides.
 */
export async function runAppTest({
  signal,
  slug,
  trying,
}: {
  signal: AbortSignal;
  slug: string;
  /**
   * Keys to test in place of the stored ones, on a connected app: one that
   * fails leaves the connection as it stands, since the stored keys are the
   * ones it still has.
   */
  trying?: GivenKey[];
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

  const loaded = await loadApp(slug);
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
    detail: `The setup parses: a ${app.manifest.type} app named "${app.name}".`,
    name: "manifest",
    status: "pass",
  });

  if (app.manifest.type === "web") {
    return finishWeb(
      await testWebApp({ app: { ...app, manifest: app.manifest }, checks }),
    );
  }

  const guide = await readAppGuide(app.slug);
  // A guide still carrying the skeleton's prompts is worse than none: it
  // passes as "present", and then the first request in a task is answered with
  // the blank form instead of the endpoint it asked about. The prompts left in
  // it are the questions about this service nobody wrote down. Only an API
  // app's guide is handed to a request; an MCP app's tools describe
  // themselves.
  const unanswered =
    guide === null ? [] : guidePlaceholdersLeft(app.manifest, guide);
  const write = `Write it with \`${APP_COMMAND.name} guide ${slug} <<'EOF'\`, the whole guide on stdin.`;
  checks.push(
    app.manifest.type === "api"
      ? guide === null
        ? {
            name: "guide",
            ...failure(
              `The guide is missing. An API app needs one before connecting: what the service is for, the endpoints a request needs, and its conventions. ${write}`,
            ),
          }
        : unanswered.length > 0
          ? {
              name: "guide",
              ...failure(
                `The guide still has prompts \`${APP_COMMAND.name} new\` left: ${unanswered.length} unanswered. Answer them from what you know about the service before connecting, since the guide is what the first request in a task is handed instead of its answer. ${write} Still there: ${unanswered.map((prompt) => `"${prompt}"`).join(" ")}`,
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
  const lookup = await lookupAppKeys(slug, app.manifest, { trying });
  const keys = lookup.kind === "ok" ? lookup.keys : [];
  let missing: "approval" | "key" | "sign-in" | undefined;
  let keyRefused = false;
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
  } else if (app.manifest.type === "mcp-local" && lookup.kind === "missing") {
    missing = "key";
    const { auth } = app.manifest;
    const reads = auth.kind === "env" ? [auth] : auth.keys;
    checks.push({
      name: "credential",
      ...failure(
        `This app ${hasNoKeyStored(lookup.labels)}; its server reads ${reads.map(({ envVar }) => envVar).join(" and ")}. Ask the user for one with ${TOOL_NAMES.connectApp}, then test again.`,
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
          `No sign-in is stored for this app. Ask the user to sign in with ${TOOL_NAMES.connectApp}; the app connects on its own when they do.`,
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
  } else if (lookup.kind === "missing") {
    missing = "key";
    checks.push({
      name: "credential",
      ...failure(
        `This app ${hasNoKeyStored(lookup.labels)}. Ask the user for one with ${TOOL_NAMES.connectApp}, then test again.`,
      ),
    });
  } else {
    checks.push({
      detail:
        keys.length > 1
          ? `${keys.length} keys are stored for this app.`
          : "A key is stored for this app.",
      name: "credential",
      status: "pass",
    });
  }

  // A failure's text reaches the agent, and a local server's stderr or a
  // service's answer can repeat the key it was handed.
  const redact = await redactorFor(slug, app.manifest, keys);

  const findings = scanAppRecord({
    guide: guide ?? "",
    keys: keys.map(({ value }) => value),
    setup: (await readAppSetup(app.slug)) ?? {},
  });
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
          detail: "No secret-shaped strings in the app's setup or guide.",
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
      keys,
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
      } else if (keys.length > 0 && mcpResult.error.reason === "unauthorized") {
        keyRefused = true;
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
              ? ` The server refuses ${APP_NAME}'s sign-in client, so signing in again meets the same refusal. Sign in on the web instead: \`${webInsteadCommand(slug, webInsteadUrl(slug, manifest))}\`, then ${TOOL_NAMES.connectApp}.`
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
  let sent: PlacedKey[] = keys;
  let canary: Awaited<ReturnType<typeof performAppRequest>>;
  if (signedIn) {
    try {
      const signed = await performSignedInRequest({ ...canaryRequest, slug });
      canary = signed.result;
      sent = [bearerKey(signed.token)];
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
    canary = await performAppRequest({ ...canaryRequest, keys });
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
    keyRefused = keys.length > 0 && rejected;
    checks.push({
      name: "canary",
      ...failure(
        `${canaryMethod} ${manifest.test.path} returned ${canary.value.status}. ${
          signedIn && canary.value.status === 401
            ? `The sign-in was refused even after a refresh. Ask the user to sign in again with ${TOOL_NAMES.connectApp}; if that sign-in fails or is refused, sign in on the web instead: \`${webInsteadCommand(slug, webInsteadUrl(slug, manifest))}\`, then ${TOOL_NAMES.connectApp}.`
            : signedIn && rejected
              ? `The API knows the signed-in account and refuses it this request: the account, or what the sign-in asked for, lacks a permission it needs.`
              : rejected
                ? // A key the service would accept is refused exactly like a wrong
                  // one when it rides in the wrong place, and the placement is the
                  // thing the agent chose and can change. Naming only the key sends
                  // it back to the card for a key that was right all along.
                  keys.length > 1
                  ? `The keys were refused, and the service does not say which. Check each one's placement against the service's documentation first, and change one with \`${APP_COMMAND.name} setup ${slug}\`, keeping its label: \`${APP_COMMAND.name} test ${slug}\` then reuses the stored keys and does not ask the user. Only once the placements are right are the keys in question: ask for them again with ${TOOL_NAMES.connectApp}, saying what was wrong.`
                  : `The key was refused. That is as often the wrong placement as the wrong key: a service that documents Basic credentials, an \`X-Api-Key\`, or an \`api_key\` query parameter refuses a bearer token just like this. Try the placements the manifest can take (bearer, basic, basic:<user>, header:<Name>, query:<param>) with \`${APP_COMMAND.name} new ${slug} ... --force\`, then \`${APP_COMMAND.name} test ${slug}\`, which reuses the stored key and does not ask the user. Only once every one is refused is the key itself in question: ask for it again with ${TOOL_NAMES.connectApp}, saying what was wrong.`
                : `Expected a 2xx response; fix the test path or the manifest. Some APIs require static headers on every request (an API-version header, say): set them in the manifest's "headers".`
        } Response body: ${redactKeys(redact(canary.value.bodyText), sent).slice(0, 400)}`,
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

  async function finish(tested: AppTestReport, toolCount?: number) {
    const result = { ...tested, ...(keyRefused && { keyRefused }) };
    if (trying && !result.passed) {
      return result;
    }
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
      ...(keyRefused && { keyRefused }),
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
  const guide = await readAppGuide(app.slug);
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
              ? `The manifest changed since the user said they were signed in, so the sign-in may be for another site. Ask them again with ${TOOL_NAMES.connectApp}.`
              : `The user has not said they are signed in to ${name}. Open ${manifest.signIn ?? manifest.url} in a tab first: if it loads signed in, call ${TOOL_NAMES.connectApp} and tell them they are already signed in, so they only press ${SITE_SIGN_IN_WORDS.signIn} on the card, then ${SITE_SIGN_IN_WORDS.done} on the page it opens; otherwise ask them with ${TOOL_NAMES.connectApp}, whose card opens that page in ${APP_NAME}'s browser.`,
          ),
        },
  );
  const findings = scanAppRecord({
    keys: [],
    guide: guide ?? "",
    setup: (await readAppSetup(app.slug)) ?? {},
  });
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
          detail: "No secret-shaped strings in the app's setup or guide.",
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
