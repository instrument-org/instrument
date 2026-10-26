import { type ProgressInfo, type UpdateInfo } from "electron-updater";
import ms from "ms";
import semver from "semver";

export type AppUpdaterStatus =
  | AppUpdaterStatusChecking
  | AppUpdaterStatusDownloading
  | AppUpdaterStatusError
  | AppUpdaterStatusInstalling
  | AppUpdaterStatusWithUpdateInfo;

export type InstallDecision =
  | { type: "defer"; version: string }
  | { type: "install"; version: string }
  | { type: "nothing-staged" }
  | { type: "stale-staged"; version: string };

// What an install request actually did, for callers that have no other signal.
// The toolbar badge in particular sits on its own, so a deferral there has to be
// said out loud or the click reads as a no-op.
export type InstallOutcome =
  | { message: string; type: "failed" }
  | { type: "deferred"; version: string }
  | { type: "installing" }
  | { type: "no-update" }
  | { type: "quit-canceled" };

// What the updater can act on, as opposed to the status stream the UI renders.
// `staged` is the single source of truth for "an update is ready to install":
// the status union describes the last thing that happened, which is a different
// question and goes stale the moment a background poll fires.
//
// The invariant that makes the rest of this module simple: `staged` and
// `pendingNewer` are never both set. electron-updater keeps one artifact in its
// pending cache and empties that directory as soon as a *different* version
// starts downloading, so a superseding download destroys what was staged.
export interface UpdatePhase {
  installing: boolean;
  // A strictly newer build that is downloading in place of the staged one. Set
  // from the check that found it, so it outlives a later check that cannot reach
  // the feed.
  pendingNewer: null | UpdateInfo;
  staged: null | UpdateInfo;
  // A user-initiated pre-install check, which is allowed to show its progress
  // where a background poll would be suppressed.
  verifying: boolean;
}

interface AppUpdaterStatusChecking extends BaseAppUpdaterStatus {
  type: "checking";
}

interface AppUpdaterStatusDownloading extends BaseAppUpdaterStatus {
  progress: ProgressInfo;
  type: "downloading";
}

interface AppUpdaterStatusError extends BaseAppUpdaterStatus {
  message: string;
  type: "error";
}

interface AppUpdaterStatusInstalling extends BaseAppUpdaterStatus {
  notice?: string;
  type: "installing";
}

interface AppUpdaterStatusWithUpdateInfo extends BaseAppUpdaterStatus {
  type: "available" | "canceled" | "downloaded" | "inactive" | "not-available";
  updateInfo: null | UpdateInfo;
}

interface BaseAppUpdaterStatus {
  notifyUser: boolean;
}

export const POLL_INTERVAL_MS = ms("1 hour");

// A staged update is exactly the window where a new release would go unnoticed
// and the user would be offered yesterday's build, so poll harder while one is
// waiting than when there is nothing to go stale.
export const STAGED_POLL_INTERVAL_MS = ms("15 minutes");

// A check that failed is usually a network that dropped or was still coming
// up, as it is through the brief wakes a sleeping Mac makes, so it is tried
// again well before the next full interval.
export const FAILED_POLL_RETRY_MS = ms("5 minutes");

// How long after the computer wakes the next check runs. A laptop opened after
// a night asleep has missed every poll since, and its Wi-Fi takes a few seconds
// to rejoin.
export const WAKE_CHECK_DELAY_MS = ms("10 seconds");

// How long an install request will wait for the download that superseded the
// staged build before giving up and handing back a deferral. Generous on
// purpose: a click that spins for a while and then installs is the outcome the
// user wanted, and it beats making them come back and click again. The bound
// exists so a stalled or repeatedly failing download cannot park the request
// forever.
export const SUPERSEDING_DOWNLOAD_WAIT_MS = ms("3 minutes");

// Bounds the pre-install check. Long enough for a slow network, short enough
// that clicking install doesn't feel stuck; falling through installs what is
// already staged rather than blocking on an unreachable feed.
export const VERIFY_TIMEOUT_MS = ms("10 seconds");

export function createUpdatePhase(): UpdatePhase {
  return {
    installing: false,
    pendingNewer: null,
    staged: null,
    verifying: false,
  };
}

// Unparsable versions never win. A malformed feed entry must not displace a
// known-good staged build, nor read as an upgrade over the running app.
/**
 * What a launch says about the version change since the last one: an update
 * landed (`asked` when the person asked for that install), an install they
 * asked for came back on an older version, or nothing to say.
 */
