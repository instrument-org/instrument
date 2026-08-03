import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import {
  type GetProviderConfigs,
  type ModelCache,
} from "@instrument-org/ai-gateway";
import {
  type CaptureEventFunction,
  type CaptureExceptionFunction,
} from "@instrument-org/shared";
import { z } from "zod";

import { type TASK_STATUSES } from "./constants";
import { type AbsolutePath, type WorkspaceDir } from "./schemas/paths";
import { StoreId } from "./schemas/store-id";
import { type TaskId, TaskIdSchema } from "./schemas/task-id";
import { type WebSearchClient } from "./schemas/web-search";

export interface BrowserConfig {
  closeTarget: (targetId: BrowserTargetId) => Promise<void>;
  // The task's artifact-preview guest: one per task, navigated between HTML
  // files rather than recreated per file. Separate from `createTarget` because
  // it has no session -- see BrowserTargetIdSchema for the two id kinds.
  createArtifactTarget: (
    id: TaskId,
    partitionDir: AbsolutePath,
  ) => Promise<{ targetId: BrowserTargetId }>;
  createTarget: (
    id: TaskId,
    sessionId: StoreId.Session,
    partitionDir: AbsolutePath,
  ) => Promise<{ targetId: BrowserTargetId }>;
  getTargetMeta: (targetId: BrowserTargetId) => null | {
    id: TaskId;
    partitionDir: AbsolutePath;
    // Null for an artifact-preview target, which belongs to a task rather than
    // to any one session.
    sessionId: null | StoreId.Session;
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

/**
 * Second half of an artifact-preview target id. A fixed sentinel rather than an
 * id: session ids are `ses_`-prefixed ULIDs, so the two forms cannot collide.
 */
export const ARTIFACT_TARGET_KEY = "artifact";

// The bridge routing key for a single browser view. Two admissible forms, one
// per guest kind:
//
//   `${id}/${sessionId}`  session guest  -- the task's agent-drivable browser
//   `${id}/artifact`      artifact guest -- the task's HTML artifact preview
//
// The session form delegates to the existing TaskId and StoreId.Session
// validators so a parse failure pinpoints the offending half. Use
// `encodeBrowserTargetId` / `encodeArtifactTargetId` / `decodeBrowserTargetId`
// to construct or parse one; never build by hand.
export const BrowserTargetIdSchema = z
  .custom<
    `${TaskId}/${StoreId.Session}` | `${TaskId}/${typeof ARTIFACT_TARGET_KEY}`
  >()
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
          "BrowserTargetId must be `${id}/${sessionId}` or `${id}/artifact` with both halves non-empty",
      });
      return;
    }
    const taskIdResult = TaskIdSchema.safeParse(val.slice(0, slash));
    if (!taskIdResult.success) {
      for (const issue of taskIdResult.error.issues) {
        ctx.addIssue({ ...issue, path: ["id", ...issue.path] });
      }
    }
    const rest = val.slice(slash + 1);
    if (rest === ARTIFACT_TARGET_KEY) {
      return;
    }
    const sessionResult = StoreId.SessionSchema.safeParse(rest);
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
  defaultTaskTemplateDir: AbsolutePath;
  getAIProviderConfigs: GetProviderConfigs;
  // Read per invocation rather than captured at boot: the flag is a live store
  // the user can toggle from Settings, and this config is built once.
  isExternalBrowserEnabled: () => boolean;
  modelCache: ModelCache;
  nodeExecEnv: Record<string, string>;
  pnpmBinPath: AbsolutePath;
  projectsDir: AbsolutePath;
  registryDir: AbsolutePath;
  rootDir: WorkspaceDir;
  systemSkillsDir: AbsolutePath;
  tasksDir: AbsolutePath;
  trashItem: (path: AbsolutePath) => Promise<void>;
  // Path to the bundled `uv` binary (escape hatch for python/pip/uv commands).
  uvBinPath: AbsolutePath;
  // Base dir for uv's isolated cache/python-install/tool dirs. Lives under the
  // app's userData so a sandboxed `HOME=/` never sends uv writing to the host.
  uvDataDir: AbsolutePath;
  webSearch: WebSearchClient;
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

/**
 * Parse a target id into its kind and parts. Discriminated on `kind` so callers
 * that only make sense for one guest kind -- the CDP bridge and the agent's
 * target list, both of which are session-only -- have to say so.
 */
export function decodeBrowserTargetId(
  targetId: string,
):
  | null
  | { id: TaskId; kind: "artifact" }
  | { id: TaskId; kind: "session"; sessionId: StoreId.Session } {
  const result = BrowserTargetIdSchema.safeParse(targetId);
  if (!result.success) {
    return null;
  }
  const slash = result.data.indexOf("/");
  const id = result.data.slice(0, slash) as TaskId;
  const rest = result.data.slice(slash + 1);
  if (rest === ARTIFACT_TARGET_KEY) {
    return { id, kind: "artifact" };
  }
  return { id, kind: "session", sessionId: rest as StoreId.Session };
}

/** The task's single artifact-preview target id (see ARTIFACT_TARGET_KEY). */
export function encodeArtifactTargetId(id: TaskId): BrowserTargetId {
  return BrowserTargetIdSchema.parse(`${id}/${ARTIFACT_TARGET_KEY}`);
}

export function encodeBrowserTargetId(
  id: TaskId,
  sessionId: StoreId.Session,
): BrowserTargetId {
  return BrowserTargetIdSchema.parse(`${id}/${sessionId}`);
}
