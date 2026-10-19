import { type CaptureContext } from "@instrument-org/shared";
import {
  serializeError,
  STACK_FRAME_LIMIT,
} from "@instrument-org/shared/exceptions";
import type { ErrorInfo } from "react";

/** How the main process names a captured exception: its event and its problem. */
export type CapturedException = { fingerprint: string; id: string };

const captures = new WeakMap<object, Promise<CapturedException | null>>();

/**
 * Capture an exception from the renderer: serialized here, then built into
 * an event and kept by the main process, the same as one thrown there. Also
 * written to the console. Use for failures that should never happen, not
 * for errors the screen already explains.
 */
export function captureException(error: unknown, context?: CaptureContext) {
  void captureOnce(error, context);
}

/**
 * Capture an exception unless it already was, answering how the main
 * process names it, so a report about it can carry that event. Null outside
 * Electron or when the main process would not take it.
 */
export function captureOnce(
  error: unknown,
  context?: CaptureContext,
): Promise<CapturedException | null> {
  const key = typeof error === "object" && error !== null ? error : undefined;
  const earlier = key && captures.get(key);
  if (earlier) {
    return earlier;
  }
  console.error(error);
  const send = window.api.captureException;
  const captured = send
    ? send({ context, error: serializeError(error) }).catch(() => null)
    : Promise.resolve(null);
  if (key) {
    captures.set(key, captured);
  }
  return captured;
}

/**
 * Capture a render or lifecycle error an error boundary caught (a router's
 * route boundary or the window's own), with the component stack it saw.
 */
export function captureComponentError(error: unknown, errorInfo: ErrorInfo) {
  captureException(error, {
    componentStack: errorInfo.componentStack ?? undefined,
    mechanism: "error-boundary",
  });
}

/**
 * Capture what nothing in the window caught: an uncaught throw and a
 * rejection nobody handled, both as unhandled. Also gives the renderer's
 * stacks as many frames as an event keeps.
 */
export function initExceptionCapture() {
  Error.stackTraceLimit = STACK_FRAME_LIMIT;
  window.addEventListener("error", (event) => {
    captureException(event.error ?? event.message, {
      handled: false,
      mechanism: "onerror",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    captureException(event.reason, {
      handled: false,
      mechanism: "onunhandledrejection",
    });
  });
}
