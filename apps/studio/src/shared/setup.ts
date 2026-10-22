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
  "way-in",
  "plan",
  "free-account",
  "model",
  "notifications",
  "look",
] as const;

export const SetupStepSchema = z.enum(SETUP_STEPS);

export type SetupStep = z.output<typeof SetupStepSchema>;

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
  /** Signed in to Instrument. */
  hasInstrumentAccount: boolean;
  /**
   * Signed in to Instrument with a subscription or a trial running, so the
   * plan step has nothing to ask. False while the status is unknown.
   */
  hasInstrumentPlan: boolean;
  /**
   * Signed in to Instrument and the billing status not yet read for that
   * sign-in, so whether the plan step asks anything isn't known yet.
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
   * Where the workspace's folder was, when the launch found it missing or
   * couldn't read it: the folder step says so, and the person finds it or
   * makes a new one. Null otherwise.
   */
  lostFolder: null | string;
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
  answered: z.record(z.string(), z.string()).catch({}),
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
