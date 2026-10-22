import { AIGatewayModel } from "@instrument-org/ai-gateway";
import {
  ProviderErrorKindSchema,
  type SyntheticModelId,
} from "@instrument-org/shared";
import { renderDictatedForModel } from "@instrument-org/shared/dictated-text";
import {
  renderSkillMentionsAsText,
  skillMentionLabel,
} from "@instrument-org/shared/skill-mention";
import {
  convertToModelMessages,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
} from "ai";
import { dedent } from "radashi";
import { z } from "zod";

import { CHAT_FOLDER_NAMES } from "../../constants";
import { appEventModelNote } from "../../lib/app-event-model-text";
import { permissionAnswerModelNote } from "../../lib/permission-answer-model-text";
import { questionAnswerModelNote } from "../../lib/question-answer-model-text";
import { signedInModelNote } from "../../lib/signed-in-model-text";
import { asksModelNote } from "../../lib/asks-model-text";
import { folderChangesModelNote } from "../../lib/folder-changes-model-text";
import { backgroundProcessesModelNote } from "../../lib/background-processes-model-text";
import { dateChangeModelNote } from "../../lib/date-change-model-text";
import { environmentChangeModelNote } from "../../lib/environment-model-text";
import { formatBytes } from "../../lib/format-bytes";
import { fromChatModelText } from "../../lib/from-chat-model-text";
import { isToolPart } from "../../lib/is-tool-part";
import { jobEventModelNote } from "../../lib/job-event-model-text";
import { maxStepsModelNote } from "../../lib/max-steps-model-text";
import { outputLimitModelNote } from "../../lib/output-limit-model-text";
import { memoryModelNote } from "../../lib/memory-model-text";
import { setupNewsModelNote } from "../../lib/setup-news-model-text";
import { messageGapModelNote } from "../../lib/message-gap-model-text";
import { replyModelNote } from "../../lib/reply-model-text";
import { skillChangesModelNote } from "../../lib/skill-changes-model-text";
import { stateNotes } from "../../lib/state-notes";
import {
  withStoppedToolCallModelText,
  withUnansweredToolCallResult,
} from "../../lib/stopped-tool-call-model-text";
import { taskEventModelNote } from "../../lib/task-event-model-text";
import { workspaceHostPath } from "../../lib/workspace-relative-path";
import { TOOL_NAMES } from "../../tools/name";
import { EnvironmentSchema } from "../environment";
import { ToldAppsSchema, ToldDigestsSchema, ToldFoldersSchema } from "../told";
import { StoreId } from "../store-id";
import { SessionMessageDataPart } from "./message-data-part";
import { SessionMessagePart } from "./message-part";

/**
 * Said beside a user message that holds dictated words, which it shows in
 * `<dictated>` tags: they were heard rather than typed, so an odd word may be
 * one that sounds like the word meant.
 */
const DICTATED_MODEL_NOTE =
  "The words in <dictated> tags were spoken and transcribed, so a word that doesn't fit may be one that sounds like the word the user meant.";

export namespace SessionMessage {
  // -----
  // Error
  // -----
  // What the rejection was about, as opposed to `kind`, which says which shape
  // it arrived in. Only the two kinds a provider produces carry one, and it is
  // optional because messages recorded before it existed do not have it.
  const ClassificationSchema = ProviderErrorKindSchema.optional();

  /**
   * Why a request was let go: a stop someone asked for (the user's or the
   * chat's, a newer message superseding the reply, the app quitting), its
   * chunk timeout, or nothing the session could name.
   */
  export const AbortReasonSchema = z.enum([
    "chat",
    "manual",
    "quit",
    "superseded",
    "timeout",
    "unknown",
  ]);
  export type AbortReason = z.output<typeof AbortReasonSchema>;

