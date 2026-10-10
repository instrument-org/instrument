import { toast as sonnerToast, type ExternalToast } from "sonner";

// Every toast in the app goes through here, so how long one stays is decided in
// one place from what it carries rather than by each call site. An error stays
// until it is closed, because it may need reading twice or acting on. Anything
// else stays long enough to read: longer with a second line, longer still with
// an action to reach for. A caller that passes its own `duration` keeps it.

const BRIEF_MS = 4000;
const DESCRIBED_MS = 6000;
const ACTIONABLE_MS = 8000;

type Message = Parameters<typeof sonnerToast>[0];

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

export const toast = Object.assign(
  (message: Message, data?: ExternalToast) =>
    sonnerToast(message, withDuration(data)),
  {
    ...sonnerToast,
    message: (message: Message, data?: ExternalToast) =>
      sonnerToast.message(message, withDuration(data)),
    success: (message: Message, data?: ExternalToast) =>
      sonnerToast.success(message, withDuration(data)),
    info: (message: Message, data?: ExternalToast) =>
      sonnerToast.info(message, withDuration(data)),
    warning: (message: Message, data?: ExternalToast) =>
      sonnerToast.warning(message, withDuration(data)),
    error: (message: Message, data?: ExternalToast) =>
      sonnerToast.error(message, withDuration(data, { isError: true })),
  },
);
