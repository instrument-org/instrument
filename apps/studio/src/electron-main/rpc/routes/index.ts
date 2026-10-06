import { workspaceRouter } from "@instrument-org/workspace/electron";

import { appCommands } from "./app-commands";
import { apps } from "./apps";
import { auth } from "./auth";
import { billing } from "./billing";
import { browser } from "./browser";
import { chatgptPlan } from "./chatgpt-plan";
import { debug } from "./debug";
import { features } from "./features";
import { files } from "./files";
import { gateway } from "./gateway";
import { mac } from "./mac";
import { onboarding } from "./onboarding";
import { pageEditor } from "./page-editor";
import { preferences } from "./preferences";
import { providerConfig } from "./provider-config";
import { releases } from "./releases";
import { syntax } from "./syntax";
import { telemetry } from "./telemetry";
import { transcript } from "./transcript";
import { updates } from "./updates";
import { user } from "./user";
import { utils } from "./utils";
import { window } from "./window";
import { workspaces } from "./workspaces";

export const router = {
  appCommands,
  apps,
  auth,
  billing,
  browser,
  chatgptPlan,
  debug,
  features,
  files,
  gateway,
  mac,
  onboarding,
  pageEditor,
  preferences,
  providerConfig,
  releases,
  syntax,
  telemetry,
  transcript,
  updates,
  user,
  utils,
  window,
  workspace: workspaceRouter,
  workspaces,
};
