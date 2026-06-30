import { workspaceRouter } from "@instrument-org/workspace/electron";

import { agentBrowser } from "./agent-browser";
import { auth } from "./auth";
import { debug } from "./debug";
import { features } from "./features";
import { gateway } from "./gateway";
import { onboarding } from "./onboarding";
import { plans } from "./plans";
import { preferences } from "./preferences";
import { providerConfig } from "./provider-config";
import { releases } from "./releases";
import { sidebar } from "./sidebar";
import { stripe } from "./stripe";
import { studioOverlay } from "./studio-overlay";
import { syntax } from "./syntax";
import { tabs } from "./tabs";
import { telemetry } from "./telemetry";
import { updates } from "./updates";
import { user } from "./user";
import { utils } from "./utils";

export const router = {
  agentBrowser,
  auth,
  debug,
  features,
  gateway,
  onboarding,
  plans,
  preferences,
  providerConfig,
  releases,
  sidebar,
  stripe,
  studioOverlay,
  syntax,
  tabs,
  telemetry,
  updates,
  user,
  utils,
  workspace: workspaceRouter,
};
