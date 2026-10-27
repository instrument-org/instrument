import {
  type FeedbackRequest,
  type ProblemReportRequest,
} from "@/client/atoms/report-dialog";
import { type Condition, type PendingProblem } from "@/shared/problem-reports";
import { captureOnce } from "@/client/lib/capture-exception";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type ExceptionEvent } from "@instrument-org/shared/exceptions";

/** How long the thank-you stays before the report dialog closes on its own. */
export const SENT_CLOSE_MS = 1600;

/**
 * Feedback the person starts: from a chat's menu or a slash command in its
 * reply box, about that chat, or from the Help menu or a new draft, with no
 * chat to send.
 */
export function feedbackReport(
  request: Omit<FeedbackRequest, "kind">,
): FeedbackRequest {
  return { ...request, kind: "feedback" };
}

/** Feedback from the Help menu, about no chat in particular. */
export function helpMenuReport(): FeedbackRequest {
  return feedbackReport({ surface: "help-menu" });
}

/** A crash or hang from an earlier session, waiting in the bell. */
export function pendingProblemReport(
  problem: PendingProblem,
): ProblemReportRequest {
  const crashed = problem.kind === "crash";
  return {
    details: problem.details,
    dialogTitle: crashed
      ? `${APP_NAME} quit unexpectedly`
      : `${APP_NAME} didn't close properly`,
    fingerprint: problem.fingerprint,
    intro: crashed
      ? "It includes the crash, version numbers, recent errors and the end of the app's log. No chats are included."
      : "It probably stopped responding and was quit. The report includes version numbers, recent errors and the end of the app's log. No chats are included.",
    events: problem.events ?? [],
    kind: problem.kind,
    noteLabel: "Comments",
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
}): ProblemReportRequest {
  return {
    dialogTitle: "Send a report",
    error,
    intro:
      "It includes the error, version numbers, recent errors and the app's log, which can name your files and chats.",
    kind: "error",
    noteLabel: "Comments",
    offerAlwaysSend: true,
    onSent,
    reportTitle: errorTitle(error),
    surface,
  };
}

/** Something wrong the app found, reported from where it says so. */
export function conditionReport({
  condition,
  onSent,
  title,
}: {
  condition: Condition;
  onSent?: () => void;
  title: string;
}): ProblemReportRequest {
  return {
    condition,
    dialogTitle: "Send a report",
    focusNote: true,
    intro: `It includes what ${APP_NAME} found, version numbers, recent errors and the app's log, which can name your files and chats.`,
    kind: "error",
    noteLabel: "Comments",
    offerAlwaysSend: false,
    onSent,
    reportTitle: title,
    surface: condition,
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
export async function describeReport(request: ProblemReportRequest): Promise<{
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
