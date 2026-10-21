import { isPlatformApiUnreachable } from "@/electron-main/platform-api/reachability";
import {
  type CaptureContext,
  type CaptureExceptionFunction,
  isExpectedNetworkError,
} from "@instrument-org/shared";
import {
  buildExceptionEvent,
  type ExceptionEvent,
  ForwardedException,
  formatExceptionEvent,
} from "@instrument-org/shared/exceptions";
import { app } from "electron";
import os from "node:os";

import { recentBreadcrumbs } from "./breadcrumbs";
import { logger } from "./electron-logger";
import { eventContexts } from "./event-contexts";
import { storeExceptionEvent } from "./exception-store";
import { rendererBaseURL } from "./renderer-host";

/**
 * The one way an exception is captured in Studio, for every process: the
 * main process calls it directly, the workspace and the gateway through the
 * function their config is given (`captureFor`), and the renderer and the
 * bash worker by forwarding a serialized error (`ForwardedException`).
 *
 * It builds the complete event, keeps it in the exception store a report
 * draws from, and writes its readable form to the log. Nothing here leaves
 * the device: an event is sent only inside a report the person sees first.
 */
export const captureServerException: CaptureExceptionFunction =
  captureFor("studio");

/** The capture function for one part of the app, `area` its default. */
export function captureFor(area: string): CaptureExceptionFunction {
  return (error, context) => {
    // The window's corner already says the platform API is down, and every
    // request through it (the gateway, titles, the account) fails the same
    // way until it is back.
    if (
      !(error instanceof ForwardedException) &&
      isPlatformApiUnreachable() &&
      isExpectedNetworkError(error)
    ) {
      return;
    }
    let event: ExceptionEvent;
    try {
      event = buildMainExceptionEvent(error, context, area);
    } catch (buildError) {
      // A capture that fails must not become another throw for its caller.
      logger.error("Could not build an exception event", error, buildError);
      return;
    }
    recordExceptionEvent(event);
  };
}

/** The event for one capture, with this process's contexts and breadcrumbs. */
export function buildMainExceptionEvent(
  error: unknown,
  context?: CaptureContext,
  area = "studio",
): ExceptionEvent {
  return buildExceptionEvent(error, {
    breadcrumbs: recentBreadcrumbs(),
    context,
    contexts: eventContexts(),
    defaultArea: area,
    paths: {
      appRoot: app.getAppPath(),
      home: os.homedir(),
      urlRoots: [rendererBaseURL()],
    },
  });
}

/** Keep an event and log it. Never throws. */
export function recordExceptionEvent(event: ExceptionEvent) {
  try {
    storeExceptionEvent(event);
    logger.error(
      `[Exception] ${formatExceptionEvent(event, { breadcrumbs: 0 })}`,
    );
  } catch (error) {
    // A capture that fails must not become another throw for its caller.
    try {
      logger.error("Could not record an exception", error);
    } catch {
      // Nowhere left to say so.
    }
  }
}
