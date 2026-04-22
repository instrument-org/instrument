import {
  type DataUIPart,
  type FileUIPart,
  type ReasoningUIPart,
  type SourceDocumentUIPart,
  type SourceUrlUIPart,
  type StepStartUIPart,
  type TextUIPart,
  type ToolUIPart,
  type UIMessagePart,
} from "ai";

import { type AISDKTools } from "../../tools/all";
import { type StoreId } from "../store-id";
import { type SessionMessageDataPart } from "./message-data-part";
import { SessionMessageRelaxedPart } from "./message-relaxed-part";

interface BaseMetadata extends Record<string, unknown> {
  createdAt: Date;
  id: StoreId.Part;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}

export namespace SessionMessagePart {
  export type AgentBrowserCommandContextItem =
    | AgentBrowserCommandContextItemComplete
    | AgentBrowserCommandContextItemPending;

  export interface AgentBrowserCommandContextItemComplete
    extends AgentBrowserCommandContextItemBase {
    endedAt: Date;
    // Captured after the command finishes. Optional only because a CDP
    // capture can fail mid-flight (e.g. the debugger detached because the
    // target closed). When absent, `error` should explain why.
    endScreenshot?: AgentBrowserScreenshot;
    error?: string;
    status: "complete";
  }

  export interface AgentBrowserCommandContextItemPending
    extends AgentBrowserCommandContextItemBase {
    status: "pending";
  }

  export interface AgentBrowserScreenshot {
    path: string;
    title?: string;
    url: string;
  }

  export type DataPart = DataUIPart<SessionMessageDataPart.DataParts> & {
    metadata: BaseMetadata;
  };

  export type FilePart = FileUIPart & {
    metadata: BaseMetadata;
  };

  export type ReasoningPart = ReasoningUIPart & {
    metadata: ReasoningPartMetadata;
  };

  export type SourceDocumentPart = SourceDocumentUIPart & {
    metadata: BaseMetadata;
  };

  export type SourceUrlPart = SourceUrlUIPart & {
    metadata: BaseMetadata;
  };

  export type StepStartPart = StepStartUIPart & {
    metadata: StepStartPartMetadata;
  };

  export interface StepStartPartMetadata extends BaseMetadata {
    stepCount: number;
  }

  // Part types with strongly typed metadata
  export type TextPart = TextUIPart & {
    metadata: TextPartMetadata;
  };

  // Metadata types for each specific part type
  export interface TextPartMetadata extends BaseMetadata {
    endedAt?: Date;
  }

  export type ToolPart =
    | ToolPartInputAvailable
    | ToolPartInputStreaming
    | ToolPartOutputAvailable
    | ToolPartOutputError;

  export interface ToolPartBaseMetadata extends BaseMetadata {
    contextItems?: ToolPartContextItem[];
  }

  // Polymorphic context items appended to tool parts as a side channel by the
  // tool's environment. Not validated by Zod, since they're written by us, not
  // by the agent. Each item carries `createdAt` so the UI can order them
  // chronologically without depending on array order.
  export type ToolPartContextItem = AgentBrowserCommandContextItem;

  export type ToolPartInputAvailable = ToolUIPart<AISDKTools> & {
    metadata: ToolPartBaseMetadata;
    state: "input-available";
  };

  export type ToolPartInputStreaming = ToolUIPart<AISDKTools> & {
    metadata: ToolPartBaseMetadata;
    state: "input-streaming";
  };

  export type ToolPartOutputAvailable = ToolUIPart<AISDKTools> & {
    metadata: ToolPartOutputAvailableMetadata;
    state: "output-available";
  };

  export interface ToolPartOutputAvailableMetadata
    extends ToolPartBaseMetadata {
    endedAt: Date;
  }

  export type ToolPartOutputError = ToolUIPart<AISDKTools> & {
    metadata: ToolPartOutputErrorMetadata;
    state: "output-error";
  };

  export interface ToolPartOutputErrorMetadata extends ToolPartBaseMetadata {
    endedAt: Date;
  }

  // Union of all part types
  export type Type =
    | DataPart
    | FilePart
    | ReasoningPart
    | SourceDocumentPart
    | SourceUrlPart
    | StepStartPart
    | TextPart
    | ToolPart;

  interface AgentBrowserCommandContextItemBase {
    createdAt: Date;
    id: StoreId.PartContextItem;
    kind: "agent-browser-command";
    // Captured before the command runs so the agent and the user can see
    // the page state the command was acting on. Mandatory: an observation
    // that couldn't capture a starting screenshot is never created.
    startScreenshot: AgentBrowserScreenshot;
    // The agent-browser sub-invocation as the agent typed it (e.g.
    // "navigate https://example.com" or "click #submit"), without the
    // `agent-browser` prefix - the kind already discriminates that.
    subcommand: string;
  }

  interface ReasoningPartMetadata extends BaseMetadata {
    endedAt?: Date;
  }

  // Coercion from relaxed schema to strongly typed parts
  export const CoercedSchema = SessionMessageRelaxedPart.Schema.transform(
    (data) => data as Type,
  );

  export function coerce(part: SessionMessageRelaxedPart.Type): Type {
    return CoercedSchema.parse(part);
  }

  export function toUIPart({
    metadata: _metadata,
    ...part
  }: Type): UIMessagePart<SessionMessageDataPart.DataParts, AISDKTools> {
    return {
      ...part,
    };
  }
}
