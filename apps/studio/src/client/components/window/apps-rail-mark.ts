import { keptAtom } from "@/client/lib/kept-state";

/**
 * When this computer last showed the Apps place. An app signed out since
 * then is news, and the rail's Apps wears a dot for it until Apps is
 * opened once; an app that stays signed out after that is not news again.
 */
export const appsSeenAtAtom = keptAtom("layout", "apps-seen-at.v1", 0);

/**
 * Whether any app lost its sign-in since the Apps place was last shown: it
 * needs a sign-in now, it had one once (`connectedAt`), and the record moved
 * after `seenAt`. An app that was never connected, or one the person
 * declined, is not a sign-out.
 */
export function appsSignedOutSince(
  apps: readonly {
    connection?: {
      connectedAt?: number;
      status: string;
      updatedAt: number;
    };
  }[],
  seenAt: number,
): boolean {
  return apps.some(
    ({ connection }) =>
      connection?.status === "needs-sign-in" &&
      connection.connectedAt !== undefined &&
      connection.updatedAt > seenAt,
  );
}
