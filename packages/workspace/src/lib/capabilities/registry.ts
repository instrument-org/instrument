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
  appsTest,
} from "./apps-setup";
import { type Capability } from "./define";
import { memoryForget, memoryList, memorySave, memoryShow } from "./memory";
import { taskNew } from "./task/fork";
import { taskList } from "./task/list";
import { taskLog } from "./task/log";
import { taskSend } from "./task/send";
import { taskStop } from "./task/stop";
import {
  windowClose,
  windowList,
  windowRead,
  windowRequest,
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
  appsIcon,
  appsAccount,
  appsDisconnect,
  generateImageCapability,
  memoryList,
  memorySave,
  memoryShow,
  memoryForget,
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
  windowClose,
  windowRequest,
  xSearch,
  xThread,
];
