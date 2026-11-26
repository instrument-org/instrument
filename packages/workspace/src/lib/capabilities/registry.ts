import { generateImageCapability } from "../../tools/generate-image";
import { webFetchCapability } from "../../tools/web-fetch";
import { webSearchCapability } from "../../tools/web-search";
import {
  appsCall,
  appsList,
  appsRead,
  appsRequest,
  appsResources,
  appsTools,
} from "./apps";
import {
  appsAccount,
  appsCatalog,
  appsDisconnect,
  appsGuide,
  appsIcon,
  appsNew,
  appsSetup,
  appsTest,
} from "./apps-setup";
import { activityList } from "./activity";
import {
  bookmarksAdd,
  bookmarksAddress,
  bookmarksList,
  bookmarksMove,
  bookmarksNewFolder,
  bookmarksRemove,
  bookmarksRename,
} from "./bookmarks";
import { browserRun } from "./browser";
import {
  chatsArchive,
  chatsList,
  chatsMarkRead,
  chatsMarkUnread,
  chatsProject,
  chatsRename,
  chatsStar,
  chatsStop,
  chatsUnarchive,
  chatsUnstar,
} from "./chats";
import { type Capability } from "./define";
import { memoryForget, memoryList, memorySave, memoryShow } from "./memory";
import {
  projectsCreate,
  projectsIcons,
  projectsList,
  projectsRetire,
  projectsSet,
  projectsUnretire,
} from "./projects";
import { settingsGet, settingsList, settingsSet } from "./settings";
import { taskNew } from "./task/fork";
import { taskList } from "./task/list";
import { taskLog } from "./task/log";
import { taskSend } from "./task/send";
import { taskStop } from "./task/stop";
import {
  windowBack,
  windowClose,
  windowForward,
  windowGroup,
  windowHistory,
  windowJoin,
  windowList,
  windowLook,
  windowMove,
  windowNew,
  windowPin,
  windowPlace,
  windowRead,
  windowRestore,
  windowUnpin,
  windowWait,
  windowShow,
} from "./window";
import { xSearch, xThread } from "./x";

/**
 * Every capability a command or a script calls, each defined once, in the
 * order each command's usage lists them. The ones
 * the model calls as tools are in `tools/all.ts`, built from the same
 * definitions; a capability with both surfaces is in both.
 */
export const CAPABILITIES: readonly Capability[] = [
  activityList,
  // In the order `instrument app help` lists them: setting an app up, using
  // it, then its guide, icon and account.
  appsCatalog,
  appsNew,
  appsTest,
  appsList,
  appsTools,
  appsCall,
  appsResources,
  appsRead,
  appsRequest,
  appsGuide,
  appsSetup,
  appsIcon,
  appsAccount,
  appsDisconnect,
  bookmarksList,
  bookmarksAdd,
  bookmarksMove,
  bookmarksRename,
  bookmarksAddress,
  bookmarksNewFolder,
  bookmarksRemove,
  browserRun,
  chatsList,
  chatsRename,
  chatsArchive,
  chatsUnarchive,
  chatsProject,
  chatsStar,
  chatsUnstar,
  chatsMarkRead,
  chatsMarkUnread,
  chatsStop,
  generateImageCapability,
  memoryList,
  memorySave,
  memoryShow,
  memoryForget,
  projectsList,
  projectsCreate,
  projectsSet,
  projectsIcons,
  projectsRetire,
  projectsUnretire,
  settingsList,
  settingsGet,
  settingsSet,
  taskNew,
  taskSend,
  taskStop,
  taskList,
  taskLog,
  webFetchCapability,
  webSearchCapability,
  windowList,
  windowShow,
  windowRead,
  windowLook,
  windowClose,
  windowBack,
  windowForward,
  windowGroup,
  windowMove,
  windowNew,
  windowPin,
  windowUnpin,
  windowPlace,
  windowHistory,
  windowJoin,
  windowRestore,
  windowWait,
  xSearch,
  xThread,
];
