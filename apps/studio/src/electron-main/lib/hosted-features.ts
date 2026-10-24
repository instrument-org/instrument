import { type PlatformRefusal } from "@instrument-org/ai-gateway";

import { type FeatureAvailability } from "../platform-api/contract";
import { getToken } from "../platform-api/utils";

type HostedFeature = "decisions" | "dictation" | "images" | "models" | "search";

type Features = Partial<Record<HostedFeature, FeatureAvailability>> & {
  search?: { forEveryModel?: boolean };
};

/** The least time between the status reads a refusal asks for. */
const REFUSAL_READ_GAP_MS = 30_000;

let last: { features: Features; token: null | string | undefined } | undefined;
let lastRefusalRead = 0;
let readStatus: (() => Promise<unknown>) | undefined;

/**
 * What the platform last said would run, from the last billing status
 * read. Kept per sign-in, so another account's answer never stands in.
 */
export function recordHostedFeatures(features: Features | undefined) {
  last = { features: features ?? {}, token: getToken() };
}

/**
 * How to read the billing status again, for a refusal to refresh what is
 * known; the status route records what it reads.
 */
export function setHostedFeaturesReader(read: () => Promise<unknown>) {
  readStatus = read;
}

/**
 * Whether the platform would serve `feature` now, as it last said: false
 * while it is refused, until a usage window it named comes back. Undefined
 * before anything has been heard for this sign-in.
 */
export function isHostedFeatureAvailable(
  feature: HostedFeature,
  now = Date.now(),
) {
  if (!last || last.token !== getToken()) {
    return undefined;
  }
  const availability = last.features[feature];
  if (!availability) {
    return undefined;
  }
  if (availability.available) {
    return true;
  }
  const resetsAt = availability.resetsAt
    ? Date.parse(availability.resetsAt)
    : Number.NaN;
  return availability.code === "usage-limit-exceeded" && resetsAt <= now;
}

/**
 * Whether a search from a model on the person's own provider should go
 * through the platform's search: signed in, the platform's switch for it on,
 * and search available, as the last status read for this sign-in said.
 * False whenever any of that is unknown, so a missing or stale read leaves
 * the provider's search in place.
 */
export function isPlatformSearchForEveryModel(now = Date.now()) {
  return (
    Boolean(getToken()) &&
    last?.features.search?.forEveryModel === true &&
    isHostedFeatureAvailable("search", now) === true
  );
}

/**
 * A hosted request the platform turned away for the account's plan is news
 * about what runs, so the status is read again, at most every 30 seconds.
 */
export function noteHostedRefusal(refusal: PlatformRefusal, now = Date.now()) {
  if (
    refusal.code !== "subscription-required" &&
    refusal.code !== "usage-limit-exceeded"
  ) {
    return;
  }
  if (!readStatus || now - lastRefusalRead < REFUSAL_READ_GAP_MS) {
    return;
  }
  lastRefusalRead = now;
  readStatus().catch(() => undefined);
}
