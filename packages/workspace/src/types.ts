import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import { type GetProviderConfigs } from "@instrument-org/ai-gateway";
import {
  type CaptureEventFunction,
  type CaptureExceptionFunction,
} from "@instrument-org/shared";
import { z } from "zod";

import { type TASK_STATUSES } from "./constants";
import { type AbsolutePath, type WorkspaceDir } from "./schemas/paths";
import { StoreId } from "./schemas/store-id";
import { type TaskId, TaskIdSchema } from "./schemas/task-id";

export interface BrowserConfig {
  captureScreenshot: (targetId: BrowserTargetId) => Promise<Buffer | undefined>;
  closeTarget: (targetId: BrowserTargetId) => Promise<void>;
  createTarget: (
    id: TaskId,
    sessionId: StoreId.Session,
    partitionDir: AbsolutePath,
  ) => Promise<{ targetId: BrowserTargetId }>;
  getTargetMeta: (targetId: BrowserTargetId) => null | {
    id: TaskId;
    partitionDir: AbsolutePath;
    sessionId: StoreId.Session;
  };
  listTargets: (id: TaskId) => Promise<BrowserTarget[]>;
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
  stopScreencast: (targetId: BrowserTargetId) => void;
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

export type TaskStatus = (typeof TASK_STATUSES)[number];

// The bridge routing key for a single browser view: a (id, sessionId)
// tuple encoded as `${id}/${sessionId}`. The schema delegates to the
// existing TaskId and StoreId.Session validators so a parse failure
// pinpoints the offending half. Use `encodeBrowserTargetId` /
// `decodeBrowserTargetId` to construct or parse one; never build by hand.
export const BrowserTargetIdSchema = z
  .custom<`${TaskId}/${StoreId.Session}`>()
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
          "BrowserTargetId must be `${id}/${sessionId}` with both halves non-empty",
      });
      return;
    }
    const taskIdResult = TaskIdSchema.safeParse(val.slice(0, slash));
    if (!taskIdResult.success) {
      for (const issue of taskIdResult.error.issues) {
        ctx.addIssue({ ...issue, path: ["id", ...issue.path] });
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
  appVersion: string;
  browser: BrowserConfig;
  captureEvent: CaptureEventFunction;
  captureException: CaptureExceptionFunction;
  getAIProviderConfigs: GetProviderConfigs;
  nodeExecEnv: Record<string, string>;
  pnpmBinPath: AbsolutePath;
  registryDir: AbsolutePath;
  rootDir: WorkspaceDir;
  tasksDir: AbsolutePath;
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
): null | { id: TaskId; sessionId: StoreId.Session } {
  const result = BrowserTargetIdSchema.safeParse(targetId);
  if (!result.success) {
    return null;
  }
  const slash = result.data.indexOf("/");
  return {
    id: result.data.slice(0, slash) as TaskId,
    sessionId: result.data.slice(slash + 1) as StoreId.Session,
  };
}

export function encodeBrowserTargetId(
  id: TaskId,
  sessionId: StoreId.Session,
): BrowserTargetId {
  return BrowserTargetIdSchema.parse(`${id}/${sessionId}`);
}
