import {
  type NextStep,
  nextStepFor,
  type NoticeAction,
  refusalNotice,
} from "@/client/lib/billing";
import { type RPCOutput } from "@/client/rpc/client";
import { type PlanRefusal } from "@instrument-org/shared";
import { type DictationFailure } from "@/shared/dictation";
import { type Os } from "@/shared/os-conventions";
import { APP_NAME } from "@instrument-org/shared";

/** Everything that can stop a dictation from landing as text. */
export type DictationProblem =
  | Exclude<DictationFailure, { kind: "canceled" | "no-audio" }>
  /**
   * Billing refused the stream before the take, or ended it mid-take, so
   * nothing is held. `refusal` is what billing said, when it said.
   */
  | { kind: "billing-stopped"; refusal?: PlanRefusal }
  | { kind: "capture-failed" }
  | { kind: "microphone-busy" }
  | { kind: "microphone-refused" }
  /**
   * Refused as far as this run can tell, after System Settings was opened:
   * only a relaunch hears whether the switch was turned on there.
   */
  | { kind: "microphone-reopen" }
  | { kind: "no-microphone" }
  | { kind: "nothing-heard" }
  | { kind: "too-short" };

/** What a toast says about a problem, and what it offers to do next. */
export type DictationNotice = {
  action?:
    | "open-settings"
    | "reopen"
    | "retry"
    | "sign-in"
    /** Billing's own way forward, as the chat's billing note offers it. */
    | NoticeAction;
  description?: string;
  /** Whether the recording is held for the retry the toast offers. */
  keepsRecording: boolean;
  title: string;
  tone: "error" | "info";
};

/**
 * The account as billing described it after a refusal, so the notice says
 * what the chat's billing note would. `statusReadAt` says whether `status`
 * was read after `refusedAt`, and only then is it trusted.
 */
export type DictationBilling = {
  refusedAt: Date;
  status?: RPCOutput["billing"]["status"];
  statusReadAt: number;
};

/**
 * A billing refusal in the words the chat's billing note uses for it. A
 * refusal billing didn't describe reads as a spent usage window, without
 * the reset time it would have named, and is never taken as lifted.
 */
function describeBillingRefusal(
  refusal: PlanRefusal | undefined,
  kept: boolean,
  billing: DictationBilling | undefined,
): DictationNotice {
  const now = billing?.refusedAt ?? new Date();
  const notice = refusalNotice({
    blocked: "dictation",
    now,
    refusal: refusal ?? {
      code: "usage-limit-exceeded",
      ...(billing?.status?.account.next && {
        next: billing.status.account.next,
      }),
      outcome: "limit-reached",
    },
    refusedAt: now,
    status: billing?.status,
    statusReadAt: refusal ? (billing?.statusReadAt ?? 0) : 0,
  });
  const copy: Pick<NextStep, "action" | "line" | "title"> = notice
    ? nextStepFor(
        {
          blocked: "dictation",
          notice,
          otherModelCan: false,
          status: billing?.status,
        },
        now,
      )
    : { title: "Couldn't transcribe that" };
  const { action, title } = copy;
  const line = refusal ? copy.line : undefined;
  return {
    action: action?.kind === "continue" ? (kept ? "retry" : undefined) : action,
    description: kept
      ? [line, "Your recording is safe, so you can send it later."]
          .filter(Boolean)
          .join(" ")
      : line,
    keepsRecording: kept,
    title,
    tone: "info",
  };
}

export function describeDictationProblem(
  problem: DictationProblem,
  { billing, os }: { billing?: DictationBilling; os: Os },
): DictationNotice {
  switch (problem.kind) {
    case "billing-refused": {
      return describeBillingRefusal(problem.refusal, true, billing);
    }
    case "billing-stopped": {
      return describeBillingRefusal(problem.refusal, false, billing);
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
      return os === "linux"
        ? {
            description: `Your system isn't letting ${APP_NAME} use the microphone.`,
            keepsRecording: false,
            title: "Couldn't use the microphone",
            tone: "error",
          }
        : {
            action: "open-settings",
            description:
              os === "mac"
                ? // oxlint-disable-next-line studio/no-os-words -- only on macOS
                  `You can let ${APP_NAME} use the microphone in System Settings.`
                : // oxlint-disable-next-line studio/no-os-words -- only on Windows
                  `You can let ${APP_NAME} use the microphone in Windows privacy settings.`,
            keepsRecording: false,
            title: "Couldn't use the microphone",
            tone: "error",
          };
    }
    case "microphone-reopen": {
      return {
        action: "reopen",
        description: `Reopen ${APP_NAME} to use the microphone.`,
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
