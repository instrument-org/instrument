import { appsCall, appsList, appsRequest, appsTools } from "./apps";
import { type Capability } from "./define";

/** Every capability this build has, each defined once. */
export const CAPABILITIES: readonly Capability[] = [
  appsCall,
  appsList,
  appsRequest,
  appsTools,
];
