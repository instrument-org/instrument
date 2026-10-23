import { type SetupStep } from "@/shared/setup";
import { type ComponentType } from "react";

import { FolderStep } from "./steps/folder";
import { LookStep } from "./steps/look";
import { ModelStep } from "./steps/model";
import { NotificationsStep } from "./steps/notifications";
import { type SetupStepProps } from "./step-props";
import { FreeAccountStep } from "./steps/free-account";
import { PlanStep } from "./steps/plan";
import { ChooseAIStep } from "./steps/choose-ai";
import { WelcomeBackStep } from "./steps/welcome-back";

/** The page for each step. */
export const SETUP_PAGES: Record<SetupStep, ComponentType<SetupStepProps>> = {
  folder: FolderStep,
  "free-account": FreeAccountStep,
  look: LookStep,
  model: ModelStep,
  notifications: NotificationsStep,
  plan: PlanStep,
  "choose-ai": ChooseAIStep,
  "welcome-back": WelcomeBackStep,
};
