import { studioModalAtom } from "@/client/atoms/studio-modal";
import { type Condition, type ReportKind } from "@/shared/problem-reports";
import { type ExceptionEvent } from "@instrument-org/shared/exceptions";
import { type ChatId } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";

/** One report the dialog offers to send: feedback, or a report of a problem. */
export type ReportRequest = FeedbackRequest | ProblemReportRequest;

/**
 * Feedback the person sends of their own accord: their note, and the chat
 * it is about when there is one, with the diagnostics, each part's files
 * theirs to leave out.
 */
export type FeedbackRequest = {
  /** The chat the feedback is about; none from the Help menu or a new draft. */
  chatId?: ChatId;
  kind: "feedback";
  onSent?: () => void;
  /** Where it started: "chat-menu", "slash-command", "help-menu", ... */
  surface: string;
  /** What the agent wrote up when it offered this, sent as a part of its own. */
  writeup?: { text: string; title: string };
};

/**
 * A report about something that went wrong: a crash, a hang or an error. The
 * details and events are either known already (a crash from the last
 * session) or described by the main process when the dialog opens, led by
 * the exception `error` was captured as, so what Show details shows is what
 * is sent.
 */
export type ProblemReportRequest = {
  /** What the app found wrong that the report is about. */
  condition?: Condition;
  details?: string;
  dialogTitle: string;
  /** The error a screen showed, which the report is about. */
  error?: unknown;
  events?: ExceptionEvent[];
  fingerprint?: string;
  focusNote?: boolean;
  intro: string;
  kind: Exclude<ReportKind, "feedback">;
  noteLabel: string;
  /** Crashes and app errors offer to send without asking from now on. */
  offerAlwaysSend: boolean;
  onSent?: () => void;
  /** The waiting problem this answers, which leaves the bell once sent. */
  pending?: string;
  reportTitle: string;
  surface: string;
};

/** `<ReportDialog />` at the window root reads it. */
export const reportDialogAtom = studioModalAtom<ReportRequest>();

export function openReportDialog(request: ReportRequest) {
  getDefaultStore().set(reportDialogAtom, request);
}
