import { workspaceRouter } from "@instrument-org/workspace/electron";

import { aiUsage } from "./ai-usage";
import { appCommands } from "./app-commands";
import { apps } from "./apps";
import { auth } from "./auth";
import { browser } from "./browser";
import { browsingData } from "./browsing-data";
import { chatgptAccount } from "./chatgpt-account";
import { claudeAccount } from "./claude-account";
import { debug } from "./debug";
import { drafts } from "./drafts";
import { features } from "./features";
import { files } from "./files";
import { gateway } from "./gateway";
import { history } from "./history";
import { mac } from "./mac";
import { onboarding } from "./onboarding";
import { pageEditor } from "./page-editor";
import { plans } from "./plans";
import { preferences } from "./preferences";
import { providerConfig } from "./provider-config";
import { releases } from "./releases";
import { stripe } from "./stripe";
import { syntax } from "./syntax";
import { telemetry } from "./telemetry";
import { transcript } from "./transcript";
import { updates } from "./updates";
import { user } from "./user";
import { utils } from "./utils";
import { window } from "./window";
import { workspaces } from "./workspaces";

export const router = {
  aiUsage,
  appCommands,
  apps,
  auth,
  browser,
  browsingData,
  chatgptAccount,
  claudeAccount,
  debug,
  drafts,
  features,
  files,
  gateway,
  history,
  mac,
  onboarding,
  pageEditor,
  plans,
  preferences,
  providerConfig,
  releases,
  stripe,
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
