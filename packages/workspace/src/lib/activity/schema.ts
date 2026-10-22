import { z } from "zod";

/** What kind of model answered: the column a person filters to tell a reply from a quick choice. */
const ACTIVITY_KINDS = ["language", "decision", "search", "image"] as const;
export const ActivityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.output<typeof ActivityKindSchema>;

/**
 * Why the app made the request. `other` is what a call that named no purpose
 * is recorded as, so a call site that forgot to say shows up as a gap.
 */
const ACTIVITY_PURPOSES = [
  "chat",
  "task",
  "chat-title",
  "title-check",
  "web-search",
  "x-search",
  "image",
  "emoji-suggestion",
  "topic-suggestion",
  "topic-backfill",
  "chat-search",
  "settings-search",
  "app-search",
  "other",
] as const;
export const ActivityPurposeSchema = z.enum(ACTIVITY_PURPOSES);
export type ActivityPurpose = z.output<typeof ActivityPurposeSchema>;

/** Where a request came from when no chat or task asked for it. */
const ACTIVITY_SURFACES = [
  "agent",
  "apps",
  "chats",
  "draft",
  "settings",
  "topics",
] as const;
export const ActivitySurfaceSchema = z.enum(ACTIVITY_SURFACES);
export type ActivitySurface = z.output<typeof ActivitySurfaceSchema>;

/**
 * How a request ended. `limited` is one a usage limit refused (a plan, a usage
 * window), which went as it should rather than wrong.
 */
const ACTIVITY_STATUSES = ["finished", "failed", "limited", "stopped"] as const;
export const ActivityStatusSchema = z.enum(ACTIVITY_STATUSES);

/** One request, as its device logged it and the index reads it back. Metadata only: nothing anyone wrote. */
export const ActivityRowSchema = z.object({
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  chatId: z.string().nullable(),
  connectionName: z.string().nullable(),
  connectionType: z.string().nullable(),
  /**
   * The device that made the request, by its id; none for a row an earlier
   * build recorded, until this device writes it into its own log.
   */
  device: z.string().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  finishReason: z.string().nullable(),
  id: z.string(),
  /** The quality an image request was generated at, when it was said. */
  imageQuality: z.string().nullable(),
  inputTokens: z.number().nullable(),
  kind: ActivityKindSchema,
  modelRequested: z.string().nullable(),
  modelServed: z.string().nullable(),
  outputTokens: z.number().nullable(),
  purpose: ActivityPurposeSchema,
  reasoningTokens: z.number().nullable(),
  responseId: z.string().nullable(),
  startedAt: z.number(),
  status: ActivityStatusSchema,
  surface: ActivitySurfaceSchema.nullable(),
  sessionId: z.string().nullable(),
  totalTokens: z.number().nullable(),
});
export type ActivityRow = z.output<typeof ActivityRowSchema>;

/** A row before it is stored: the id, the device and the total are the store's to fill in. */
export type ActivityEntry = Partial<
  Omit<
    ActivityRow,
    | "device"
    | "id"
    | "kind"
    | "purpose"
    | "startedAt"
    | "status"
    | "totalTokens"
  >
> &
  Pick<ActivityRow, "kind" | "purpose" | "startedAt" | "status">;

/**
 * The filters the log stacks: every field present narrows the rows, and the
 * values listed for one field are alternatives. `origin` is a chat id or a
 * surface, written `chat:<id>` or `surface:<name>`.
 */
export const ActivityFilterSchema = z.object({
  connection: z.array(z.string()).optional(),
  kind: z.array(ActivityKindSchema).optional(),
  model: z.array(z.string()).optional(),
  origin: z.array(z.string()).optional(),
  purpose: z.array(ActivityPurposeSchema).optional(),
  since: z.number().optional(),
  status: z.array(ActivityStatusSchema).optional(),
  until: z.number().optional(),
});
export type ActivityFilter = z.output<typeof ActivityFilterSchema>;

const ACTIVITY_SORT_COLUMNS = [
  "startedAt",
  "kind",
  "purpose",
  "model",
  "totalTokens",
  "durationMs",
] as const;
export const ActivitySortSchema = z.object({
  column: z.enum(ACTIVITY_SORT_COLUMNS),
  direction: z.enum(["asc", "desc"]),
});
export type ActivitySort = z.output<typeof ActivitySortSchema>;

/** The fields the filter menu offers values for, each with how many rows have that value. */
export const ACTIVITY_FACETS = [
  "connection",
  "kind",
  "model",
  "origin",
  "purpose",
  "status",
] as const;
export type ActivityFacet = (typeof ACTIVITY_FACETS)[number];
