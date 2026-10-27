import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import ms from "ms";
import path from "node:path";

import { readJsonRecord, updateJsonRecord } from "./json-record-file";
import { getWorkspaceConfig } from "./workspace-config";

/** The least time between two offers, across every chat of the workspace on this computer. */
export const FEEDBACK_OFFER_GAP_MS = ms("3 days");

/** Why no card was shown for an offer. */
export type FeedbackOfferRefusal = "off" | "recent";

function offersFile() {
  return path.join(
    getWorkspaceConfig().workspaceMachineDir,
    WORKSPACE_MACHINE_ENTRIES.feedbackOffers,
  );
}

/** When the agent last offered, or undefined when it never has or the file can't be read. */
export async function lastFeedbackOffer(): Promise<Date | undefined> {
  const read = await readJsonRecord(offersFile());
  if (read.kind !== "read") {
    return undefined;
  }
  const at = read.record.lastOfferedAt;
  const date = typeof at === "string" ? new Date(at) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

export async function recordFeedbackOffer(at: Date): Promise<void> {
  await updateJsonRecord(offersFile(), () => ({
    lastOfferedAt: at.toISOString(),
  }));
}

/** Why an offer made `now` would show no card, or undefined when it may. */
export function feedbackOfferRefusal({
  last,
  mayOffer,
  now,
}: {
  last: Date | undefined;
  mayOffer: boolean;
  now: Date;
}): FeedbackOfferRefusal | undefined {
  if (!mayOffer) {
    return "off";
  }
  if (last && now.getTime() - last.getTime() < FEEDBACK_OFFER_GAP_MS) {
    return "recent";
  }
  return undefined;
}
