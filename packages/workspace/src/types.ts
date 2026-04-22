import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import { type GetProviderConfigs } from "@instrument-org/ai-gateway";
import {
  type CaptureEventFunction,
  type CaptureExceptionFunction,
} from "@instrument-org/shared";
import { z } from "zod";

import { type APP_STATUSES } from "./constants";
import { type AbsolutePath, type WorkspaceDir } from "./schemas/paths";
import { StoreId } from "./schemas/store-id";
import {
  type ProjectSubdomain,
  ProjectSubdomainSchema,
} from "./schemas/subdomains";

export type AppStatus = (typeof APP_STATUSES)[number];

export interface BrowserConfig {
  // Awaitable destroy entry point. The returned promise resolves only after the
  // entry has been fully torn down (debugger detached, host window closed,
  // entry removed from the manager's map). Safe to call on an already-destroyed
  // target -- resolves immediately in that case.
  closeTarget: (targetId: BrowserTargetId) => Promise<void>;
  // Idempotent: if a view already exists for (subdomain, sessionId), returns
  // its targetId without creating a new one. Otherwise creates a fresh
  // WebContentsView using the given Chromium profile partition. The targetId
  // is deterministic: `${subdomain}/${sessionId}`.
  createTarget: (
    subdomain: ProjectSubdomain,
    sessionId: StoreId.Session,
    partitionDir: AbsolutePath,
  ) => Promise<{ targetId: BrowserTargetId }>;
  // Returns metadata for a live target so callers (e.g. the CDP bridge) can
  // correlate a `targetId` back to its owning project. Returns null if the
  // target has already been destroyed.
  getTargetMeta: (targetId: BrowserTargetId) => null | {
    partitionDir: AbsolutePath;
    sessionId: StoreId.Session;
    subdomain: ProjectSubdomain;
  };
  listTargets: (subdomain: ProjectSubdomain) => Promise<BrowserTarget[]>;
  onTargetDestroyed: (
    targetId: BrowserTargetId,
    listener: () => void,
  ) => () => void;
  sendCommand<M extends CdpMethod>(
    targetId: BrowserTargetId,
    method: M,
    ...args: CdpSendArgs<M>
  ): Promise<CdpReturn<M>>;
  sendCommand(
    targetId: BrowserTargetId,
    method: string,
    params: unknown,
  ): Promise<unknown>;
  subscribeEvents: (
    targetId: BrowserTargetId,
    onDetach: () => void,
    onEvent: (method: string, params: unknown) => void,
  ) => () => void;
}

export interface BrowserTarget {
  id: BrowserTargetId;
  title: string;
  type: "page";
  url: string;
}

// The bridge routing key for a single browser view: a (subdomain, sessionId)
// tuple encoded as `${subdomain}/${sessionId}`. The schema delegates to the
// existing ProjectSubdomain and StoreId.Session validators so a parse failure
// pinpoints the offending half. Use `encodeBrowserTargetId` /
// `decodeBrowserTargetId` to construct or parse one; never build by hand.
export const BrowserTargetIdSchema = z
  .custom<`${ProjectSubdomain}/${StoreId.Session}`>()
  .superRefine((val, ctx) => {
    if (typeof val !== "string") {
      ctx.addIssue({
        code: "custom",
        fatal: true,
        input: val,
        message: "BrowserTargetId must be a string",
      });
      return;
    }
    const slash = val.indexOf("/");
    if (slash <= 0 || slash === val.length - 1) {
      ctx.addIssue({
        code: "custom",
        fatal: true,
        input: val,
        message:
          "BrowserTargetId must be `${subdomain}/${sessionId}` with both halves non-empty",
      });
      return;
    }
    const subdomainResult = ProjectSubdomainSchema.safeParse(
      val.slice(0, slash),
    );
    if (!subdomainResult.success) {
      for (const issue of subdomainResult.error.issues) {
        ctx.addIssue({ ...issue, path: ["subdomain", ...issue.path] });
      }
    }
    const sessionResult = StoreId.SessionSchema.safeParse(val.slice(slash + 1));
    if (!sessionResult.success) {
      for (const issue of sessionResult.error.issues) {
        ctx.addIssue({ ...issue, path: ["sessionId", ...issue.path] });
      }
    }
  })
  .brand("BrowserTargetId");

export type BrowserTargetId = z.output<typeof BrowserTargetIdSchema>;

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

export function decodeBrowserTargetId(
  targetId: string,
): null | { sessionId: StoreId.Session; subdomain: ProjectSubdomain } {
  const result = BrowserTargetIdSchema.safeParse(targetId);
  if (!result.success) {
    return null;
  }
  const slash = result.data.indexOf("/");
  return {
    sessionId: result.data.slice(slash + 1) as StoreId.Session,
    subdomain: result.data.slice(0, slash) as ProjectSubdomain,
  };
}

export function encodeBrowserTargetId(
  subdomain: ProjectSubdomain,
  sessionId: StoreId.Session,
): BrowserTargetId {
  return BrowserTargetIdSchema.parse(`${subdomain}/${sessionId}`);
}
