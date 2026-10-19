import { liveRead } from "@instrument-org/workspace/electron";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  clearPendingProblem,
  describeProblem,
  listPendingProblems,
  sendReport,
} from "@/electron-main/lib/problem-reports";
import { findExceptionEvent } from "@/electron-main/lib/exception-store";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { describeCondition } from "@/electron-main/lib/notices";
import { ConditionSchema, ReportInputSchema } from "@/shared/problem-reports";
import { z } from "zod";

const live = {
  // The problems from earlier sessions waiting in the bell.
  pending: base.handler(async function* ({ signal }) {
    const changes = publisher.subscribe("problems.updated", { signal });
    yield* liveRead({ changes: [changes], read: listPendingProblems });
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
  .handler(({ input }) => {
    if (input.condition) {
      const { fingerprint, found } = describeCondition(input.condition);
      return {
        ...describeProblem({ found, surface: input.surface }),
        fingerprint,
      };
    }
    const lead = input.exception
      ? findExceptionEvent(input.exception)
      : undefined;
    return {
      ...describeProblem({ lead, surface: input.surface }),
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

export const problems = {
  describe,
  dismiss,
  live,
  send,
  setSendAutomatically,
};
