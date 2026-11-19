import {
  type FeedbackDraft,
  feedbackDraftAtom,
  type FeedbackRequest,
  isFeedbackWaiting,
  newFeedbackDraft,
  openReportDialog,
  type ProblemReportRequest,
} from "@/client/atoms/report-dialog";
import {
  type Condition,
  FeedbackTagSchema,
  type PendingProblem,
} from "@/shared/problem-reports";
import { WINDOW_KEPT_FILE } from "@/shared/kept-state";
import { captureOnce } from "@/client/lib/capture-exception";
import { takeKept, writeKept } from "@/client/lib/kept-state";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type ExceptionEvent } from "@instrument-org/shared/exceptions";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";
import { z } from "zod";

/**
 * Throws the feedback draft away, with an Undo that brings it back to its
 * bar along the window's foot when there was anything in it.
 */
export function discardFeedback(draft: FeedbackDraft) {
  const store = getDefaultStore();
  store.set(feedbackDraftAtom, { ...draft, finished: true });
  forgetUnsentFeedback();
  if (isFeedbackWaiting(draft)) {
    toast("Feedback discarded", {
      action: {
        label: "Undo",
        onClick: () => {
          store.set(feedbackDraftAtom, { ...draft, finished: false });
        },
      },
    });
  }
}

/**
 * Feedback sent and not yet confirmed, kept with its window so a quit or a
 * sleep partway through the upload leaves its words for the next launch.
 * Images are left out for their size, and what goes with the note is
 * gathered again when it is sent.
 */
const UNSENT_FEEDBACK_KEY = "unsent-feedback.v1";

const UnsentFeedbackSchema = z.object({
  chatId: ChatIdSchema.optional(),
  note: z.string(),
  sendActions: z.boolean(),
  sendChat: z.boolean(),
  surface: z.string(),
  tag: FeedbackTagSchema.optional(),
  writeups: z.array(z.object({ text: z.string(), title: z.string() })),
});

/** Keeps the draft's words until the service confirms them. */
export function keepUnsentFeedback(draft: FeedbackDraft) {
  writeKept(WINDOW_KEPT_FILE, UNSENT_FEEDBACK_KEY, {
    chatId: draft.chatId ?? draft.captureChat,
    note: draft.note,
    sendActions: draft.sendActions,
    sendChat: draft.sendChat,
    surface: draft.request.surface,
    tag: draft.tag,
    writeups: draft.writeups,
  } satisfies z.input<typeof UnsentFeedbackSchema>);
}

export function forgetUnsentFeedback() {
  writeKept(WINDOW_KEPT_FILE, UNSENT_FEEDBACK_KEY, undefined);
}

/**
 * Puts feedback an earlier launch never finished sending back on its bar,
 * with a toast saying so. It stays kept until it is sent or thrown away, so
 * another quit before then brings it back again.
 */
export function restoreUnsentFeedback() {
  const kept = UnsentFeedbackSchema.safeParse(
    takeKept(WINDOW_KEPT_FILE, UNSENT_FEEDBACK_KEY),
  );
  const store = getDefaultStore();
  if (!kept.success || isFeedbackWaiting(store.get(feedbackDraftAtom))) {
    return;
  }
  const { chatId, note, sendActions, sendChat, surface, tag, writeups } =
    kept.data;
  const request = feedbackReport({ chatId, surface, tag });
  const draft = {
    ...newFeedbackDraft(request),
    note,
    sendActions,
    sendChat,
    writeups,
  };
  store.set(feedbackDraftAtom, draft);
  keepUnsentFeedback(draft);
  toast("Your feedback didn't finish sending.", {
    action: {
      label: "Open",
      onClick: () => {
        openReportDialog(request);
      },
    },
    description: "It's waiting at the bottom of the window.",
  });
}

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
  surface: "not-found" | "route-error" | "window-error";
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
