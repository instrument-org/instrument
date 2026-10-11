import { type ReportRequest } from "@/client/atoms/report-dialog";
import { type PendingProblem } from "@/shared/problem-reports";
import { APP_NAME } from "@instrument-org/shared";

/** A report the person starts from the Help menu, with nothing detected. */
export function helpMenuReport(): ReportRequest {
  return {
    dialogTitle: `Report a problem with ${APP_NAME}`,
    focusNote: true,
    intro:
      "This report includes version numbers and the app's recent log, which can mention the names of files and chats you worked on.",
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
      ? `${APP_NAME} quit unexpectedly the last time it ran. This report includes what it recorded about the crash, version numbers, and the last lines of its log. None of your chats are included.`
      : `${APP_NAME} ended without closing the last time it ran, which usually means it stopped responding and was quit. This report includes version numbers and the last lines of its log. None of your chats are included.`,
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
  const text = errorText(error);
  return {
    dialogTitle: `Report this problem to ${APP_NAME}?`,
    error: text,
    intro:
      "This report includes the error, version numbers, and the app's recent log. The log can mention the names of files and chats you worked on, so you can read it under Show details before you send.",
    kind: "error",
    noteLabel: "What were you doing when this happened?",
    offerAlwaysSend: true,
    onSent,
    reportTitle: text.split("\n")[0]?.slice(0, 300) || "Unknown error",
    surface,
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.stack?.includes(error.message)
      ? error.stack
      : `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
}
