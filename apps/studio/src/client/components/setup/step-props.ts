import { type SetupStep } from "@/shared/setup";

/** What every setup page is handed. */
export type SetupStepProps = {
  /**
   * Keeps this step's page on screen while it finishes something that
   * settles the step on its own (notifications allowed, a folder move
   * recorded), until `onContinue` or `onFinish`.
   */
  hold: () => void;
  /** Whether this is setup's last step, whose way on finishes setup. */
  isLast: boolean;
  /** Setup is back after an update for only the steps added since. */
  isNewStepOnly: boolean;
  /** Back to the step before, or none when there is nothing to go back to. */
  onBack?: () => void;
  /** Answers this step, and setup moves to the next one it needs. */
  onContinue: () => void;
  /** Finishes setup, and the window is the app's. */
  onFinish: () => void;
  step: SetupStep;
};
