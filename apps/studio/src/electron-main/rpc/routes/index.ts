import { workspaceRouter } from "@instrument-org/workspace/electron";

import { accountCheck } from "./account-check";
import { activity } from "./activity";
import { appCommands } from "./app-commands";
import { apps } from "./apps";
import { auth } from "./auth";
import { billing } from "./billing";
import { browser } from "./browser";
import { browsingData } from "./browsing-data";
import { chatLocation } from "./chat-location";
import { chatgptAccount } from "./chatgpt-account";
import { claudeAccount } from "./claude-account";
import { debug } from "./debug";
import { dictation } from "./dictation";
import { features } from "./features";
import { files } from "./files";
import { gateway } from "./gateway";
import { grokAccount } from "./grok-account";
import { history } from "./history";
import { mac } from "./mac";
import { network } from "./network";
import { notices } from "./notices";
import { pageEditor } from "./page-editor";
import { preferences } from "./preferences";
import { problems } from "./problems";
import { providerConfig } from "./provider-config";
import { releases } from "./releases";
import { setup } from "./setup";
import { syntax } from "./syntax";
import { updates } from "./updates";
import { user } from "./user";
import { utils } from "./utils";
import { window } from "./window";
import { workspaces } from "./workspaces";

export const router = {
  accountCheck,
  activity,
  appCommands,
  apps,
  auth,
  billing,
  browser,
  browsingData,
  chatLocation,
  chatgptAccount,
  claudeAccount,
  debug,
  dictation,
  features,
  files,
  gateway,
  grokAccount,
  history,
  mac,
  network,
  notices,
  pageEditor,
  preferences,
  problems,
  providerConfig,
  releases,
  setup,
  syntax,
  updates,
  user,
  utils,
  window,
  workspace: workspaceRouter,
  workspaces,
};