  const ErrorSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("api-key"),
      message: z.string(),
    }),
    z.object({
      kind: z.literal("aborted"),
      message: z.string(),
      /** Absent on a reply cut off before the reason was kept. */
      reason: AbortReasonSchema.optional(),
    }),
    // A write failed because the disk has no space left.
    z.object({
      kind: z.literal("disk-full"),
      message: z.string(),
    }),
    z.object({
      classification: ClassificationSchema,
      kind: z.literal("unknown"),
      message: z.string(),
    }),
    z.object({
      classification: ClassificationSchema,
      kind: z.literal("api-call"),
      message: z.string(),
      name: z.string(),
      responseBody: z.string().optional(),
      statusCode: z.number().optional(),
      url: z.string(),
    }),
    z.object({
      input: z.string(),
      kind: z.literal("invalid-tool-input"),
      message: z.string(),
    }),
    z.object({
      kind: z.literal("no-such-tool"),
      message: z.string(),
      toolName: z.string(),
    }),
  ]);

  // -----
  // Usage
  // -----
  const OptionalNumberOrNaNSchema = z.union([z.number(), z.nan()]).optional();

  export const UsageSchema = z.object({
    inputTokenDetails: z.object({
      cacheReadTokens: OptionalNumberOrNaNSchema,
      cacheWriteTokens: OptionalNumberOrNaNSchema,
      noCacheTokens: OptionalNumberOrNaNSchema,
    }),
    inputTokens: OptionalNumberOrNaNSchema,
    outputTokenDetails: z.object({
      reasoningTokens: OptionalNumberOrNaNSchema,
      textTokens: OptionalNumberOrNaNSchema,
    }),
    outputTokens: OptionalNumberOrNaNSchema,
    totalTokens: OptionalNumberOrNaNSchema,
  });
  export type Usage = z.output<typeof UsageSchema>;

  // --------
  // Metadata
  // --------
  const BaseMetadataSchema = z.object({
    createdAt: z.date(),
    sessionId: StoreId.SessionSchema,
  });
  const ContextMetadataSchema = BaseMetadataSchema.extend({
    /**
     * The agent that wrote the baseline. A session stored before the agents
     * were one names `main` or `instrument-one`; read for display only.
     */
    agentName: z.string(),
    /**
     * The apps the baseline told a chat's model about, on the message that
     * tells them: what a later app note is measured against. Absent on a
     * task's baseline, which lists none.
     */
    apps: ToldAppsSchema.optional(),
    /**
     * Which shape of the session baseline this message holds
     * (`SESSION_CONTEXT_VERSION`), so a release that puts something new in the
     * baseline reaches sessions that already have one stored.
     *
     * Absent on a message written before the marker existed, which reads as
     * older than any shape a build names and so is rebuilt once.
     */
    contextVersion: z.number().optional(),
    /**
     * The computer the baseline told the model about, on the message that
     * tells it. What a later environment note is measured against. Absent on
     * a baseline from before it was recorded.
     */
    environment: EnvironmentSchema.optional(),
    /**
     * The folders granted in the chat that the baseline told the model it
     * reaches: what a later folder note is measured against.
     */
    folders: ToldFoldersSchema.optional(),
    realRole: z.enum(["system", "user", "assistant"]),
    /**
     * The workspace's own skills as the baseline's catalog listed them, by
     * `skill:<name>` with a fingerprint each: what later skill news is
     * measured against.
     */
    skills: ToldDigestsSchema.optional(),
  });
  const UserMetadataSchema = BaseMetadataSchema.extend({
    /**
     * The draft this message was sent from, by its id. What makes a send
     * crash-safe: the draft's folder is taken away after the message is
     * written, so a launch that finds a message naming a draft still on disk
     * finishes that send rather than sending it again.
     *
     * Absent on a message sent from no draft: a task's, a retry, a line a
     * card asked for.
     */
    fromDraft: z.string().optional(),
  });
  const SystemMetadataSchema = BaseMetadataSchema;
  const AssistantMetadataSchema = BaseMetadataSchema.extend({
    // What a past turn ran on, kept for display. A record this build cannot
    // parse (a provider since renamed or removed) reads as unknown rather
    // than failing the read of the whole session.
    aiGatewayModel: AIGatewayModel.Schema.optional().catch(undefined),
    /**
     * The model record the served id resolves to, snapshotted here for the
     * same reason the requested model is: a name and a provider are only
     * knowable at the moment of the request. Resolved later it would be
     * whatever answers to that id then, and nothing at all once the provider it
     * came from is disconnected.
     *
     * Absent whenever `modelIdServed` is, and also when the id named a model
     * the catalog has no record of, which is ordinary for one released between
     * two refreshes. The id is still the answer in that case.
     */
    aiGatewayModelServed: AIGatewayModel.Schema.optional().catch(undefined),
    completionTokensPerSecond: z.number().optional(),
    endedAt: z.date().optional(),
    error: ErrorSchema.optional(),
    finishedAt: z.date().optional(),
    finishReason: z
      .enum([
        "aborted", // request was aborted
        "stop", // model generated stop sequence
        "length", // model generated maximum number of tokens
        "content-filter", // content filter violation stopped the model
        "tool-calls", // model triggered tool calls
        "error", // model stopped because of an error
        "other", // model stopped for other reasons
        "unknown", // model stopped for other reasons
        "max-steps", // stopped because of max steps
      ])
      // AI SDK v6 still returns undefined sometimes, e.g. with the Vercel Gateway provider
      .catch("unknown"),
    modelId: z.custom<(string & {}) | SyntheticModelId>(
      // Custom string type to allow for TypeScript auto-completion
      (v) => typeof v === "string",
    ),
    /**
     * The provider's own id for the model it served, recorded only when that
     * is a different model from the one the request named.
     *
     * Only when it differs, because the AI SDK fills its response metadata with
     * the requested id when a provider reports nothing, so an id equal to the
     * request is not evidence that anything confirmed it. Google reports
     * nothing at all and would otherwise have every turn claiming a fact we
     * were never told. Recording only the difference makes the field mean one
     * thing: the provider named a model other than the one we asked for.
     *
     * That happens two ways, and `aiGatewayModel` is what tells them apart. A
     * request for a router such as `auto` names a decision rather than a model,
     * so a different answer is the router working. A request naming a model
     * outright and getting another back is a substitution.
     *
     * Absent on a synthetic message, which no provider served, and on one
     * aborted before its first step finished.
     */
    modelIdServed: z.string().optional(),
    msToFinish: z.number().optional(),
    msToFirstChunk: z.number().optional(),
    providerId: z.string(),
    synthetic: z.boolean().optional(), // When created by the workspace
    usage: UsageSchema.optional().catch(undefined),
  });

  export const MetadataSchema = z.union([
    SystemMetadataSchema,
    UserMetadataSchema,
    AssistantMetadataSchema,
  ]);
  export type Metadata = z.output<typeof MetadataSchema>;

  // -------
  // Message
  // -------
  const SystemSchema = z.object({
    id: StoreId.MessageSchema,
    metadata: SystemMetadataSchema,
    role: z.literal("system"),
  });
  const SystemSchemaWithParts = SystemSchema.extend({
    parts: z.array(SessionMessagePart.CoercedSchema),
  });
  export type SystemWithParts = z.output<typeof SystemSchemaWithParts>;

  const AssistantSchema = z.object({
    id: StoreId.MessageSchema,
    metadata: AssistantMetadataSchema,
    role: z.literal("assistant"),
  });
  export type Assistant = z.output<typeof AssistantSchema>;
  const AssistantSchemaWithParts = AssistantSchema.extend({
    parts: z.array(SessionMessagePart.CoercedSchema),
  });
  export type AssistantWithParts = z.output<typeof AssistantSchemaWithParts>;

  export const UserSchema = z.object({
    id: StoreId.MessageSchema,
    metadata: UserMetadataSchema,
    role: z.literal("user"),
  });

  export type User = z.output<typeof UserSchema>;
  export const UserSchemaWithParts = UserSchema.extend({
    parts: z.array(SessionMessagePart.CoercedSchema),
  });
  export type UserWithParts = z.output<typeof UserSchemaWithParts>;

  export const ContextSchema = z.object({
    id: StoreId.MessageSchema,
    metadata: ContextMetadataSchema,
    role: z.literal("session-context"),
  });
  export type Context = z.output<typeof ContextSchema>;
  export const ContextSchemaWithParts = ContextSchema.extend({
    parts: z.array(SessionMessagePart.CoercedSchema),
  });
  export type ContextWithParts = z.output<typeof ContextSchemaWithParts>;

  // -----
  // Union
  // -----
  export const Schema = z.discriminatedUnion("role", [
    UserSchema,
    SystemSchema,
    AssistantSchema,
    ContextSchema,
  ]);

  export const WithPartsSchema = z.discriminatedUnion("role", [
    UserSchemaWithParts,
    SystemSchemaWithParts,
    AssistantSchemaWithParts,
    ContextSchemaWithParts,
  ]);

  export type Type = z.output<typeof Schema>;

  export type WithParts = Type & {
    parts: SessionMessagePart.Type[];
  };

  /**
   * This computer's folders, for the notes on messages written before a path
   * was kept as the shell spelled it: where the chat's record folder keeps
   * what the person sent, as the agent spells it (an upload stored as
   * `attachments/<name>` is named to the model at its full path there, since
   * the agent's shell starts in the work folder, apart from the records).
   * A message that kept its paths is rendered from them alone.
   */
  export interface ModelNoteOptions {
    attachmentsDir?: string;
    /**
     * How a host path is spelled where the agent's shell will read it,
     * which is the same path on macOS and Linux and `/c/Users/...` for
     * `C:\Users\...` on Windows.
     *
     * Passed in rather than imported: this module is shared with the
     * renderer, which has no business knowing about shells, and a file the
     * person sent is now named to the model at its own absolute path
     * rather than at a copy inside the workspace.
     */
    shellPath?: (hostPath: string) => string;
    /**
     * The workspace's root on this computer, which a file attached from
     * inside the workspace is kept relative to (`workspace:/Notes/plan.md`)
     * and is named to the model under.
     */
    workspaceRoot?: string;
  }

  export async function toModelMessages(
    messages: WithParts[],
    tools: ToolSet,
    options: ModelNoteOptions = {},
  ): Promise<ModelMessage[]> {
    return convertToModelMessages(toUIMessages(messages, options), { tools });
  }

  /**
   * One UI message per stored message, in order, with the harness notes each
   * user turn carries. The notes depend on the turns before them, so a caller
   * converting messages one at a time maps the whole list here first.
   */
  export function toUIMessages(
    messages: WithParts[],
    { attachmentsDir, shellPath, workspaceRoot }: ModelNoteOptions = {},
  ): UIMessage[] {
    const stateNote = stateNotes({ shellPath });
    // A max-steps stop is recorded on the assistant message where the run
    // halted, but the note belongs on the user turn that resumes it (injection
    // only runs for user messages). Carry it forward to the next user message.
    let pendingMaxStepsNote: string | undefined;
    // A run that kept running out of room to write is recorded the same way,
    // and carried forward for the same reason.
    let pendingOutputLimitNote: string | undefined;
    // Skills the agent wrote are recorded the same way, on the assistant
    // message of the turn that wrote them. Several turns can run before the
    // user speaks again, so these accumulate rather than replace: each skill is
    // announced once, and none is lost to a later turn that changed a different
    // one.
    const pendingSkillChanges = {
      created: new Set<string>(),
      updated: new Set<string>(),
    };
    return messages.map((message) => {
      const maxStepsPart = message.parts.find(
        (
          part,
        ): part is SessionMessagePart.DataPart & { type: "data-maxSteps" } =>
          part.type === "data-maxSteps",
      );
      if (maxStepsPart) {
        pendingMaxStepsNote = maxStepsModelNote(maxStepsPart.data);
      }

      const outputLimitPart = message.parts.find(
        (
          part,
        ): part is SessionMessagePart.DataPart & {
          type: "data-outputLimit";
        } => part.type === "data-outputLimit",
      );
      if (outputLimitPart) {
        pendingOutputLimitNote = outputLimitModelNote(outputLimitPart.data);
      }

      const setupChangesPart = message.parts.find(
        (
          part,
        ): part is SessionMessagePart.DataPart & {
          type: "data-setupChanges";
        } => part.type === "data-setupChanges",
      );
      // The catalog's correction names the skills there are now; one the turn
      // removed is not in the catalog's way, so the model is not told.
      for (const item of setupChangesPart?.data.changes ?? []) {
        if (item.kind === "skill" && item.change === "added") {
          pendingSkillChanges.created.add(item.name);
        } else if (item.kind === "skill" && item.change === "changed") {
          pendingSkillChanges.updated.add(item.name);
        }
      }

      const filteredParts = message.parts
        .map(withUnansweredToolCallResult)
        .filter(
          (part) =>
            // A call still in input-* (one the provider ran and never
            // answered) makes the AI SDK throw in toModelMessages.
            !isToolPart(part) ||
            part.state === "output-available" ||
            part.state === "output-error",
        )
        .map((part) =>
          SessionMessagePart.toUIPart(withStoppedToolCallModelText(part)),
        );

      let parts = [...filteredParts];

      if (message.role === "user") {
        // Skill mentions are stored in their `[$name](skill:name)` wire form so
        // the transcript can render them as chips; the model should read them as
        // the `/name` the user typed, or it quotes the wire form back verbatim.
        // The footnote below tells it what a `/name` reference means.
        // Dictated words are stored as `[words](dictated:)`; the model reads
        // them in `<dictated>` tags, with a note below saying what that means.
        const hasDictation = parts.some(
          (part) =>
            part.type === "text" &&
            renderDictatedForModel(part.text) !== part.text,
        );
        parts = parts.map((part) =>
          part.type === "text"
            ? {
                ...part,
                text: renderDictatedForModel(
                  renderSkillMentionsAsText(part.text),
                ),
              }
            : part,
        );

        // Words the chat wrote to this task stand where a user's words would,
        // as the message itself rather than as a note beside someone's.
        const fromChatPart = message.parts.find(
          (
            part,
          ): part is SessionMessagePart.DataPart & {
            type: "data-fromChat";
          } => part.type === "data-fromChat",
        );
        if (fromChatPart) {
          parts.unshift({
            text: fromChatModelText(fromChatPart.data),
            type: "text",
          });
        }

        const injectedParts: { text: string; type: "text" }[] = [];
        const inject = (text: null | string | undefined) => {
          if (text) {
            injectedParts.push({ text, type: "text" });
          }
        };

        if (hasDictation) {
          inject(DICTATED_MODEL_NOTE);
        }

        for (const note of USER_TURN_NOTES) {
          inject(
            note(message.parts, {
              attachmentsDir,
              shellPath,
              stateNote,
              workspaceRoot,
            }),
          );
        }

        inject(pendingMaxStepsNote);
        pendingMaxStepsNote = undefined;
        inject(pendingOutputLimitNote);
        pendingOutputLimitNote = undefined;

        const skillChangesNote = skillChangesModelNote({
          created: [...pendingSkillChanges.created],
          updated: [...pendingSkillChanges.updated],
        });
        if (skillChangesNote) {
          inject(skillChangesNote);
          pendingSkillChanges.created.clear();
          pendingSkillChanges.updated.clear();
        }

        // When the harness appends synthetic context (uploaded files, attached
        // folders, browser status, external changes) to a user turn, fence the
        // user's own words in <user_message> tags so the model can tell the
        // human's input apart from harness-injected metadata. Keyed on whether
        // anything was injected, not on a specific source, so new injection
        // sources are covered automatically. Skip when nothing was injected or
        // there is no model-visible user content (e.g. attachments with no
        // typed text).
        if (injectedParts.length > 0) {
          const hasVisibleUserContent = filteredParts.some(
            (part) =>
              (part.type === "text" && part.text.trim().length > 0) ||
              part.type === "file",
          );
          if (hasVisibleUserContent) {
            parts.unshift({ text: "<user_message>", type: "text" });
            parts.push({ text: "</user_message>", type: "text" });
          }
          parts.push(...injectedParts);
        }
      }

      return {
        ...message,
        parts,
        role:
          message.role === "session-context"
            ? message.metadata.realRole
            : message.role,
      };
    });
  }
}

