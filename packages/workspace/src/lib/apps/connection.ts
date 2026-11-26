import {
  WEB_APP_NOT_SIGNED_IN,
  WEB_APP_UNMARKED,
} from "../../model-text/commands/app-command";
import { TOOL_NAMES } from "../../tools/name";
import { APP_NAME } from "@instrument-org/shared";
import { z } from "zod";

import { getWorkspaceConfig } from "../workspace-config";
import { appChanged } from "./changed";
import { type AppManifest, type AppSlug } from "./manifest";
import { listApps, loadApp, publishSignIn, setAppAccount } from "./store";

/**
 * Where an app stands on this computer. `connected` is the only state a call
 * goes through; the others say what is missing,
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
 * take), or nobody came back before it lapsed, which leaves the app needing
 * its sign-in rather than failed. `canceled` is only in a record an earlier
 * build wrote: a sign-in the user stops now leaves no trace. A user who turned
 * the sign-in down is `declined`, not this.
 */
const SignInEndSchema = z.enum(["canceled", "expired", "refused"]);

export type SignInEnd = z.output<typeof SignInEndSchema>;

/** Where a sign-in's page was opened: the window's own browser, or the user's. */
const SignInOpensInSchema = z.enum(["app", "external"]);

export type SignInOpensIn = z.output<typeof SignInOpensInSchema>;

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
  /** Whether the last test failed because the service refused the stored key. */
  keyRefused: z.boolean().optional(),
  /**
   * Where the app's own sign-in last went through. Absent for one that went
   * through before this was recorded.
   */
  signedInFrom: SignInOpensInSchema.optional(),
  /**
   * The manifest that passed. A manifest edited since is not the one that was
   * tested, and a call refuses until it is tested again: this is what keeps
   * enablement out of the agent's hands while the manifest stays in them.
   */
  manifestHash: z.string().optional(),
  /**
   * For a web app, that the agent saw its site load signed in on this
   * computer and recorded it, where the user never pressed Done on a card.
   */
  seenSignedIn: z.literal(true).optional(),
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

/**
 * A line for a listing: the status in words, with the account when known and,
 * for an app with a sign-in of its own (`direct`), where that went through.
 * Without `nextSteps` it says only where the app stands, for the context every
 * chat starts with: a step there is one more thing to do in a chat about
 * something else.
 */
export function describeConnection(
  connection: AppConnection | undefined,
  manifestHash: string,
  {
    direct = false,
    nextSteps = true,
    role = "chat",
    web = false,
  }: {
    direct?: boolean;
    nextSteps?: boolean;
    role?: "chat" | "task";
    web?: boolean;
  } = {},
): string {
  // What to run next, for the chat alone: a task neither tests nor connects.
  const next = (step: string) =>
    nextSteps && role === "chat" ? ` (${step})` : "";
  // A web app's sign-in may already be there, unsaid: the site says.
  if (web && (!connection || connection.status === "needs-sign-in")) {
    return nextSteps && role === "chat"
      ? WEB_APP_NOT_SIGNED_IN
      : WEB_APP_UNMARKED;
  }
  if (!connection) {
    return `not connected${next("run `instrument app test`")}`;
  }
  switch (connection.status) {
    case "connected": {
      const who = connection.account ? ` as ${connection.account}` : "";
      const tools =
        connection.toolCount === undefined
          ? ""
          : `, ${connection.toolCount} tools`;
      return connection.manifestHash === manifestHash
        ? `connected${who}${direct ? signedInWords(connection.signedInFrom) : ""}${tools}`
        : `connected, but the manifest changed since it was tested${next("run `instrument app test`")}`;
    }
    case "declined": {
      return "declined by the user; ask again only if they bring it up";
    }
    case "failed": {
      return `failed${connection.error ? `: ${connection.error}` : ""}`;
    }
    case "needs-approval": {
      return `needs the user to allow its server to run on this machine${next(TOOL_NAMES.connectApp)}`;
    }
    case "needs-key": {
      return `needs a key from the user${next(TOOL_NAMES.connectApp)}`;
    }
    case "needs-sign-in": {
      return `needs the user to sign in${next(TOOL_NAMES.connectApp)}`;
    }
  }
}

function signedInWords(from: SignInOpensIn | undefined): string {
  switch (from) {
    case "app": {
      return `, signed in from ${APP_NAME}'s browser`;
    }
    case "external": {
      return ", signed in from the user's own browser";
    }
    case undefined: {
      return "";
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
  slug: AppSlug,
  account: string | undefined,
): Promise<AppManifest> {
  const before = await loadApp(slug);
  const manifest = await setAppAccount(slug, account);
  const after = await loadApp(slug);
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
      : { error: patch.error, manifestHash: undefined, seenSignedIn: undefined }),
    ended: patch.ended,
    keyRefused: patch.keyRefused,
    status: patch.status,
    updatedAt: Date.now(),
  };
  await apps.connections.set(slug, next);
  await publishStanding(slug, next);
  await appChanged(slug);
  return next;
}

/**
 * Writes where every app in the store stands on this computer, for the other
 * computers to read: at launch, since a record written by a build before
 * this one was never published.
 */
export async function publishAppSignIns(): Promise<void> {
  const connections = await getWorkspaceConfig().apps.connections.list();
  const { apps } = await listApps();
  for (const app of apps) {
    const connection = connections[app.slug];
    if (connection !== undefined) {
      await publishStanding(app.slug, connection);
    }
  }
}

function publishStanding(
  slug: string,
  connection: AppConnection,
): Promise<void> {
  return publishSignIn(getWorkspaceConfig().deviceId, slug, {
    ...(connection.account === undefined ? {} : { account: connection.account }),
    ...(connection.manifestHash === undefined
      ? {}
      : { manifestHash: connection.manifestHash }),
    status: connection.status,
    updatedAt: connection.updatedAt,
  });
}
