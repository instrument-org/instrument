import { Button } from "@/client/components/ui/button";
import { SETUP_STEPS, type SetupStep } from "@/shared/setup";
import { type ComponentType } from "react";

/** What every setup page is handed. */
export type SetupPageProps = {
  /** Whether this is setup's last step, which finishes it. */
  isLast: boolean;
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

export function isLastSetupStep(step: SetupStep) {
  return SETUP_STEPS.at(-1) === step;
}

/** Stands in for a step whose page is not built yet. */
function PlaceholderPage({ isLast, onContinue, onFinish, step }: SetupPageProps) {
  return (
    <div className="flex flex-col items-center gap-6">
      <h1 className="font-mono text-lg">{step}</h1>
      {isLast ? (
        <Button onClick={onFinish} variant="brand">
          Finish
        </Button>
      ) : (
        <Button onClick={onContinue} variant="brand">
          Continue
        </Button>
      )}
    </div>
  );
}
