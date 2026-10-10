import { liveRead } from "@instrument-org/workspace/electron";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  clearPendingProblem,
  describeProblem,
  fingerprintOf,
  listPendingProblems,
  sendReport,
  stackSignature,
} from "@/electron-main/lib/problem-reports";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { ReportInputSchema } from "@/shared/problem-reports";
import { z } from "zod";

const live = {
  // The problems from earlier sessions waiting in the bell.
  pending: base.handler(async function* ({ signal }) {
    const changes = publisher.subscribe("problems.updated", { signal });
    yield* liveRead({ changes: [changes], read: listPendingProblems });
  }),
};

/**
 * The details a report about the app carries, for the dialog to show before
 * anything is sent: versions, where it started, the error when there is one,
 * and the log's last lines. An error also gets the fingerprint that makes
 * every report of it one problem.
 */
const describe = base
  .input(
    z.object({
      error: z.string().max(20_000).optional(),
      surface: z.string(),
    }),
  )
  .handler(({ input }) => ({
    details: describeProblem(input),
    fingerprint: input.error
      ? fingerprintOf(stackSignature(input.error), "error")
      : undefined,
  }));

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
      captureServerException(error, { scopes: ["studio"] });
      // Said in words the dialog can show: nowhere to send to, too many
      // reports at once, or the service refusing it.
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
