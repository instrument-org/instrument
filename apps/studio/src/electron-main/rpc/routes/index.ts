import { workspaceRouter } from "@instrument-org/workspace/electron";

import { agentBrowser } from "./agent-browser";
import { appCommands } from "./app-commands";
import { auth } from "./auth";
import { debug } from "./debug";
import { features } from "./features";
import { gateway } from "./gateway";
import { onboarding } from "./onboarding";
import { plans } from "./plans";
import { preferences } from "./preferences";
import { providerConfig } from "./provider-config";
import { releases } from "./releases";
import { stripe } from "./stripe";
import { syntax } from "./syntax";
import { telemetry } from "./telemetry";
import { updates } from "./updates";
import { user } from "./user";
import { utils } from "./utils";

export const router = {
  agentBrowser,
  appCommands,
  auth,
  debug,
  features,
  gateway,
  onboarding,
  plans,
  preferences,
  providerConfig,
  releases,
  stripe,
  syntax,
  telemetry,
  updates,
  user,
  utils,
  workspace: workspaceRouter,
};
