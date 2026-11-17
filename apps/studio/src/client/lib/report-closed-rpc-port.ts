import { describeReport, errorReport } from "@/client/lib/problem-reports";
import { CLOSED_PORT_TO_REPORT_KEY, rpcClient } from "@/client/rpc/client";

import { captureException } from "./capture-exception";

/**
 * After the window reloaded for an RPC port that closed under it, records
 * that, and sends it as a report when error reports go automatically: the
 * page whose port closed could send nothing.
 */
export async function reportClosedRPCPort() {
  if (sessionStorage.getItem(CLOSED_PORT_TO_REPORT_KEY) === null) {
    return;
  }
  sessionStorage.removeItem(CLOSED_PORT_TO_REPORT_KEY);
  const error = new Error(
    "The window's RPC port closed under it; the window reloaded",
  );
  captureException(error);
  const preferences = await rpcClient.preferences.get.call({});
  if (!preferences.sendErrorReportsAutomatically) {
    return;
  }
  const request = errorReport({ error, surface: "window-error" });
  const described = await describeReport(request);
  await rpcClient.problems.send.call({
    report: {
      automatic: true,
      details: described.details,
      events: described.events,
      fingerprint: described.fingerprint,
      kind: request.kind,
      surface: "window-error",
      title: request.reportTitle,
    },
  });
}
