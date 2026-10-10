import { ORPCError } from "@orpc/client";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import type { ReactNode } from "react";
import { toast as sonnerToast, type ExternalToast } from "sonner";

import { logger } from "./logger";

// Every toast in the app goes through here, so how a toast behaves is decided
// in one place rather than by each call site.
//
// How long it stays comes from what it carries. An error stays until it is
// closed, because it may need reading twice or acting on. Anything else stays
// long enough to read: longer with a second line, longer still with an action
// to reach for. A caller that passes its own `duration` keeps it.
//
// What an error says is for the person reading it. The title says what didn't
// happen, as "Couldn't …"; a second line is there only when it tells them
// something they can use, in words written for them. The error itself goes in
// `cause`: it is logged, and it is shown only in developer mode, marked as such.
//
// `toast.dev` is for code only developers reach. It shows nothing outside
// developer mode and is marked when it does show, so nobody mistakes it for
// something a person would see.

const BRIEF_MS = 4000;
const DESCRIBED_MS = 6000;
const ACTIONABLE_MS = 8000;

type Message = Parameters<typeof sonnerToast>[0];
type ErrorToast = ExternalToast & { cause?: unknown };

let isDeveloperMode = false;

/** Kept in step with the preference by the Toaster, which can read it. */
export function setToastDeveloperMode(on: boolean) {
  isDeveloperMode = on;
}

/**
 * The message of an oRPC error whose code comes with a sentence written for
 * people, when it is one of `codes`; for anything else, nothing, so the caller
 * falls back to its own words.
 */
export function spokenMessage(
  error: unknown,
  codes: readonly string[],
): string | undefined {
  return error instanceof ORPCError && codes.includes(error.code)
    ? error.message
    : undefined;
}

function withDuration(
  data: ExternalToast | undefined,
  { isError = false } = {},
): ExternalToast {
  if (data?.duration !== undefined) {
    return data;
  }
  const duration = isError
    ? Infinity
    : data?.action
      ? ACTIONABLE_MS
      : data?.description
        ? DESCRIBED_MS
        : BRIEF_MS;
  return { ...data, duration };
}

const DEV_MARK = (
  <EyeIcon className="size-4 text-dev-700 dark:text-dev-300" weight="bold" />
);
const DEV_TOAST = "ring-1 ring-dev-700/40 dark:ring-dev-500";

function detailOf(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return cause.message || undefined;
  }
  return typeof cause === "string" && cause !== "" ? cause : undefined;
}

/** The second line of an error: the caller's words, then in developer mode the error's own. */
function errorDescription(
  description: ExternalToast["description"],
  cause: unknown,
): ExternalToast["description"] {
  const detail = isDeveloperMode ? detailOf(cause) : undefined;
  if (detail === undefined) {
    return description;
  }
  const said: ReactNode =
    typeof description === "function" ? description() : description;
  return (
    <>
      {said}
      <span className="mt-1 flex items-start gap-1 font-mono text-[11px] break-all text-dev-700 dark:text-dev-300">
        <EyeIcon className="mt-0.5 size-3 shrink-0" />
        {detail}
      </span>
    </>
  );
}

function showError(message: Message, data?: ErrorToast) {
  const { cause, ...rest } = data ?? {};
  if (cause !== undefined) {
    logger.error(typeof message === "string" ? message : "Toast", cause);
  }
  return sonnerToast.error(
    message,
    withDuration(
      { ...rest, description: errorDescription(rest.description, cause) },
      { isError: true },
    ),
  );
}

function showDev(message: Message, data?: ExternalToast) {
  if (!isDeveloperMode) {
    return undefined;
  }
  return sonnerToast(
    message,
    withDuration({
      ...data,
      classNames: { ...data?.classNames, toast: DEV_TOAST },
      icon: DEV_MARK,
    }),
  );
}

export const toast = Object.assign(
  (message: Message, data?: ExternalToast) =>
    sonnerToast(message, withDuration(data)),
  {
    custom: sonnerToast.custom,
    dev: showDev,
    dismiss: sonnerToast.dismiss,
    error: showError,
    getHistory: sonnerToast.getHistory,
    getToasts: sonnerToast.getToasts,
    info: (message: Message, data?: ExternalToast) =>
      sonnerToast.info(message, withDuration(data)),
    loading: sonnerToast.loading,
    message: (message: Message, data?: ExternalToast) =>
      sonnerToast.message(message, withDuration(data)),
    promise: sonnerToast.promise,
    success: (message: Message, data?: ExternalToast) =>
      sonnerToast.success(message, withDuration(data)),
    warning: (message: Message, data?: ExternalToast) =>
      sonnerToast.warning(message, withDuration(data)),
  },
);
