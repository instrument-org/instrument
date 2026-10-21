import { type SetupStep } from "@/shared/setup";
import { type ComponentType } from "react";

import { FolderPage } from "./folder-page";
import { SetupFooter, SetupPage } from "./kit/setup-page";
import { LookPage } from "./look-page";
import { ModelPage } from "./model-page";
import { NotificationsPage } from "./notifications-page";
import { type SetupPageProps } from "./setup-page-props";
import { WelcomeBackPage } from "./welcome-back-page";

/** The page for each step. A step's own page replaces its placeholder here. */
export const SETUP_PAGES: Record<SetupStep, ComponentType<SetupPageProps>> = {
  folder: FolderPage,
  "free-account": PlaceholderPage,
  look: LookPage,
  model: ModelPage,
  notifications: NotificationsPage,
  plan: PlaceholderPage,
  "way-in": PlaceholderPage,
  "welcome-back": WelcomeBackPage,
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
