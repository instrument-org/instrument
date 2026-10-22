import { z } from "zod";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type AbsolutePath } from "../../schemas/paths";
import { getWorkspaceConfig } from "../workspace-config";
import { appChanged } from "./changed";
import { type AppManifest, type AppSlug } from "./manifest";
import { loadApp, setAppAccount } from "./store";

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

/**
 * How a sign-in that started ended without connecting: the service refused
 * the account (a vendor policy, an admin's consent, a client it will not
 * take), the user stopped it, or nobody came back before it lapsed. A user who
 * turned the sign-in down is `declined`, not this.
 */
export const SignInEndSchema = z.enum(["canceled", "expired", "refused"]);

export type SignInEnd = z.output<typeof SignInEndSchema>;

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
  /** For a failed sign-in, how it ended, when that was more than an error. */
  ended: SignInEndSchema.optional(),
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
  /**
   * The chats that asked the user to connect the app and are still waiting on
   * the answer. The answer (a sign-in finished in the browser, a key saved,
   * a decline) can come from any chat's card or the app's own page, none of
   * which is the chat, so the asks are kept with the app and every chat in
   * them is woken from here. Gone once the answer has reached them.
   */
  waitingChats: z.array(ChatIdSchema).optional(),
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
    return "not connected (run `instrument app test`)";
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
        : "connected, but the manifest changed since it was tested (run `instrument app test`)";
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

/**
 * Names the account an app is signed in as, or clears the name
 * (`setAppAccount`). Naming one can move a web app to the directory's
 * address for that account, which changes the manifest's hash, so a
 * connection pinned to the manifest before the move is pinned to it after:
 * the directory chose the address, not the agent.
 */
export async function nameAppAccount(
  appsDir: AbsolutePath,
  slug: AppSlug,
  account: string | undefined,
): Promise<AppManifest> {
  const before = await loadApp(appsDir, slug);
  const manifest = await setAppAccount(appsDir, slug, account);
  const after = await loadApp(appsDir, slug);
  if (before.isErr() || after.isErr()) {
    return manifest;
  }
  const moved = after.value.manifestHash !== before.value.manifestHash;
  if (
    moved &&
    isConnected(await readConnection(slug), before.value.manifestHash)
  ) {
    await recordConnection(slug, {
      manifestHash: after.value.manifestHash,
      status: "connected",
    });
  }
  return manifest;
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
    ended: patch.ended,
    status: patch.status,
    updatedAt: Date.now(),
  };
  await apps.connections.set(slug, next);
  await appChanged(slug);
  return next;
}
