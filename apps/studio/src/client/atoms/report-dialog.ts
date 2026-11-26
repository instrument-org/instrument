import { studioModalAtom } from "@/client/atoms/studio-modal";
import { type Capture } from "@/shared/captures";
import {
  type Condition,
  type FeedbackTag,
  type ReportKind,
} from "@/shared/problem-reports";
import { type ExceptionEvent } from "@instrument-org/shared/exceptions";
import { type ChatId } from "@instrument-org/workspace/client";
import { atom, getDefaultStore } from "jotai";

/** One report the dialog offers to send: feedback, or a report of a problem. */
export type ReportRequest = FeedbackRequest | ProblemReportRequest;

/**
 * Feedback the person sends of their own accord: their note, and the chat
 * it is about when there is one, with the diagnostics, each part's files
 * theirs to leave out.
 */
export type FeedbackRequest = {
  /** Captures attached as it opens, as from a capture's own thumbnail. */
  captures?: readonly Capture[];
  /** The chat the feedback is about; none from the Help menu or a new draft. */
  chatId?: ChatId;
  kind: "feedback";
  onSent?: () => void;
  /** Where it started: "chat-menu", "slash-command", "help-menu", ... */
  surface: string;
  /** The tag picked ahead of time: the card's answer, or a bug for the agent's report. */
  tag?: FeedbackTag;
  /** Pictures attached as it opens, such as the agent's picture of the window. */
  pictures?: readonly File[];
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

/** An image the person attached: a picked, pasted or dropped file, or a developer capture. */
export type AttachedImage = {
  /** The capture it is, which says where it was taken. */
  capture?: Capture;
  file: Blob;
  id: string;
  name: string;
  size: number;
  /** A data URL, so a picture shown needs nothing released when it goes. */
  src: string;
};

/** A write-up that goes with feedback: the agent's account of what went wrong, or an error's details. */
export type FeedbackWriteup = NonNullable<FeedbackRequest["writeup"]>;

/**
 * The feedback being written, kept apart from the dialog so it outlives
 * the dialog going away: put down to its bar along the window's foot, it
 * comes back as it was left. One at a time, so feedback asked for while one
 * waits goes into that one (`withRequest`).
 */
export type FeedbackDraft = {
  /** A chat a capture was taken in, when the dialog opened about none. */
  captureChat: ChatId | undefined;
  /** The chat the feedback is about, from the request that started it or the first one that named one. */
  chatId: ChatId | undefined;
  /** Sent or thrown away: no longer waiting, though the dialog may still be leaving with it. */
  finished: boolean;
  images: AttachedImage[];
  note: string;
  /** Feedback about another chat asked for while this one waited, until the person keeps this one or starts that one. */
  offered: FeedbackRequest | undefined;
  /** What each request that went in asked to hear once it is sent. */
  onSent: (() => void)[];
  /** Captures a request brought that are not attached yet. */
  pendingCaptures: Capture[];
  /** Pictures a request brought that are not attached yet. */
  pendingPictures: File[];
  /** The request that started it, which the dialog is open on while it shows this draft. */
  request: FeedbackRequest;
  /** Offered, never assumed: it is about more than what is being reported. */
  sendActions: boolean;
  sendChat: boolean;
  tag: FeedbackTag | undefined;
  writeups: FeedbackWriteup[];
};

export function newFeedbackDraft(request: FeedbackRequest): FeedbackDraft {
  return {
    captureChat: undefined,
    chatId: request.chatId,
    finished: false,
    images: [],
    note: "",
    offered: undefined,
    onSent: request.onSent ? [request.onSent] : [],
    pendingCaptures: [...(request.captures ?? [])],
    pendingPictures: [...(request.pictures ?? [])],
    request,
    sendActions: false,
    sendChat: true,
    tag: request.tag,
    writeups: request.writeup ? [request.writeup] : [],
  };
}

/**
 * The draft with what another request brings folded in: its captures,
 * pictures and write-up added, its chat and tag taken where the draft has
 * none, and its `onSent` heard too. A request about another chat than the draft's is held
 * as `offered` instead, since what it brings is about that chat.
 */
function withRequest(
  draft: FeedbackDraft,
  request: FeedbackRequest,
): FeedbackDraft {
  const chat = draft.chatId ?? draft.captureChat;
  if (request.chatId && chat && request.chatId !== chat) {
    return { ...draft, offered: request };
  }
  const { writeup } = request;
  return {
    ...draft,
    chatId: draft.chatId ?? request.chatId,
    offered: undefined,
    onSent: request.onSent ? [...draft.onSent, request.onSent] : draft.onSent,
    pendingCaptures: [...draft.pendingCaptures, ...(request.captures ?? [])],
    pendingPictures: [...draft.pendingPictures, ...(request.pictures ?? [])],
    tag: draft.tag ?? request.tag,
    writeups:
      writeup &&
      !draft.writeups.some(
        (each) => each.title === writeup.title && each.text === writeup.text,
      )
        ? [...draft.writeups, writeup]
        : draft.writeups,
  };
}

/** Whether the draft has something in it worth coming back to. */
export function isFeedbackWaiting(
  draft: FeedbackDraft | null,
): draft is FeedbackDraft {
  return (
    draft !== null &&
    !draft.finished &&
    (draft.note.trim() !== "" ||
      draft.images.length > 0 ||
      draft.pendingCaptures.length > 0 ||
      draft.pendingPictures.length > 0 ||
      draft.writeups.length > 0)
  );
}

export const feedbackDraftAtom = atom<FeedbackDraft | null>(null);

/** The draft its bar shows: one waiting while its dialog is not up. */
export const feedbackBarAtom = atom((get) => {
  const draft = get(feedbackDraftAtom);
  return isFeedbackWaiting(draft) && get(reportDialogAtom)?.kind !== "feedback"
    ? draft
    : null;
});

/**
 * Opens the report dialog. Feedback asked for while a draft waits brings
 * that draft back with what the request brings folded in, rather than
 * starting a second one over it.
 */
export function openReportDialog(request: ReportRequest) {
  const store = getDefaultStore();
  if (request.kind === "feedback") {
    const draft = store.get(feedbackDraftAtom);
    if (isFeedbackWaiting(draft)) {
      if (request !== draft.request) {
        store.set(feedbackDraftAtom, withRequest(draft, request));
      }
      store.set(reportDialogAtom, draft.request);
      return;
    }
    store.set(feedbackDraftAtom, newFeedbackDraft(request));
  }
  store.set(reportDialogAtom, request);
}
