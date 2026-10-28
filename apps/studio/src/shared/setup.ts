import { z } from "zod";

/**
 * Setup's steps, in the order they come. The current step is the first one
 * that is needed and not done; see `docs/plans/active/onboarding-setup-assistant.md`.
 * A step added here is unanswered for everyone, so people who finished setup
 * see only that one.
 */
export const SETUP_STEPS = [
  "welcome-back",
  "folder",
  "choose-ai",
  "free-account",
  "model",
  "notifications",
  "look",
] as const;

export const SetupStepSchema = z.enum(SETUP_STEPS);

export type SetupStep = z.output<typeof SetupStepSchema>;

/**
 * Why the launch couldn't open the workspace's folder:
 *
 * - `missing`: the folder isn't there (moved, renamed, deleted, or on a
 *   disk that isn't connected);
 * - `denied`: the system won't let the app read it;
 * - `cloud`: its record is on this computer by name only, kept by a cloud
 *   service until it is read, which downloads it;
 * - `unreadable`: it's there but reading it failed for another reason;
 * - `refused`: it's somewhere no workspace can be, as an earlier build let
 *   it be.
 */
export const LostReasonSchema = z.enum([
  "cloud",
  "denied",
  "missing",
  "refused",
  "unreadable",
]);

export type LostReason = z.output<typeof LostReasonSchema>;

/** A workspace folder the launch couldn't open: where it is, and why. */
export interface LostFolder {
  path: string;
  reason: LostReason;
}

/**
 * What setup reads from the computer and the account to decide where it is.
 * Read again at launch and whenever one of them changes, never saved.
 */
export interface SetupFacts {
  /**
   * A model setup can run on: a key, or an account the account check calls
   * ready or out of usage. An account with no paid plan does not count.
   */
  hasUsableAI: boolean;
  /**
   * A model to run on that isn't Instrument's: a key, or an account the
   * account check calls ready or out of usage. Someone with one has no plan
   * to pick.
   */
  hasOwnAI: boolean;
  /** Signed in to Instrument. */
  hasInstrumentAccount: boolean;
  /**
   * Signed in to Instrument with a subscription or a trial running, so
   * choosing AI has no plan to ask for. False while the status is unknown.
   */
  hasInstrumentPlan: boolean;
  /**
   * Signed in to Instrument and the billing status not yet read for that
   * sign-in, so whether the account still needs a plan isn't known yet.
   */
  isCheckingPlan: boolean;
  /** The workspace has chats. */
  hasChats: boolean;
  /**
   * A chat in the workspace was started by a 2.0 beta, or came from 1.x
   * (`workspaceTestedBefore`), so setup thanks them for testing.
   */
  testedBefore: boolean;
  /**
   * The workspace has a folder. False only on a first launch, until the
   * folder step places it: until then the app has no workspace running, and
   * the folder step is the only one setup can show.
   */
  hasWorkspace: boolean;
  /**
   * The workspace's folder, when the launch couldn't open it, and why: the
   * folder step says so and offers what fits the reason. Null otherwise.
   */
  lostFolder: LostFolder | null;
  /**
   * The workspace is outside the app's data, pinned, or has a move recorded
   * that the next launch finishes.
   */
  folderSettled: boolean;
  /**
   * macOS hasn't been asked, or allows notifications only quietly. False off
   * macOS, and whenever the bridge can't tell.
   */
  notificationsAskable: boolean;
}

/**
 * What setup keeps: when each step was answered, and when setup finished.
 * Kept per workspace, in its machine folder, so it is there before setup
 * gives a first launch's workspace its folder. Finishing records every step
 * this build knows as answered, so a step a later build adds is the only one
 * unanswered. Keyed by any name, so a step from a newer build survives a run
 * of an older one.
 */
export const SetupRecordSchema = z.object({
  answered: z
    .record(z.string(), z.string())
    .catch({})
    // Earlier builds named choose-ai `way-in`; its answer carries over, and
    // the old key stays for a build that still reads it.
    .transform((answered) =>
      answered["way-in"] !== undefined && answered["choose-ai"] === undefined
        ? { ...answered, "choose-ai": answered["way-in"] }
        : answered,
    ),
  finishedAt: z.string().optional().catch(undefined),
});

export type SetupRecord = z.output<typeof SetupRecordSchema>;

/** What the window and the renderer read: the step setup is on, or none. */
export interface SetupState {
  /** The step Back returns to, or none when there is nothing to go back to. */
  back: null | SetupStep;
  facts: SetupFacts;
  /** Answered before an update added a step: setup shows only what's new. */
  isNewStepOnly: boolean;
  step: null | SetupStep;
}
