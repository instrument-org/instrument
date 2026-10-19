import { z } from "zod";

/**
 * One captured exception, complete: every error in its chain with parsed
 * frames, what it was doing, where the app was, and what happened just
 * before. Field names follow Sentry's event protocol in camelCase, so an
 * event reads the way a Sentry event does and could be sent on as one.
 * Frames run oldest call first, the frame that threw last, and `exceptions`
 * runs the same way: the deepest cause first, the error that was captured
 * last.
 */

export const ExceptionProcessSchema = z.enum([
  "main",
  "renderer",
  "bash-worker",
]);

export type ExceptionProcess = z.output<typeof ExceptionProcessSchema>;

export const ExceptionLevelSchema = z.enum(["error", "fatal"]);

export const StackFrameSchema = z.object({
  /** The path with the home folder read as `~`. */
  absPath: z.string(),
  colno: z.number().optional(),
  /** The app's own files as `app:///<path in the app>`, the rest as `absPath`. */
  filename: z.string(),
  function: z.string(),
  inApp: z.boolean().optional(),
  lineno: z.number().optional(),
  /** A package's name, or an app file's path without extension or build hash. */
  module: z.string().optional(),
});

export type StackFrame = z.output<typeof StackFrameSchema>;

export const ExceptionMechanismSchema = z.object({
  /** This exception's index in `exceptions` counted from the captured one, 0. */
  exceptionId: z.number(),
  /** An AggregateError or SuppressedError, whose children follow it. */
  isGroup: z.boolean().optional(),
  parentId: z.number().optional(),
  /** Where on its parent it was: `cause`, `errors[0]`, `suppressed`. */
  source: z.string().optional(),
  /** Made from a thrown value that was not an Error. */
  synthetic: z.boolean().optional(),
  /** How it was caught for the captured exception, `chained` for the rest. */
  type: z.string(),
});

export const ExceptionValueSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  frames: z.array(StackFrameSchema),
  mechanism: ExceptionMechanismSchema,
  /** The stack exactly as the error had it, home folder read as `~`. */
  rawStack: z.string(),
  type: z.string(),
  value: z.string(),
});

export type ExceptionValue = z.output<typeof ExceptionValueSchema>;

export const BreadcrumbSchema = z.object({
  category: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  level: z.string(),
  message: z.string(),
  timestamp: z.number(),
});

export type Breadcrumb = z.output<typeof BreadcrumbSchema>;

export const ExceptionContextSchema = z.object({
  chatId: z.string().optional(),
  componentStack: z.string().optional(),
  messageId: z.string().optional(),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  rpcPath: z.string().optional(),
  sessionId: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
});

export type ExceptionContext = z.output<typeof ExceptionContextSchema>;

export const EventContextsSchema = z.object({
  app: z.object({
    channel: z.string(),
    flavor: z.string(),
    packaged: z.boolean(),
    version: z.string(),
  }),
  culture: z.object({ locale: z.string(), timeZone: z.string() }),
  os: z.object({ arch: z.string(), platform: z.string(), version: z.string() }),
  process: z.object({ rssMb: z.number(), uptimeMs: z.number() }),
  runtime: z.object({
    chrome: z.string(),
    electron: z.string(),
    node: z.string(),
  }),
});

export type EventContexts = z.output<typeof EventContextsSchema>;

export const ExceptionEventSchema = z.object({
  /** Which part of the app captured it: `studio`, `workspace`, `auth`, ... */
  area: z.string(),
  breadcrumbs: z.array(BreadcrumbSchema),
  context: ExceptionContextSchema,
  contexts: EventContextsSchema,
  /** How many times this fingerprint was captured; 1 for a fresh event. */
  count: z.number().int().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
  exceptions: z.array(ExceptionValueSchema).min(1),
  /** What makes two events the same problem, line numbers left out. */
  fingerprint: z.string(),
  firstAt: z.number(),
  /** Whether the code that threw caught it, rather than a global handler. */
  handled: z.boolean(),
  id: z.string().regex(/^[0-9a-f]{32}$/),
  lastAt: z.number(),
  level: ExceptionLevelSchema,
  /** How it was caught: `generic`, `rpc`, `uncaughtException`, ... */
  mechanism: z.string(),
  process: ExceptionProcessSchema,
  timestamp: z.number(),
});

export type ExceptionEvent = z.output<typeof ExceptionEventSchema>;

/**
 * An error reduced to what an event is built from, so it can cross a thread
 * or process boundary whole: own properties, its cause, and the errors an
 * AggregateError or SuppressedError carries, each under the name it had there.
 */
export type SerializedError = {
  data?: Record<string, unknown>;
  links?: { error: SerializedError; source: string }[];
  stack?: string;
  synthetic?: boolean;
  type: string;
  value: string;
};

export const SerializedErrorSchema: z.ZodType<SerializedError> = z.lazy(() =>
  z.object({
    data: z.record(z.string(), z.unknown()).optional(),
    links: z
      .array(z.object({ error: SerializedErrorSchema, source: z.string() }))
      .optional(),
    stack: z.string().optional(),
    synthetic: z.boolean().optional(),
    type: z.string(),
    value: z.string(),
  }),
);
