import {
  type AnalyticsEvents,
  type CaptureEventFunction,
} from "@instrument-org/shared";
import { app } from "electron";

import { getMachinePreferences } from "../stores/machine/preferences";
import { getMachineState } from "../stores/machine/state";
import { logger } from "./electron-logger";
import { getSystemProperties } from "./system-properties";
import { telemetry } from "./telemetry";

export const captureServerEvent: CaptureEventFunction = function <
  T extends keyof AnalyticsEvents,
>(
  type: T,
  ...rest: [AnalyticsEvents[T]] extends [never]
    ? []
    : [properties: AnalyticsEvents[T]]
) {
  const telemetryId = getMachineState().get("telemetryId");
  telemetry?.capture({
    distinctId: telemetryId,
    event: type,
    properties: {
      ...rest[0],
      $process_person_profile: false, // Ensure anonymous, if at all
      version: app.getVersion(),
      ...getSystemProperties(),
    },
  });
  if (import.meta.env.VITE_DEBUG_TELEMETRY === "true") {
    const enableUsageMetrics =
      getMachinePreferences().get("enableUsageMetrics");

    let logPrefix: string;
    if (telemetry === null) {
      logPrefix = "Event (disabled by env):";
    } else if (enableUsageMetrics) {
      logPrefix = "Event (captured):";
    } else {
      logPrefix = "Event (disabled by user):";
    }

    logger.info(logPrefix, type, rest[0]);
  }
};
