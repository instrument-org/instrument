import {
  type AnalyticsEvents,
  type CaptureEventFunction,
} from "@instrument-org/shared";

import { captureTelemetryEvent } from "./telemetry";

export const captureClientEvent: CaptureEventFunction = function <
  T extends keyof AnalyticsEvents,
>(
  type: T,
  ...rest: [AnalyticsEvents[T]] extends [never]
    ? []
    : [properties: AnalyticsEvents[T]]
) {
  captureTelemetryEvent(type, rest[0]);
};
