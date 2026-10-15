import { type DictationFailure } from "@/shared/dictation";
import { APP_NAME } from "@instrument-org/shared";

/** Everything that can stop a dictation from landing as text. */
export type DictationProblem =
  | Exclude<DictationFailure, { kind: "canceled" | "no-audio" }>
  /** The mic was pressed with today's dictation already used up. */
  | { kind: "allowance-used-up"; resetsAt?: string }
  | { kind: "capture-failed" }
  | { kind: "microphone-busy" }
  | { kind: "microphone-refused" }
  | { kind: "no-microphone" }
  | { kind: "nothing-heard" }
  | { kind: "too-short" };

/** What a toast says about a problem, and what it offers to do next. */
export type DictationNotice = {
  action?: "open-settings" | "retry" | "sign-in";
  description?: string;
  /** Whether the recording is held for the retry the toast offers. */
  keepsRecording: boolean;
  title: string;
  tone: "error" | "info";
};

/**
 * When dictation comes back, in the reader's own time: a time alone for later
 * today, "tomorrow at" for tomorrow, and a weekday past that.
 */
export function resetPhrase(
  resetsAt: string | undefined,
  { now = new Date(), timeZone }: { now?: Date; timeZone?: string } = {},
): string {
  const at = resetsAt === undefined ? undefined : new Date(resetsAt);
  if (at === undefined || Number.isNaN(at.getTime())) {
    return "tomorrow";
  }
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(at);
  const dayOf = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "numeric",
      timeZone,
      year: "numeric",
    }).format(date);
  if (dayOf(at) === dayOf(now)) {
    return `at ${time}`;
  }
  if (dayOf(at) === dayOf(new Date(now.getTime() + 24 * 60 * 60 * 1000))) {
    return `tomorrow at ${time}`;
  }
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  }).format(at);
  return `on ${weekday} at ${time}`;
}

export function describeDictationProblem(
  problem: DictationProblem,
  {
    canOpenSettings,
    now,
    timeZone,
  }: { canOpenSettings: boolean; now?: Date; timeZone?: string },
): DictationNotice {
  switch (problem.kind) {
    case "allowance-reached": {
      return {
        action: "retry",
        description: `Your recording is safe, and you can send it ${resetPhrase(problem.resetsAt, { now, timeZone })}.`,
        keepsRecording: true,
        title: "You've used today's dictation",
        tone: "info",
      };
    }
    case "allowance-used-up": {
      return {
        description: `You can dictate again ${resetPhrase(problem.resetsAt, { now, timeZone })}.`,
        keepsRecording: false,
        title: "You've used today's dictation",
        tone: "info",
      };
    }
    case "capture-failed": {
      return {
        description: "Something went wrong with the microphone. Try again.",
        keepsRecording: false,
        title: "Couldn't start recording",
        tone: "error",
      };
    }
    case "connection": {
      return {
        action: "retry",
        description:
          "Your recording is safe. Check your connection, then try again.",
        keepsRecording: true,
        title: `Couldn't reach ${APP_NAME}`,
        tone: "error",
      };
    }
    case "microphone-busy": {
      return {
        description:
          "Another app is using the microphone. Close it, then try again.",
        keepsRecording: false,
        title: "Couldn't start recording",
        tone: "error",
      };
    }
    case "microphone-refused": {
      return canOpenSettings
        ? {
            action: "open-settings",
            // oxlint-disable-next-line studio/no-os-words -- only on macOS (`canOpenSettings`)
            description: `You can let ${APP_NAME} use the microphone in System Settings.`,
            keepsRecording: false,
            title: "Couldn't use the microphone",
            tone: "error",
          }
        : {
            description: `Your system isn't letting ${APP_NAME} use the microphone.`,
            keepsRecording: false,
            title: "Couldn't use the microphone",
            tone: "error",
          };
    }
    case "no-microphone": {
      return {
        description: "Plug one in, then try again.",
        keepsRecording: false,
        title: "Couldn't find a microphone",
        tone: "error",
      };
    }
    case "nothing-heard": {
      return {
        description: "There were no words in that recording. Try again.",
        keepsRecording: false,
        title: "Didn't quite catch that",
        tone: "info",
      };
    }
    case "rate-limited": {
      return {
        action: "retry",
        description: "Your recording is safe. Wait a moment, then try again.",
        keepsRecording: true,
        title: "Couldn't transcribe that yet",
        tone: "error",
      };
    }
    case "server": {
      return {
        action: "retry",
        description:
          "Something went wrong on our side. Your recording is safe, so you can try again.",
        keepsRecording: true,
        title: "Couldn't transcribe that",
        tone: "error",
      };
    }
    case "rejected": {
      return {
        description:
          "Dictation couldn't use that recording. If you picked a language in Settings, try Auto-detect.",
        keepsRecording: false,
        title: "Couldn't transcribe that",
        tone: "error",
      };
    }
    case "signed-out": {
      return {
        action: "sign-in",
        description: `Your recording is safe, and it goes through once you log in to ${APP_NAME}.`,
        keepsRecording: true,
        title: "Couldn't transcribe that",
        tone: "error",
      };
    }
    case "too-large": {
      return {
        description: "That recording is too long to send. Try a shorter one.",
        keepsRecording: false,
        title: "Couldn't transcribe that",
        tone: "error",
      };
    }
    case "unsupported-audio": {
      return {
        description:
          "Dictation couldn't read the audio in that recording. Try recording it again.",
        keepsRecording: false,
        title: "Couldn't transcribe that",
        tone: "error",
      };
    }
    case "too-short": {
      return {
        description: "Talk for a little longer before you press Stop.",
        keepsRecording: false,
        title: "Didn't quite catch that",
        tone: "info",
      };
    }
  }
}
