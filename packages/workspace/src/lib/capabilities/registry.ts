import { generateImageCapability } from "../../tools/generate-image";
import { webFetchCapability } from "../../tools/web-fetch";
import { webSearchCapability } from "../../tools/web-search";
import { appsCall, appsList, appsRequest, appsTools } from "./apps";
import { type Capability } from "./define";

/**
 * Every capability a command or a script calls, each defined once. The ones
 * the model calls as tools are in `tools/all.ts`, built from the same
 * definitions; a capability with both surfaces is in both.
 */
export const CAPABILITIES: readonly Capability[] = [
  appsCall,
  appsList,
  appsRequest,
  appsTools,
  generateImageCapability,
  webFetchCapability,
  webSearchCapability,
];
