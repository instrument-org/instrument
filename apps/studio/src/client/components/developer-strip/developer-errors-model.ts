import {
  type ExceptionEvent,
  type ExceptionValue,
  type StackFrame,
} from "@instrument-org/shared/exceptions";

/** The error an event captured: `exceptions` runs deepest cause first. */
export function capturedOf(event: ExceptionEvent): ExceptionValue | undefined {
  return event.exceptions.at(-1);
}

/** A frame's file with no folders and its line: `chat-row.tsx:142`. */
export function frameLocation(frame: StackFrame) {
  const file = frame.filename.split("/").at(-1) ?? frame.filename;
  return frame.lineno === undefined ? file : `${file}:${frame.lineno}`;
}

/** The app's own frames and the rest, each with the frame that threw first. */
export function splitFrames(exception: ExceptionValue) {
  const frames = exception.frames.toReversed();
  return {
    app: frames.filter((frame) => frame.inApp === true),
    library: frames.filter((frame) => frame.inApp !== true),
  };
}

/** Where a row says it happened: the call it answered, else the app's frame that threw. */
export function whereOf(event: ExceptionEvent) {
  if (event.context.rpcPath) {
    return event.context.rpcPath;
  }
  const captured = capturedOf(event);
  const frame = captured && splitFrames(captured).app[0];
  return frame ? frameLocation(frame) : event.area;
}

/**
 * What happened just before an error, newest first. Leaves out the log lines
 * that report an earlier exception, which repeat a whole event as one message.
 */
export function recentBreadcrumbs(event: ExceptionEvent) {
  return event.breadcrumbs
    .filter((crumb) => !crumb.message.startsWith("[Exception]"))
    .toReversed()
    .slice(0, 8);
}

export function timesLabel(count: number) {
  return count === 1 ? "once" : `${count} times`;
}
