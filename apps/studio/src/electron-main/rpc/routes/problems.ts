import { ChatIdSchema, liveRead } from "@instrument-org/workspace/electron";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  clearPendingProblem,
  describeFeedback,
  describeProblem,
  FeedbackImageRefusedError,
  FeedbackTooLargeError,
  feedbackReportInput,
  pendingProblemsAsShown,
  readFeedbackImages,
  sendReport,
} from "@/electron-main/lib/problem-reports";
import { MAX_FEEDBACK_IMAGES } from "@/shared/feedback-images";
import { findExceptionEvent } from "@/electron-main/lib/exception-store";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { signedInPeople } from "@/electron-main/lib/get-signed-in-user";
import { describeCondition } from "@/electron-main/lib/notices";
import {
  ConditionSchema,
  FeedbackItemSchema,
  ReportInputSchema,
} from "@/shared/problem-reports";
import { z } from "zod";

const live = {
  // The problems from earlier sessions waiting in the bell, read again when
  // an account signs in or out, since that changes what they leave out.
  pending: base.handler(async function* ({ signal }) {
    const changes = [
      "problems.updated",
      "session.apiBearerToken.updated",
      "chatgpt-account.updated",
      "grok-account.updated",
      "claude-account.updated",
    ] as const;
    yield* liveRead({
      changes: changes.map((name) => publisher.subscribe(name, { signal })),
      read: pendingProblemsAsShown,
    });
  }),
};

/**
 * What a report about the app carries, for the dialog to show before
 * anything is sent: the details text and the exception events behind it.
 * `exception` is the fingerprint of the captured exception the report is
 * about, which leads, and whose fingerprint becomes the report's, so every
 * report of it is one problem. `condition` is what the app found wrong
 * that a report is about instead, described as it stands now.
 */
const describe = base
  .input(
    z.object({
      condition: ConditionSchema.optional(),
      exception: z.string().optional(),
      surface: z.string(),
    }),
  )
  .handler(async ({ input }) => {
    const { people } = await signedInPeople();
    if (input.condition) {
      const { fingerprint, found } = describeCondition(input.condition);
      return {
        ...describeProblem({ found, people, surface: input.surface }),
        fingerprint,
      };
    }
    const lead = input.exception
      ? findExceptionEvent(input.exception)
      : undefined;
    return {
      ...describeProblem({ lead, people, surface: input.surface }),
      fingerprint: lead ? `error:${lead.fingerprint}` : undefined,
    };
  });

/**
 * Sends a report. `pending` names the waiting problem it answers, which
 * leaves the bell once it's sent; `alwaysSend` is the dialog's checkbox,
 * which sends crashes and app errors without asking from then on.
 */
const send = base
  .input(
    z.object({
      alwaysSend: z.boolean().optional(),
      pending: z.string().optional(),
      report: ReportInputSchema,
    }),
  )
  .handler(async ({ errors, input }) => {
    try {
      const sent = await sendReport(input.report);
      if (input.pending) {
        clearPendingProblem(input.pending);
      }
      if (input.alwaysSend) {
        getMachinePreferences().set("sendErrorReportsAutomatically", true);
      }
      return sent;
    } catch (error) {
      captureServerException(error);
      // Said in words the dialog can show: too many reports at once, or the
      // service refusing it.
      throw errors.API_ERROR({
        cause: error,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

/**
 * What feedback can carry, for the dialog to offer part by part: the chat
 * named, when there is one, and the diagnostics, each item with the files
 * it sends and their size.
 */
const describeFeedbackRoute = base
  .input(z.object({ chatId: ChatIdSchema.optional() }))
  .handler(({ input }) => describeFeedback(input.chatId));

/**
 * Sends feedback: the note and the items the person kept checked, as the
 * dialog was given them, trimmed to the service's cap, and the images they
 * attached, as Blobs the RPC link carries as binary.
 */
const sendFeedback = base
  .input(
    z.object({
      images: z
        .array(
          z.object({
            data: z.instanceof(Blob),
            name: z.string().min(1).max(200),
          }),
        )
        .max(MAX_FEEDBACK_IMAGES)
        .optional(),
      items: z.array(FeedbackItemSchema),
      note: z.string().max(5000).optional(),
      surface: ReportInputSchema.shape.surface,
      title: ReportInputSchema.shape.title,
    }),
  )
  .handler(async ({ errors, input }) => {
    try {
      const images = await readFeedbackImages(input.images ?? []);
      return await sendReport(feedbackReportInput(input), images);
    } catch (error) {
      if (
        !(error instanceof FeedbackTooLargeError) &&
        !(error instanceof FeedbackImageRefusedError)
      ) {
        captureServerException(error);
      }
      // `fetch` throws a TypeError only when the request never got an answer.
      throw errors.API_ERROR({
        cause: error,
        message:
          error instanceof TypeError
            ? "We couldn't be reached, so it didn't send. Check your connection and try again."
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  });

/** Takes a waiting problem out of the bell without sending it. */
const dismiss = base
  .input(z.object({ fingerprint: z.string() }))
  .handler(({ input }) => {
    clearPendingProblem(input.fingerprint);
  });

const setSendAutomatically = base
  .input(z.object({ enabled: z.boolean() }))
  .handler(({ input }) => {
    getMachinePreferences().set("sendErrorReportsAutomatically", input.enabled);
  });

const setOfferFeedback = base
  .input(z.object({ enabled: z.boolean() }))
  .handler(({ input }) => {
    getMachinePreferences().set("offerFeedback", input.enabled);
  });

export const problems = {
  describe,
  describeFeedback: describeFeedbackRoute,
  dismiss,
  live,
  send,
  sendFeedback,
  setOfferFeedback,
  setSendAutomatically,
};
