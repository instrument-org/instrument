import { type SetupStep } from "@/shared/setup";
import { type ComponentType } from "react";

import { FolderPage } from "./folder-page";
import { LookPage } from "./look-page";
import { ModelPage } from "./model-page";
import { NotificationsPage } from "./notifications-page";
import { type SetupPageProps } from "./setup-page-props";
import { FreeAccountStep } from "./steps/free-account";
import { PlanStep } from "./steps/plan";
import { WayInStep } from "./steps/way-in";
import { WelcomeBackPage } from "./welcome-back-page";

/** The page for each step. */
export const SETUP_PAGES: Record<SetupStep, ComponentType<SetupPageProps>> = {
  folder: FolderPage,
  "free-account": FreeAccountStep,
  look: LookPage,
  model: ModelPage,
  notifications: NotificationsPage,
  plan: PlanStep,
  "way-in": WayInStep,
  "welcome-back": WelcomeBackPage,
};
