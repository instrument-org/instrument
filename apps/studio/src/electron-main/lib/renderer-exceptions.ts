import { CAPTURE_EXCEPTION_CHANNEL } from "@/shared/constants";
import { type CaptureContext } from "@instrument-org/shared";
import {
  ForwardedException,
  SerializedErrorSchema,
} from "@instrument-org/shared/exceptions";
import { ipcMain } from "electron";
import { z } from "zod";

import {
  buildMainExceptionEvent,
  recordExceptionEvent,
} from "./capture-server-exception";

const CaptureContextSchema = z.object({
  area: z.string().optional(),
  chatId: z.string().optional(),
  componentStack: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  handled: z.boolean().optional(),
  level: z.enum(["error", "fatal"]).optional(),
  mechanism: z.string().optional(),
  messageId: z.string().optional(),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  rpcPath: z.string().optional(),
  sessionId: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
}) satisfies z.ZodType<CaptureContext>;

const CapturePayloadSchema = z.object({
  context: CaptureContextSchema.optional(),
  error: SerializedErrorSchema,
});

/**
 * Take the renderer's captures: each arrives serialized, is built here into
 * an event with this process's contexts and breadcrumbs, and is kept like
 * any other. Answers the event's id and fingerprint, which a report about
 * that exception names it by, or null for a payload that is not one.
 */
export function serveRendererExceptions() {
  ipcMain.handle(CAPTURE_EXCEPTION_CHANNEL, (_event, payload: unknown) => {
    const parsed = CapturePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }
    const event = buildMainExceptionEvent(
      new ForwardedException(parsed.data.error, "renderer"),
      parsed.data.context,
    );
    recordExceptionEvent(event);
    return { fingerprint: event.fingerprint, id: event.id };
  });
}
