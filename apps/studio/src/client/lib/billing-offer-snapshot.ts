import snapshot from "@/shared/billing-offer-snapshot.json";

/**
 * What the offer's query starts from: the server's answer when this build was
 * made (`scripts/pull-billing-offer.ts`), so the offer is there at first paint
 * and while the server can't be reached. It's dated the epoch, so it counts as
 * stale and the server is asked right away. The answer changes nothing when it
 * says the same, since the query library keeps the object it has when the new
 * one is deep-equal.
 */
export const OFFER_SNAPSHOT_OPTIONS = {
  initialData: snapshot,
  initialDataUpdatedAt: 0,
};