type NamedDataPart<K extends SessionMessageDataPart.Name> =
  SessionMessagePart.DataPart & {
    data: SessionMessageDataPart.DataParts[K];
    type: `data-${K}`;
  };

type NoteContext = SessionMessage.ModelNoteOptions & {
  /** This session's `state` notes so far; see `stateNotes`. */
  stateNote: (part: SessionMessagePart.DataPart) => string | undefined;
};

/**
 * The note a message's part named `name` adds to its user turn; null or
 * nothing when it has none to add.
 */
function noted<K extends SessionMessageDataPart.Name>(
  name: K,
  toText: (
    part: NamedDataPart<K>,
    context: NoteContext,
  ) => null | string | undefined,
) {
  return (parts: readonly SessionMessagePart.Type[], context: NoteContext) => {
    const part = parts.find(
      (candidate): candidate is NamedDataPart<K> =>
        candidate.type === `data-${name}`,
    );
    return part === undefined ? undefined : toText(part, context);
  };
}

/** A `state` part says what its session's sequence of notes lets it say. */
function stated(
  part: SessionMessagePart.DataPart,
  { stateNote }: NoteContext,
): string | undefined {
  return stateNote(part);
}

/**
 * The notes a user turn carries after the user's words, in this order. The
 * order is part of the text every earlier turn is sent as, and so of the
 * prefix a provider caches: a new note is added where it reads best, and the
 * others stay where they are.
 */
