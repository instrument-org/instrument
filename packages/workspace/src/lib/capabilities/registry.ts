import { generateImageCapability } from "../../tools/generate-image";
import { webFetchCapability } from "../../tools/web-fetch";
import { webSearchCapability } from "../../tools/web-search";
import { appsCall, appsList, appsRequest, appsTools } from "./apps";
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
  appsRequest,
  appsGuide,
  appsIcon,
  appsAccount,
  appsDisconnect,
  generateImageCapability,
  webFetchCapability,
  webSearchCapability,
  xSearch,
  xThread,
];
