import { workspaceRouter } from "@instrument-org/workspace/electron";

import { activity } from "./activity";
import { appCommands } from "./app-commands";
import { apps } from "./apps";
import { auth } from "./auth";
import { browser } from "./browser";
import { browsingData } from "./browsing-data";
import { chatgptAccount } from "./chatgpt-account";
import { claudeAccount } from "./claude-account";
import { debug } from "./debug";
import { features } from "./features";
import { files } from "./files";
import { gateway } from "./gateway";
import { grokAccount } from "./grok-account";
import { history } from "./history";
import { mac } from "./mac";
import { notices } from "./notices";
import { onboarding } from "./onboarding";
import { pageEditor } from "./page-editor";
import { plans } from "./plans";
import { preferences } from "./preferences";
import { problems } from "./problems";
import { providerConfig } from "./provider-config";
import { releases } from "./releases";
import { stripe } from "./stripe";
import { syntax } from "./syntax";
import { transcript } from "./transcript";
import { updates } from "./updates";
import { user } from "./user";
import { utils } from "./utils";
import { window } from "./window";
import { workspaces } from "./workspaces";

export const router = {
  activity,
  appCommands,
  apps,
  auth,
  browser,
  browsingData,
  chatgptAccount,
  claudeAccount,
  debug,
  features,
  files,
  gateway,
  grokAccount,
  history,
  mac,
  notices,
  onboarding,
  pageEditor,
  plans,
  preferences,
  problems,
  providerConfig,
  releases,
  stripe,
  syntax,
  transcript,
  updates,
  user,
  utils,
  window,
  workspace: workspaceRouter,
  workspaces,
};
