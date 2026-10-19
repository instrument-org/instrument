import { type ReportRequest } from "@/client/atoms/report-dialog";
import { type Condition, type PendingProblem } from "@/shared/problem-reports";
import { captureOnce } from "@/client/lib/capture-exception";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type ExceptionEvent } from "@instrument-org/shared/exceptions";

/** A report the person starts from the Help menu, with nothing detected. */
export function helpMenuReport(): ReportRequest {
  return {
    dialogTitle: `Report a problem with ${APP_NAME}`,
    focusNote: true,
    intro:
      "This report includes version numbers, the errors the app recorded recently, and its recent log, which can mention the names of files and chats you worked on.",
    kind: "feedback",
    noteLabel: "What went wrong?",
    offerAlwaysSend: false,
    reportTitle: "Reported from the Help menu",
    surface: "help-menu",
  };
}

/** A crash or hang from an earlier session, waiting in the bell. */
export function pendingProblemReport(problem: PendingProblem): ReportRequest {
  const crashed = problem.kind === "crash";
  return {
    details: problem.details,
    dialogTitle: crashed
      ? `${APP_NAME} quit unexpectedly`
      : `${APP_NAME} didn't close properly`,
    fingerprint: problem.fingerprint,
    intro: crashed
      ? `${APP_NAME} quit unexpectedly the last time it ran. This report includes what it recorded about the crash, other errors from around then, version numbers, and the last lines of its log. None of your chats are included.`
      : `${APP_NAME} ended without closing the last time it ran, which usually means it stopped responding and was quit. This report includes version numbers, the errors it recorded recently, and the last lines of its log. None of your chats are included.`,
    events: problem.events ?? [],
    kind: problem.kind,
    noteLabel: `What were you doing when ${APP_NAME} ${crashed ? "quit" : "stopped"}?`,
    offerAlwaysSend: true,
    pending: problem.fingerprint,
    reportTitle: problem.title,
    surface: problem.kind,
  };
}

/** An error a screen or the window showed the person. */
export function errorReport({
  error,
  onSent,
  surface,
}: {
  error: unknown;
  onSent?: () => void;
  surface: "route-error" | "window-error";
}): ReportRequest {
  return {
    dialogTitle: `Report this problem to ${APP_NAME}?`,
    error,
    intro:
      "This report includes the error, other errors the app recorded recently, version numbers, and its recent log. The log can mention the names of files and chats you worked on, so you can read it under Show details before you send.",
    kind: "error",
    noteLabel: "What were you doing when this happened?",
    offerAlwaysSend: true,
    onSent,
    reportTitle: errorTitle(error),
    surface,
  };
}

/**
 * Something wrong the app found and showed the person, like no sandbox for
 * the programs the agent runs. Titled by what the person read.
 */
export function conditionReport({
  condition,
  onSent,
  surface,
  title,
}: {
  condition: Condition;
  onSent?: () => void;
  surface: "bell" | "settings";
  title: string;
}): ReportRequest {
  return {
    condition,
    dialogTitle: `Report this problem to ${APP_NAME}?`,
    focusNote: true,
    intro: `This report includes what ${APP_NAME} found on this computer, version numbers, the errors it recorded recently, and its recent log. The log can mention the names of files and chats you worked on, so you can read it under Show details before you send.`,
    kind: "error",
    noteLabel: "Anything you'd like us to know?",
    offerAlwaysSend: false,
    onSent,
    reportTitle: title,
    surface: `${condition}-${surface}`,
  };
}

function errorTitle(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "Unknown error";
  return text.split("\n")[0]?.slice(0, 300) || "Unknown error";
}

/**
 * What a report carries, for the dialog to show and send: what the request
 * already has, or what the main process describes, led by the exception
 * the request's error was captured as.
 */
export async function describeReport(request: ReportRequest): Promise<{
  details: string;
  events: ExceptionEvent[];
  fingerprint?: string;
}> {
  if (request.details !== undefined) {
    return {
      details: request.details,
      events: request.events ?? [],
      fingerprint: request.fingerprint,
    };
  }
  const captured =
    request.error === undefined
      ? null
      : await captureOnce(request.error, { mechanism: "report" });
  return rpcClient.problems.describe.call({
    condition: request.condition,
    exception: captured?.fingerprint,
    surface: request.surface,
  });
}
