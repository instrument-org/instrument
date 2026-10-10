import { z } from "zod";

/** What kind of model answered: the column a person filters to tell a reply from a quick choice. */
const AI_USAGE_KINDS = [
  "language",
  "decision",
  "search",
  "image",
] as const;
const AIUsageKindSchema = z.enum(AI_USAGE_KINDS);
export type AIUsageKind = z.output<typeof AIUsageKindSchema>;

/**
 * Why the app made the request. `other` is what a call that named no purpose
 * is recorded as, so a call site that forgot to say shows up as a gap.
 */
const AI_USAGE_PURPOSES = [
  "chat-reply",
  "task-step",
  "chat-title",
  "title-check",
  "web-search",
  "image",
  "emoji-suggestion",
  "topic-suggestion",
  "topic-backfill",
  "chat-search",
  "settings-search",
  "app-search",
  "other",
] as const;
export const AIUsagePurposeSchema = z.enum(AI_USAGE_PURPOSES);
export type AIUsagePurpose = z.output<typeof AIUsagePurposeSchema>;

/** Where a request came from when no chat or task asked for it. */
const AI_USAGE_SURFACES = [
  "agent",
  "apps",
  "chats",
  "draft",
  "settings",
  "topics",
] as const;
export const AIUsageSurfaceSchema = z.enum(AI_USAGE_SURFACES);
export type AIUsageSurface = z.output<typeof AIUsageSurfaceSchema>;

const AI_USAGE_STATUSES = ["finished", "failed", "stopped"] as const;
const AIUsageStatusSchema = z.enum(AI_USAGE_STATUSES);

/** One request, as stored and as the log reads it back. Metadata only: nothing anyone wrote. */
export const AIUsageRowSchema = z.object({
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  chatId: z.string().nullable(),
  connectionId: z.string().nullable(),
  connectionName: z.string().nullable(),
  connectionType: z.string().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  finishReason: z.string().nullable(),
  id: z.string(),
  inputTokens: z.number().nullable(),
  kind: AIUsageKindSchema,
  modelRequested: z.string().nullable(),
  modelServed: z.string().nullable(),
  outputTokens: z.number().nullable(),
  purpose: AIUsagePurposeSchema,
  reasoningTokens: z.number().nullable(),
  responseId: z.string().nullable(),
  startedAt: z.number(),
  status: AIUsageStatusSchema,
  surface: AIUsageSurfaceSchema.nullable(),
  taskId: z.string().nullable(),
  totalTokens: z.number().nullable(),
});
export type AIUsageRow = z.output<typeof AIUsageRowSchema>;

/** A row before it is stored: the id and total are the store's to fill in. */
export type AIUsageEntry = Partial<
  Omit<
    AIUsageRow,
    "id" | "kind" | "purpose" | "startedAt" | "status" | "totalTokens"
  >
> &
  Pick<AIUsageRow, "kind" | "purpose" | "startedAt" | "status">;

/**
 * The filters the log stacks: every field present narrows the rows, and the
 * values listed for one field are alternatives. `origin` is a chat id or a
 * surface, written `chat:<id>` or `surface:<name>`.
 */
export const AIUsageFilterSchema = z.object({
  connection: z.array(z.string()).optional(),
  kind: z.array(AIUsageKindSchema).optional(),
  model: z.array(z.string()).optional(),
  origin: z.array(z.string()).optional(),
  purpose: z.array(AIUsagePurposeSchema).optional(),
  since: z.number().optional(),
  status: z.array(AIUsageStatusSchema).optional(),
  until: z.number().optional(),
});
export type AIUsageFilter = z.output<typeof AIUsageFilterSchema>;

const AI_USAGE_SORT_COLUMNS = [
  "startedAt",
  "kind",
  "purpose",
  "model",
  "totalTokens",
  "durationMs",
] as const;
export const AIUsageSortSchema = z.object({
  column: z.enum(AI_USAGE_SORT_COLUMNS),
  direction: z.enum(["asc", "desc"]),
});
export type AIUsageSort = z.output<typeof AIUsageSortSchema>;

/** The fields the filter menu offers values for, each with how many rows have that value. */
export const AI_USAGE_FACETS = [
  "connection",
  "kind",
  "model",
  "origin",
  "purpose",
  "status",
] as const;
export type AIUsageFacet = (typeof AI_USAGE_FACETS)[number];
