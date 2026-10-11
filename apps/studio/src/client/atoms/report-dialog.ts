import { studioModalAtom } from "@/client/atoms/studio-modal";
import { type ReportKind } from "@/shared/problem-reports";
import { getDefaultStore } from "jotai";

/**
 * One report the dialog offers to send. The details are either known already
 * (a crash from the last session) or described by the main process from
 * `error` when the dialog opens, so what Show details shows is what is sent.
 */
export type ReportRequest = {
  details?: string;
  dialogTitle: string;
  error?: string;
  fingerprint?: string;
  focusNote?: boolean;
  intro: string;
  kind: ReportKind;
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
