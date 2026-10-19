import { type ExceptionEvent, type StackFrame } from "./schema";

/** How many of an event's last breadcrumbs its readable form lists. */
const READABLE_BREADCRUMBS = 20;

/**
 * An event as a person reads a crash: a line saying how it was caught and how
 * often, then each error in its chain as V8 prints a stack (the frame that
 * threw first), then the context, data and last breadcrumbs it carries.
 */
export function formatExceptionEvent(
  event: ExceptionEvent,
  { breadcrumbs = READABLE_BREADCRUMBS }: { breadcrumbs?: number } = {},
): string {
  const lines = [headline(event)];
  // Exceptions run deepest first; read from the captured one down.
  for (const exception of event.exceptions.toReversed()) {
    const { source } = exception.mechanism;
    const label = source
      ? source === "cause"
        ? "Caused by: "
        : `[${source}] `
      : "";
    lines.push(`${label}${exception.type}: ${exception.value}`);
    lines.push(...exception.frames.toReversed().map(formatFrame));
    if (exception.data) {
      lines.push(`  data: ${JSON.stringify(exception.data)}`);
    }
  }
  const context = Object.entries(event.context).filter(
    ([key]) => key !== "componentStack",
  );
  if (context.length > 0) {
    lines.push(
      `Context: ${context.map(([key, value]) => `${key}=${value}`).join(", ")}`,
    );
  }
  if (event.context.componentStack) {
    lines.push(`Component stack:${event.context.componentStack.trimEnd()}`);
  }
  if (event.data) {
    lines.push(`Data: ${JSON.stringify(event.data)}`);
  }
  const crumbs = event.breadcrumbs.slice(-breadcrumbs);
  if (crumbs.length > 0) {
    lines.push("Breadcrumbs:");
    lines.push(
      ...crumbs.map(
        (crumb) =>
          `  ${new Date(crumb.timestamp).toISOString()} [${crumb.category}] ${crumb.level}: ${crumb.message}`,
      ),
    );
  }
  return lines.join("\n");
}

function headline(event: ExceptionEvent): string {
  const how = [
    event.area,
    event.mechanism,
    event.handled ? "handled" : "unhandled",
    event.level,
    event.process,
  ].join(", ");
  const when =
    event.count > 1
      ? `${event.count} times, ${new Date(event.firstAt).toISOString()} to ${new Date(event.lastAt).toISOString()}`
      : new Date(event.lastAt).toISOString();
  return `[${how}] ${when}, fingerprint ${event.fingerprint}`;
}

function formatFrame(frame: StackFrame): string {
  const position = [frame.filename, frame.lineno, frame.colno]
    .filter((part) => part !== undefined)
    .join(":");
  return frame.function === "?"
    ? `  at ${position}`
    : `  at ${frame.function} (${position})`;
}
