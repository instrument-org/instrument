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
import { SessionMessageDataPart } from "./message-data-part";
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
    metadata: ToolPartMetadata;
    state: "input-available";
  };

  export type ToolPartInputStreaming = ToolUIPart<AISDKTools> & {
    metadata: ToolPartMetadata;
    state: "input-streaming";
  };

  /**
   * `startedAt` is when the runtime began executing the call, which is not when
   * the model asked for it: calls run one at a time off a queue, so a part can
   * sit in `input-available` for as long as everything ahead of it takes. The
   * AI SDK has no state for that wait -- queued and executing are both
   * `input-available` -- and without this the only way to tell them apart is
   * position in the part list, which stops being true the moment anything runs
   * concurrently.
   *
   * Absent means the call has not started. It is also absent on parts written
   * before the field existed, so read it as a positive signal only.
   */
  export interface ToolPartMetadata extends BaseMetadata {
    startedAt?: Date;
  }

  export type ToolPartOutputAvailable = ToolUIPart<AISDKTools> & {
    metadata: ToolPartOutputAvailableMetadata;
    state: "output-available";
  };

  export interface ToolPartOutputAvailableMetadata extends ToolPartMetadata {
    endedAt: Date;
  }

  export type ToolPartOutputError = ToolUIPart<AISDKTools> & {
    metadata: ToolPartOutputErrorMetadata;
    state: "output-error";
  };

  export interface ToolPartOutputErrorMetadata extends ToolPartMetadata {
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

  /**
   * Coercion from the relaxed schema the store round-trips to strongly typed
   * parts.
   *
   * Everything but a data part is a cast, as it always was: the relaxed schema
   * is the shape, and the type adds nothing a stored part could contradict.
   *
   * A data part is different, because its payload is `unknown` to the relaxed
   * schema and is described somewhere else entirely. Casting one meant the type
   * said a payload had fields that a task written a month earlier does not, and
   * every reader believed it -- the transcript went blank on a retired part type
   * and the model-message build threw on a payload written before a field
   * existed. So a data part is parsed here against the schema for its own type,
   * which is also what applies that schema's defaults, and one that cannot be
   * read becomes `data-unknown` rather than a lie about its own shape.
   */
  export const CoercedSchema = SessionMessageRelaxedPart.Schema.transform(
    (data) => data as Type,
  );

  /**
   * The same coercion for a part coming *out* of storage, where a payload that
   * cannot be read is a task older than a schema rather than a bug to reject.
   *
   * Separate from `CoercedSchema` because that one also validates writes, and
   * `setParsedStorageItem` persists a schema's output rather than its input. A
   * repair on that path would write `data-unknown` over a payload that failed
   * validation -- turning a write that used to fail loudly into one that
   * silently destroys what it was asked to store.
   */
  export const FromStorageSchema = SessionMessageRelaxedPart.Schema.transform(
    (data) => (isRelaxedDataPart(data) ? coerceDataPart(data) : (data as Type)),
  );

  export function coerce(part: SessionMessageRelaxedPart.Type): Type {
    return FromStorageSchema.parse(part);
  }

  export function toUIPart({
    metadata: _metadata,
    ...part
  }: Type): UIMessagePart<SessionMessageDataPart.DataParts, AISDKTools> {
    return {
      ...part,
    };
  }

  function coerceDataPart(part: SessionMessageRelaxedPart.DataPart): DataPart {
    const name = part.type.slice("data-".length);
    const parsed = SessionMessageDataPart.parseDataPayload(name, part.data);

    if (parsed.ok) {
      return { ...part, data: parsed.value } as DataPart;
    }

    return {
      ...part,
      data: { originalType: part.type, reason: parsed.reason },
      type: "data-unknown",
    } as DataPart;
  }

  function isRelaxedDataPart(
    part: SessionMessageRelaxedPart.Type,
  ): part is SessionMessageRelaxedPart.DataPart {
    return part.type.startsWith("data-");
  }
}
