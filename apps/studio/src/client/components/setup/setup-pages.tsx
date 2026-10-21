import { type SetupStep } from "@/shared/setup";
import { type ComponentType } from "react";

import { SetupFooter, SetupPage } from "./kit/setup-page";

/** What every setup page is handed. */
export type SetupPageProps = {
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

/** The page for each step. A step's own page replaces its placeholder here. */
export const SETUP_PAGES: Record<SetupStep, ComponentType<SetupPageProps>> = {
  folder: PlaceholderPage,
  "free-account": PlaceholderPage,
  look: PlaceholderPage,
  model: PlaceholderPage,
  notifications: PlaceholderPage,
  plan: PlaceholderPage,
  "way-in": PlaceholderPage,
  "welcome-back": PlaceholderPage,
};

/** Stands in for a step whose page is not built yet. */
function PlaceholderPage({
  isLast,
  onBack,
  onContinue,
  onFinish,
  step,
}: SetupPageProps) {
  return (
    <SetupPage
      align="center"
      footer={
        <SetupFooter
          label={isLast ? "Finish" : "Continue"}
          onBack={onBack}
          onContinue={isLast ? onFinish : onContinue}
        />
      }
      title={<span className="font-mono text-lg">{step}</span>}
    />
  );
}