const USER_TURN_NOTES = [
  noted("attachments", ({ data }, options) => {
    if (data.files.length === 0) {
      return undefined;
    }
    const attachmentDescriptions = data.files
      .map(
        (file) =>
          `- \`${file.agentPath ?? attachmentPathForModel(file.filePath, options)}\` (${formatBytes(file.size)})`,
      )
      .join("\n");
    return dedent`
      <uploaded_files>
      The user uploaded these files with this message. They are now available at the paths listed below. Assume they are directly relevant to the user's request.
      ${attachmentDescriptions}
      </uploaded_files>
    `;
  }),
  noted("dateChange", ({ data }) => dateChangeModelNote(data)),
  noted("environmentChange", ({ data }) => environmentChangeModelNote(data)),
  noted("messageGap", ({ data }) => messageGapModelNote(data)),
  noted("backgroundProcesses", ({ data }) =>
    backgroundProcessesModelNote(data),
  ),
  noted("browserStatus", stated),
  noted("folderChanges", ({ data }) => folderChangesModelNote(data)),
  noted("skillMentions", ({ data: { names } }) => {
    const mentions = names
      .map(
        (name) =>
          `\`${skillMentionLabel(name)}\` (the installed skill "${name}")`,
      )
      .join(", ");
    const plural = names.length > 1;
    const loadLine = plural
      ? `Load the ones the request needs with \`${TOOL_NAMES.loadSkill}\` before relying on them, and don't describe a skill from its name alone.`
      : `Load it with \`${TOOL_NAMES.loadSkill}\` before relying on it, and don't describe a skill from its name alone.`;
    return `Skill ${plural ? "references" : "reference"} in the message above: ${mentions}. ${loadLine}`;
  }),
  noted("intent", ({ data }) => data.text),
  noted("taskEvent", ({ data }) => taskEventModelNote(data)),
  noted("jobEvent", ({ data }) => jobEventModelNote(data)),
  noted("appEvent", ({ data }) => appEventModelNote(data)),
  noted("permissionAnswer", ({ data }) => permissionAnswerModelNote(data)),
  noted("questionAnswer", ({ data }) => questionAnswerModelNote(data)),
  noted("signedIn", ({ data }) => signedInModelNote(data)),
  noted("viewContext", stated),
  noted("asks", ({ data }) => asksModelNote(data)),
  noted("reply", ({ data }) => replyModelNote(data)),
  noted("workspaceInstructions", stated),
  noted("topic", stated),
  noted("memory", ({ data }) => memoryModelNote(data)),
  noted("setupNews", ({ data }) => setupNewsModelNote(data)),
];

/**
 * A stored attachment path as the model reads it, for a message written
 * before the path was kept as the shell spelled it (`agentPath`): an upload, stored relative
 * to the chat as `attachments/<name>`, at its full path in the record folder
 * when that folder is given; a file kept by its place in the workspace, under
 * the workspace's root on this computer; a file attached where it lay in the
 * work folder as stored, relative to where the shell starts.
 */
function attachmentPathForModel(
  filePath: string,
  { attachmentsDir, shellPath, workspaceRoot }: SessionMessage.ModelNoteOptions,
): string {
  const bare = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  const prefix = `${CHAT_FOLDER_NAMES.attachments}/`;
  if (attachmentsDir !== undefined && bare.startsWith(prefix)) {
    return `${attachmentsDir}/${bare.slice(prefix.length)}`;
  }
  const hostPath =
    workspaceRoot === undefined
      ? filePath
      : (workspaceHostPath(filePath, workspaceRoot) ?? filePath);
  // A file read where the person keeps it is named at its own path, which
  // on Windows is theirs to spell rather than the shell's.
  return shellPath === undefined ? hostPath : shellPath(hostPath);
}
