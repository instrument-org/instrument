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

  export type ToolPart = Pick<
    SessionMessageRelaxedPart.ToolPart,
    "approval" | "preliminary" | "rawInput"
  > &
    (
      | ToolPartInputAvailable
      | ToolPartInputStreaming
      | ToolPartOutputAvailable
      | ToolPartOutputError
    );

  export type ToolPartInputAvailable = ToolUIPart<AISDKTools> & {
    metadata: BaseMetadata;
    state: "input-available";
  };

  export type ToolPartInputStreaming = ToolUIPart<AISDKTools> & {
    metadata: BaseMetadata;
    state: "input-streaming";
  };

  export type ToolPartOutputAvailable = ToolUIPart<AISDKTools> & {
    metadata: ToolPartOutputAvailableMetadata;
    state: "output-available";
  };

  export interface ToolPartOutputAvailableMetadata extends BaseMetadata {
    endedAt: Date;
  }

  export type ToolPartOutputError = ToolUIPart<AISDKTools> & {
    metadata: ToolPartOutputErrorMetadata;
    state: "output-error";
  };

  export interface ToolPartOutputErrorMetadata extends BaseMetadata {
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

  interface ReasoningPartMetadata extends BaseMetadata {
    endedAt?: Date;
  }

  // Coercion from relaxed schema to strongly typed parts
  export const CoercedSchema = SessionMessageRelaxedPart.Schema.transform(
    (data) => renameStoredFolderMountName(data) as Type,
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

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * A folder attached before the mount name said what it was carries `name`.
   *
   * This has to happen here because a stored part is never validated: the
   * relaxed schema types `data` as `unknown` and the coercion is a cast, so the
   * tolerance built into `FolderAttachment.StoredSchema` never runs on history.
   * Without it the field is `undefined` at runtime while the types promise a
   * string, and the next turn of any task with an attached folder throws while
   * assembling its model messages.
   *
   * Every read of a stored part passes through here, so this is the one place
   * that covers the transcript, the model messages, and the exported markdown
   * alike.
   */
  function renameStoredFolderMountName(
    part: SessionMessageRelaxedPart.Type,
  ): SessionMessageRelaxedPart.Type {
    if (part.type !== "data-attachments" || !isRecord(part.data)) {
      return part;
    }
    if (!Array.isArray(part.data.folders)) {
      return part;
    }

    const stored: unknown[] = part.data.folders;
    const renamed = stored.map((folder): unknown => {
      if (!isRecord(folder) || !("name" in folder) || "mountName" in folder) {
        return folder;
      }
      const { name, ...rest } = folder;
      return { ...rest, mountName: name };
    });

    return renamed.some((folder, index) => folder !== stored[index])
      ? { ...part, data: { ...part.data, folders: renamed } }
      : part;
  }
}
