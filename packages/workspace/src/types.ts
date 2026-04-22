import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import { type GetProviderConfigs } from "@instrument-org/ai-gateway";
import {
  type CaptureEventFunction,
  type CaptureExceptionFunction,
} from "@instrument-org/shared";

import { type APP_STATUSES } from "./constants";
import { type AbsolutePath, type WorkspaceDir } from "./schemas/paths";
import { type ProjectSubdomain } from "./schemas/subdomains";

export type AppStatus = (typeof APP_STATUSES)[number];

export interface BrowserConfig {
  closeTarget: (targetId: string) => Promise<void>;
  createTarget: (
    subdomain: ProjectSubdomain,
    partitionDir: AbsolutePath,
  ) => Promise<{ targetId: string }>;
  listTargets: (subdomain: ProjectSubdomain) => Promise<BrowserTarget[]>;
  // Typed overload for known CDP methods; the string-keyed signature exists
  // for the cdp-bridge pass-through where the method comes off the wire from
  // an out-of-process client and cannot be narrowed at compile time.
  sendCommand<M extends CdpMethod>(
    targetId: string,
    method: M,
    ...args: CdpSendArgs<M>
  ): Promise<CdpReturn<M>>;
  sendCommand(
    targetId: string,
    method: string,
    params: unknown,
  ): Promise<unknown>;
  subscribeEvents: (
    targetId: string,
    onDetach: () => void,
    onEvent: (method: string, params: unknown) => void,
  ) => () => void;
}
export interface BrowserTarget {
  id: string;
  title: string;
  type: "page";
  url: string;
}
export interface WorkspaceConfig {
  browser: BrowserConfig;
  captureEvent: CaptureEventFunction;
  captureException: CaptureExceptionFunction;
  getAIProviderConfigs: GetProviderConfigs;
  nodeExecEnv: Record<string, string>;
  pnpmBinPath: AbsolutePath;
  previewCacheTimeMs?: number;
  previewsDir: AbsolutePath;
  projectsDir: AbsolutePath;
  registryDir: AbsolutePath;
  rootDir: WorkspaceDir;
  templatesDir: AbsolutePath;
  trashItem: (path: AbsolutePath) => Promise<void>;
}

type CdpMethod = keyof ProtocolMapping.Commands;

type CdpParams<M extends CdpMethod> = ProtocolMapping.Commands[M]["paramsType"];

type CdpReturn<M extends CdpMethod> = ProtocolMapping.Commands[M]["returnType"];

// CDP commands declare paramsType as a (possibly empty) tuple where the only
// element may be optional. Map that to overloaded call signatures so callers
// either omit params (no-arg or all-optional commands) or pass a typed object.
type CdpSendArgs<M extends CdpMethod> =
  CdpParams<M> extends []
    ? []
    : CdpParams<M> extends [infer P]
      ? [params: P]
      : CdpParams<M> extends [(infer P)?]
        ? [params?: P]
        : never;
