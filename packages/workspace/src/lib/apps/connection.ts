import { z } from "zod";

import { getWorkspaceConfig } from "../workspace-config";
import { type AppManifest } from "./manifest";

/**
 * Where an app stands, as the app (never the agent) records it. `connected`
 * is the only state a call goes through; the other three say what is missing,
 * and the card in the conversation and the Apps screen draw them.
 */
const AppConnectionStatusSchema = z.enum([
  "connected",
  "declined",
  "failed",
  "needs-approval",
  "needs-key",
  "needs-sign-in",
]);

export type AppConnectionStatus = z.output<typeof AppConnectionStatusSchema>;

export const AppConnectionSchema = z.object({
  /** Whom the service says the connection belongs to, when it tells us. */
  account: z.string().optional(),
  /**
   * The manifest the user allowed to run on this machine, for a local app.
   * Approval is of a package and its arguments, so a manifest edited after it
   * was given is not what was agreed to, and the app asks again.
   */
  approvedManifestHash: z.string().optional(),
  connectedAt: z.number().optional(),
  /**
   * The origin the stored key or sign-in was given for, recorded when the user
   * hands it over. The manifest is the agent's to rewrite, so a credential
   * only ever goes where the user gave it; an app whose address moved needs a
   * new key or sign-in, and the card asking for it names the new host.
   */
  credentialOrigin: z.string().optional(),
  /** Why the last test failed, for the card and the page. */
  error: z.string().optional(),
  /**
   * The manifest that passed. A manifest edited since is not the one that was
   * tested, and a call refuses until it is tested again: this is what keeps
   * enablement out of the agent's hands while the manifest stays in them.
   */
  manifestHash: z.string().optional(),
  status: AppConnectionStatusSchema,
  toolCount: z.number().optional(),
  updatedAt: z.number(),
});

export type AppConnection = z.output<typeof AppConnectionSchema>;

/** The host app's record of every connection, keyed by slug, outside every mount. */
export interface AppConnectionStore {
  get: (slug: string) => Promise<AppConnection | undefined>;
  list: () => Promise<Record<string, AppConnection>>;
  remove: (slug: string) => Promise<void>;
  set: (slug: string, connection: AppConnection) => Promise<void>;
}

/** A line for a listing: the status in words, with the account when known. */
export function describeConnection(
  connection: AppConnection | undefined,
  manifestHash: string,
): string {
  if (!connection) {
    return "not connected (run `app test`)";
  }
  switch (connection.status) {
    case "connected": {
      const who = connection.account ? ` as ${connection.account}` : "";
      const tools =
        connection.toolCount === undefined
          ? ""
          : `, ${connection.toolCount} tools`;
      return connection.manifestHash === manifestHash
        ? `connected${who}${tools}`
        : "connected, but the manifest changed since it was tested (run `app test`)";
    }
    case "declined": {
      return "declined by the user; ask again only if they bring it up";
    }
    case "failed": {
      return `failed${connection.error ? `: ${connection.error}` : ""}`;
    }
    case "needs-approval": {
      return "needs the user to allow its server to run on this machine (connect_app)";
    }
    case "needs-key": {
      return "needs a key from the user (connect_app)";
    }
    case "needs-sign-in": {
      return "needs the user to sign in (connect_app)";
    }
  }
}

/**
 * Where an app's credential is sent: its API base or MCP server. A local
 * server takes its key in the environment of a process the user approved.
 */
export function credentialOriginOf(manifest: AppManifest): string | undefined {
  if (manifest.type === "mcp-local") {
    return undefined;
  }
  return new URL(manifest.type === "api" ? manifest.baseUrl : manifest.url)
    .origin;
}

/**
 * Whether the stored credential may go where the manifest now points: the
 * origin it was given for. A record kept before origins were adopts the
 * current one only while it is connected on this very manifest, which the
 * user's credential has already been sent to; anything else asks again.
 */
export async function credentialMayReach({
  manifest,
  manifestHash,
  slug,
}: {
  manifest: AppManifest;
  manifestHash: string;
  slug: string;
}): Promise<boolean> {
  const origin = credentialOriginOf(manifest);
  if (origin === undefined) {
    return true;
  }
  const connection = await readConnection(slug);
  if (connection?.credentialOrigin !== undefined) {
    return connection.credentialOrigin === origin;
  }
  if (
    connection?.status === "connected" &&
    connection.manifestHash === manifestHash
  ) {
    await recordConnection(slug, {
      credentialOrigin: origin,
      status: "connected",
    });
    return true;
  }
  return false;
}

/** Why a stored credential was held back from where the manifest points. */
export async function movedCredentialMessage({
  manifest,
  slug,
}: {
  manifest: AppManifest;
  slug: string;
}): Promise<string> {
  const origin = credentialOriginOf(manifest) ?? "";
  const given = (await readConnection(slug))?.credentialOrigin;
  const what = manifest.auth.kind === "oauth" ? "sign-in" : "key";
  return `The stored ${what} for "${slug}" was given for ${given === undefined ? "another address" : new URL(given).host}, and the manifest now points at ${new URL(origin).host}, so it was not sent. Ask the user with connect_app; the card shows them the new address.`;
}

/** Whether a call may go through: connected, on the manifest that was tested. */
export function isConnected(
  connection: AppConnection | undefined,
  manifestHash: string,
): boolean {
  return (
    connection?.status === "connected" &&
    connection.manifestHash === manifestHash
  );
}

export async function readConnection(
  slug: string,
): Promise<AppConnection | undefined> {
  return getWorkspaceConfig().apps.connections.get(slug);
}

/**
 * Write a connection's standing, keeping what the patch does not name (the
 * account a sign-in learned survives a later failed test), and tell the host
 * app so every list of apps re-reads.
 */
export async function recordConnection(
  slug: string,
  patch: Partial<Omit<AppConnection, "updatedAt">> & {
    status: AppConnectionStatus;
  },
): Promise<AppConnection> {
  const { apps } = getWorkspaceConfig();
  const current = await apps.connections.get(slug);
  const next: AppConnection = {
    ...current,
    ...patch,
    // A record that is no longer connected drops the hash: a later connected
    // record has to earn it again.
    ...(patch.status === "connected"
      ? {}
      : { error: patch.error, manifestHash: undefined }),
    status: patch.status,
    updatedAt: Date.now(),
  };
  await apps.connections.set(slug, next);
  apps.notifyChanged?.();
  return next;
}
