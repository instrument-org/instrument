import { AIGatewayModel } from "@instrument-org/ai-gateway";
import { type SyntheticModelId } from "@instrument-org/shared";
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

import { type AgentName } from "../../agents/types";
import { attachedFolderChangesModelNote } from "../../lib/attached-folder-changes-model-text";
import { attachedFolderMountPoint } from "../../lib/attached-folder-mounts";
import { browserStatusModelNote } from "../../lib/browser-status-model-text";
import { buildAttachedFoldersText } from "../../lib/build-attached-folders-text";
import { externalFileChangesModelNote } from "../../lib/external-file-changes-model-text";
import { formatBytes } from "../../lib/format-bytes";
import { isToolPart } from "../../lib/is-tool-part";
import { maxStepsModelNote } from "../../lib/max-steps-model-text";
import { projectChangesModelNote } from "../../lib/project-changes-model-text";
import { TOOL_NAMES } from "../../tools/name";
import { StoreId } from "../store-id";
import { SessionMessagePart } from "./message-part";

export namespace SessionMessage {
  // -----
  // Error
  // -----
  const ErrorSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("api-key"),
      message: z.string(),
    }),
    z.object({
      kind: z.literal("aborted"),
      message: z.string(),
    }),
    z.object({
      kind: z.literal("unknown"),
      message: z.string(),
    }),
    z.object({
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
    agentName: z.custom<AgentName>(),
    realRole: z.enum(["system", "user", "assistant"]),
  });
  const SystemMetadataSchema = BaseMetadataSchema;
  const UserMetadataSchema = BaseMetadataSchema;
  const AssistantMetadataSchema = BaseMetadataSchema.extend({
    aiGatewayModel: AIGatewayModel.Schema.optional(),
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
      // eslint-disable-next-line unicorn/prefer-top-level-await
      .catch("unknown"),
    modelId: z.custom<(string & {}) | SyntheticModelId>(
      // Custom string type to allow for TypeScript auto-completion
      (v) => typeof v === "string",
    ),
    msToFinish: z.number().optional(),
    msToFirstChunk: z.number().optional(),
    providerId: z.string(),
    synthetic: z.boolean().optional(), // When created by the workspace
    // eslint-disable-next-line unicorn/prefer-top-level-await
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

  export async function toModelMessages(
    messages: WithParts[],
    tools: ToolSet,
  ): Promise<ModelMessage[]> {
    let previousBrowserStatusNote: string | undefined;
    // A max-steps stop is recorded on the assistant message where the run
    // halted, but the note belongs on the user turn that resumes it (injection
    // only runs for user messages). Carry it forward to the next user message.
    let pendingMaxStepsNote: string | undefined;

    const uiMessages: UIMessage[] = messages.map((message) => {
      const maxStepsPart = message.parts.find(
        (
          part,
        ): part is SessionMessagePart.DataPart & { type: "data-maxSteps" } =>
          part.type === "data-maxSteps",
      );
      if (maxStepsPart) {
        pendingMaxStepsNote = maxStepsModelNote(maxStepsPart.data);
      }

      const filteredParts = message.parts
        .filter(
          (part) =>
            // Must filter or the AI SDK will throw an error in toModelMessages
            !isToolPart(part) ||
            // If the state is input-*, AI SDK errors in converting to model messages
            part.state === "output-available" ||
            part.state === "output-error",
        )
        .map((part) => SessionMessagePart.toUIPart(part));

      let parts = [...filteredParts];

      if (message.role === "user") {
        // Skill mentions are stored in their `[$name](skill:name)` wire form so
        // the transcript can render them as chips; the model should read them as
        // the `/name` the user typed, or it quotes the wire form back verbatim.
        // The footnote below tells it what a `/name` reference means.
        parts = parts.map((part) =>
          part.type === "text"
            ? { ...part, text: renderSkillMentionsAsText(part.text) }
            : part,
        );

        const injectedParts: { text: string; type: "text" }[] = [];

        const attachmentsPart = message.parts.find(
          (part) => part.type === "data-attachments",
        );

        if (attachmentsPart) {
          if (attachmentsPart.data.files.length > 0) {
            const attachmentDescriptions = attachmentsPart.data.files
              .map((file) => {
                const formattedSize = formatBytes(file.size);
                return `- ${file.filePath} (${formattedSize})`;
              })
              .join("\n");

            const attachmentText = dedent`
              <uploaded_files>
              The user uploaded these files with this message. They are now available in the task at the paths listed below. Assume they are directly relevant to the user's request.
              ${attachmentDescriptions}
              </uploaded_files>
            `;

            injectedParts.push({ text: attachmentText, type: "text" });
          }

          // Project folders ride along in the attachments part but are surfaced
          // to the model as standing project context (see the main agent's
          // context message), so exclude them here to avoid re-announcing them as
          // folders the user attached with this message.
          const userAttachedFolders = (
            attachmentsPart.data.folders ?? []
          ).filter((folder) => folder.source !== "project");
          if (userAttachedFolders.length > 0) {
            const folderAttachmentText = buildAttachedFoldersText({
              folders: userAttachedFolders.map((folder) => ({
                access: folder.access,
                mountPoint: attachedFolderMountPoint(folder.name),
                path: folder.path,
              })),
              intro: `The user attached these external folders with this message. They are mounted in the task and reachable with the bash tool. Assume they are directly relevant to the user's request.`,
            });

            injectedParts.push({ text: folderAttachmentText, type: "text" });
          }
        }

        const browserStatusPart = message.parts.find(
          (part) => part.type === "data-browserStatus",
        );
        if (browserStatusPart) {
          const note = browserStatusModelNote(browserStatusPart.data);
          if (note !== previousBrowserStatusNote) {
            injectedParts.push({ text: note, type: "text" });
          }
          previousBrowserStatusNote = note;
        }

        const externalChangesPart = message.parts.find(
          (
            part,
          ): part is SessionMessagePart.DataPart & {
            type: "data-externalFileChanges";
          } => part.type === "data-externalFileChanges",
        );
        if (externalChangesPart) {
          const note = externalFileChangesModelNote(externalChangesPart.data);
          if (note) {
            injectedParts.push({ text: note, type: "text" });
          }
        }

        const folderChangesPart = message.parts.find(
          (
            part,
          ): part is SessionMessagePart.DataPart & {
            type: "data-attachedFolderChanges";
          } => part.type === "data-attachedFolderChanges",
        );
        if (folderChangesPart) {
          const note = attachedFolderChangesModelNote(folderChangesPart.data);
          if (note) {
            injectedParts.push({ text: note, type: "text" });
          }
        }

        const projectChangesPart = message.parts.find(
          (
            part,
          ): part is SessionMessagePart.DataPart & {
            type: "data-projectChanges";
          } => part.type === "data-projectChanges",
        );
        if (projectChangesPart) {
          const note = projectChangesModelNote(projectChangesPart.data);
          if (note) {
            injectedParts.push({ text: note, type: "text" });
          }
        }

        const skillMentionsPart = message.parts.find(
          (
            part,
          ): part is SessionMessagePart.DataPart & {
            type: "data-skillMentions";
          } => part.type === "data-skillMentions",
        );
        if (skillMentionsPart) {
          const names = skillMentionsPart.data.names;
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
          injectedParts.push({
            text: `Skill ${plural ? "references" : "reference"} in the message above: ${mentions}. ${loadLine}`,
            type: "text",
          });
        }

        const intentPart = message.parts.find(
          (
            part,
          ): part is SessionMessagePart.DataPart & {
            type: "data-intent";
          } => part.type === "data-intent",
        );
        if (intentPart) {
          injectedParts.push({ text: intentPart.data.text, type: "text" });
        }

        if (pendingMaxStepsNote) {
          injectedParts.push({ text: pendingMaxStepsNote, type: "text" });
          pendingMaxStepsNote = undefined;
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
    return convertToModelMessages(uiMessages, { tools });
  }
}
