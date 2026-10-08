import { type SetupStep } from "@/client/components/onboarding/setup/flow";
import {
  BetaOfferPage,
  PlansPage,
  TrialStartedPage,
  WelcomeBackPage,
} from "@/client/components/onboarding/setup/screens/plans";
import {
  ModelPage,
  PasteKeyPage,
  ProvidersPage,
} from "@/client/components/onboarding/setup/screens/own-key";
import {
  FolderPage,
  LookPage,
  MemoriesPage,
  NotificationsPage,
  WeekPage,
} from "@/client/components/onboarding/setup/screens/setup-steps";
import {
  AllSetPage,
  TasksPage,
} from "@/client/components/onboarding/setup/screens/tasks";
import {
  ClaudeDevicePage,
  ClaudeSignInPage,
  FreeAccountPage,
  NoPaidPlanPage,
  OutOfUsagePage,
  WelcomePage,
} from "@/client/components/onboarding/setup/screens/way-in";
import { type ComponentType } from "react";

const PAGES: Record<SetupStep, ComponentType> = {
  "all-set": AllSetPage,
  "beta-offer": BetaOfferPage,
  "claude-device": ClaudeDevicePage,
  "claude-sign-in": ClaudeSignInPage,
  folder: FolderPage,
  "free-account": FreeAccountPage,
  look: LookPage,
  memories: MemoriesPage,
  model: ModelPage,
  "no-paid-plan": NoPaidPlanPage,
  notifications: NotificationsPage,
  "out-of-usage": OutOfUsagePage,
  "paste-key": PasteKeyPage,
  plans: PlansPage,
  providers: ProvidersPage,
  tasks: TasksPage,
  "trial-started": TrialStartedPage,
  week: WeekPage,
  welcome: WelcomePage,
  "welcome-back": WelcomeBackPage,
};

/** The page for a step, keyed so each page starts fresh. */
export function SetupStepPage({ step }: { step: SetupStep }) {
  const Page = PAGES[step];
  return <Page key={step} />;
}
