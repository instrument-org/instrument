import { type AbsolutePath } from "../../schemas/paths";
import { getWorkspaceConfig } from "../workspace-config";
import { performSignedInRequest, SignInNeededError } from "./api-oauth";
import { isConnected, readConnection, recordConnection } from "./connection";
import { type AppManifest } from "./manifest";
import { listMcpTools } from "./mcp/client";
import { withAppMcpClient } from "./mcp/run";
import { mcpAuthProviderForCommand, SignInAgainError } from "./mcp/tool-auth";
import { signsInDirectly } from "./site";
import { listApps } from "./store";

/** What the record says when a service refused the sign-in it held. */
const SIGN_IN_LOST = "The service no longer accepts the sign-in.";

/**
 * How long one app's check may take. A service that does not answer in
 * this time is left as it stands: silence is no evidence against a sign-in.
 */
const CHECK_TIMEOUT_MS = 20_000;

/**
 * Whether a failure of a call to an app that signs in directly means the
 * sign-in is gone: the refresh was refused or there is no token (`SignInNeededError`
 * for an API app, `SignInAgainError` for an MCP app), or the server answered
 * unauthorized after the SDK's own refresh. A network failure, a timeout or a
 * refused argument says nothing about the sign-in.
 */
export function signInLost(
  manifest: AppManifest,
  failure: { cause?: unknown; reason?: string },
): boolean {
  if (!signsInDirectly(manifest)) {
    return false;
  }
  return (
    failure.cause instanceof SignInAgainError ||
    failure.cause instanceof SignInNeededError ||
    failure.reason === "unauthorized"
  );
}

/**
 * Writes down that an app's sign-in is gone, so Apps, the rail and the next
 * chat read it without anyone running a test. Only a connected app moves: a
 * record already waiting on something keeps what it waits on, and the
 * `connectedAt` the record keeps is how a reader tells a sign-in that was
 * lost from one that was never made.
 */
export async function noteSignInLost(slug: string): Promise<void> {
  const connection = await readConnection(slug);
  if (connection?.status !== "connected") {
    return;
  }
  await recordConnection(slug, {
    error: SIGN_IN_LOST,
    status: "needs-sign-in",
  });
}

/**
 * Writes the sign-in down as gone when `failure` says it is, and nothing
 * otherwise, for a call's failure path to run before it tells the agent.
 */
export async function noteIfSignInLost(
  slug: string,
  manifest: AppManifest,
  failure: { cause?: unknown; reason?: string },
): Promise<void> {
  if (signInLost(manifest, failure)) {
    await noteSignInLost(slug);
  }
}

/**
 * Asks each connected app that signs in directly whether its sign-in still
 * holds, one at a time, and writes down the ones that do not. An MCP app
 * lists its tools and an API app runs its test request, the same calls
 * `app test` makes, but only a refused sign-in changes the record: an app
 * that is unreachable, slow or broken in some other way is left for the
 * test to judge, so a launch with no network marks nothing. Web apps are
 * the person's word and local servers would have to be started, so neither
 * is asked.
 */
export async function checkAppSignIns({
  appsDir,
  signal,
}: {
  appsDir: AbsolutePath;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { apps } = await listApps(appsDir);
  const connections = await getWorkspaceConfig().apps.connections.list();
  const lost: string[] = [];
  for (const app of apps) {
    if (signal?.aborted) {
      break;
    }
    const { manifest, manifestHash, slug } = app;
    if (
      !signsInDirectly(manifest) ||
      !isConnected(connections[slug], manifestHash)
    ) {
      continue;
    }
    const deadline = AbortSignal.timeout(CHECK_TIMEOUT_MS);
    const checkSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    if (
      await signInStillHolds({
        manifest,
        manifestHash,
        signal: checkSignal,
        slug,
      })
    ) {
      continue;
    }
    await noteSignInLost(slug);
    lost.push(slug);
  }
  return lost;
}

/** Whether one app's sign-in is still taken, or might be: false only on a clear refusal. */
async function signInStillHolds({
  manifest,
  manifestHash,
  signal,
  slug,
}: {
  manifest: AppManifest;
  manifestHash: string;
  signal: AbortSignal;
  slug: string;
}): Promise<boolean> {
  if (manifest.type === "mcp") {
    if (mcpAuthProviderForCommand(slug, manifest) === undefined) {
      return true;
    }
    const result = await withAppMcpClient({
      credential: null,
      manifest,
      manifestHash,
      run: (client) => listMcpTools(client),
      signal,
      slug,
    });
    return result.isOk() || !signInLost(manifest, result.error);
  }
  if (manifest.type !== "api") {
    return true;
  }
  try {
    const { result } = await performSignedInRequest({
      body: manifest.test.body,
      manifest,
      method: manifest.test.method ?? "GET",
      params: {},
      path: manifest.test.path,
      signal,
      slug,
    });
    // A 401 after the refresh is the service refusing the sign-in it was
    // just handed; any other answer, or no answer, leaves it standing.
    return result.isErr() || result.value.status !== 401;
  } catch (error) {
    return !(error instanceof SignInNeededError);
  }
}