export function launchOutcome({
  current,
  previous,
  requested,
}: {
  current: string;
  previous: string | undefined;
  requested: string | undefined;
}):
  | { asked: boolean; from: string; type: "updated" }
  | { to: string; type: "install-failed" }
  | { type: "none" } {
  if (
    previous &&
    semver.valid(previous) &&
    semver.valid(current) &&
    semver.gt(current, previous)
  ) {
    return { asked: requested !== undefined, from: previous, type: "updated" };
  }
  if (
    requested &&
    semver.valid(requested) &&
    semver.valid(current) &&
    semver.gt(requested, current)
  ) {
    return { to: requested, type: "install-failed" };
  }
  return { type: "none" };
}

export function isNewerVersion({
  baseline,
  candidate,
}: {
  baseline: string | undefined;
  candidate: string | undefined;
}): boolean {
  if (!candidate || !semver.valid(candidate)) {
    return false;
  }
  if (!baseline || !semver.valid(baseline)) {
    return true;
  }
  return semver.gt(candidate, baseline);
}

// Suppresses republishing a status the subscribers already hold, which is what
// keeps an hourly poll from re-emitting the same staged update forever.
export function isSameStatus(
  a: AppUpdaterStatus,
  b: AppUpdaterStatus,
): boolean {
  if (a === b) {
    return true;
  }
  if (a.type !== b.type || a.notifyUser !== b.notifyUser) {
    return false;
  }
  // Progress, messages, and install notices vary within a single type, so only
  // the version-carrying steady states can be compared this cheaply.
  if (
    a.type === "downloading" ||
    a.type === "error" ||
    a.type === "installing"
  ) {
    return false;
  }
  return statusVersion(a) === statusVersion(b);
}

export function nextPollDelayMs({
  hasStagedUpdate,
  lastCheckFailed,
}: {
  hasStagedUpdate: boolean;
  lastCheckFailed: boolean;
}) {
  if (lastCheckFailed) {
    return FAILED_POLL_RETRY_MS;
  }
  return hasStagedUpdate ? STAGED_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
}

// Decides what an install request should actually do. `latestVersion` is what
// the feed said moments ago (undefined when it could not be reached).
export function resolveInstallDecision({
  currentVersion,
  latestVersion,
  pendingVersion,
  stagedVersion,
}: {
  currentVersion: string;
  latestVersion: string | undefined;
  pendingVersion: string | undefined;
  stagedVersion: string | undefined;
}): InstallDecision {
  // Checked first because a superseding download has already destroyed the
  // staged artifact, so "a newer build is on the way" is the truthful answer
  // where "nothing is staged" would be technically true but useless. Either
  // signal defers: `pendingVersion` is a download already in flight and still
  // holds when the pre-install check could not reach the feed, `latestVersion`
  // is what the feed just advertised.
  for (const candidate of [pendingVersion, latestVersion]) {
    if (candidate && isNewerVersion({ baseline: stagedVersion, candidate })) {
      return { type: "defer", version: candidate };
    }
  }

  if (!stagedVersion) {
    return { type: "nothing-staged" };
  }

  // Installing a build at or below the running one is a downgrade whatever the
  // feed says. Reachable when someone installs a newer build by hand while an
  // older one is still staged.
  if (!isNewerVersion({ baseline: currentVersion, candidate: stagedVersion })) {
    return { type: "stale-staged", version: stagedVersion };
  }

  return { type: "install", version: stagedVersion };
}

// The status the UI should see, given what the updater can actually act on. A
// ready-to-install build is a fact about the disk; a check that found nothing,
// failed, or re-offered the same version is not allowed to erase it.
export function resolveStatus({
  next,
  phase,
}: {
  next: AppUpdaterStatus;
  phase: UpdatePhase;
}): AppUpdaterStatus {
  // An install in flight owns the status: its failure is the only thing left for
  // the user to act on, so it must not be folded back into "update ready".
  // Nothing staged means nothing to protect, and a superseding download has
  // already cleared `staged`, so its progress passes through here.
  if (phase.installing || !phase.staged) {
    return next;
  }

  switch (next.type) {
    case "checking": {
      return phase.verifying ? next : stagedStatus(phase.staged);
    }
    case "downloaded":
    case "installing": {
      return next;
    }
    default: {
      // With a build staged, `available` and `downloading` can only be
      // electron-updater re-offering and re-validating that same version's
      // cached artifact on a poll; canceled / error / inactive / not-available
      // describe a check that failed or found nothing. None of them changes
      // what is sitting on disk ready to install.
      return stagedStatus(phase.staged);
    }
  }
}

function stagedStatus(staged: UpdateInfo): AppUpdaterStatus {
  return { notifyUser: true, type: "downloaded", updateInfo: staged };
}

function statusVersion(status: AppUpdaterStatus): string | undefined {
  return "updateInfo" in status
    ? (status.updateInfo?.version ?? undefined)
    : undefined;
}
