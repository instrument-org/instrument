import {
  type AppConnection,
  type AppEvent,
  appChanged,
  recordConnection,
  type SignInEnd,
} from "@instrument-org/workspace/electron";
import { z } from "zod";

/** Where an app stands, as the Apps screen draws it. */
export const AppStandingSchema = z.enum([
  "connected",
  "declined",
  "failed",
  "needs-approval",
  "needs-key",
  "needs-sign-in",
  // A manifest the agent edited since the connection passed.
  "stale",
  "untested",
]);

type AppStanding = z.output<typeof AppStandingSchema>;

/**
 * Where an app stands, from its connection record and the manifest as it is
 * now: a connection that passed on another manifest is stale.
 */
export function standingOf(
  connection: AppConnection | undefined,
  manifestHash: string,
): AppStanding {
  if (connection === undefined) {
    return "untested";
  }
  if (connection.status !== "connected") {
    return connection.status;
  }
  return connection.manifestHash === manifestHash ? "connected" : "stale";
}

/** Where a connection moved, with what the record keeps about the move. */
export type ConnectionOutcome =
  /** The user signed in on a web app's own site, on the manifest as it stands. */
  | { manifestHash: string; status: "connected" }
  /** "Not now", on the card or the provider's page. */
  | { status: "declined" }
  /** A sign-in that could not start or finish, and how it ended when that was more than an error. */
  | { ended?: SignInEnd; error: string; status: "failed" }
  /** The user allowed a local server to run, pinned to the manifest they saw. */
  | { approvedManifestHash: string; status: "needs-approval" }
  /** The server refused the key or sign-in the app holds, or the key is gone. */
  | { error: string; status: "needs-key" | "needs-sign-in" };

/**
 * Record where an app's connection moved and say so, as one step: every list
 * of apps reads again, and the chat hears what the user did when it was the
 * user's doing (connected, declined, or a sign-in that failed). A key or
 * sign-in the server refused is no news to the chat until someone writes.
 */
export async function settleConnection(
  slug: string,
  outcome: ConnectionOutcome,
): Promise<void> {
  switch (outcome.status) {
    case "connected": {
      await recordConnection(slug, {
        connectedAt: Date.now(),
        error: undefined,
        manifestHash: outcome.manifestHash,
        status: "connected",
      });
      break;
    }
    case "declined": {
      await recordConnection(slug, { status: "declined" });
      break;
    }
    default: {
      await recordConnection(slug, outcome);
    }
  }
  const happened = eventOf(outcome);
  if (happened) {
    await appChanged(slug, happened);
  }
}

function eventOf(
  outcome: ConnectionOutcome,
): undefined | { detail?: string; ended?: SignInEnd; event: AppEvent } {
  switch (outcome.status) {
    case "connected":
    case "declined": {
      return { event: outcome.status };
    }
    case "failed": {
      return {
        detail: outcome.error,
        ...(outcome.ended === undefined ? {} : { ended: outcome.ended }),
        event: "failed",
      };
    }
    case "needs-approval":
    case "needs-key":
    case "needs-sign-in": {
      return undefined;
    }
  }
}
