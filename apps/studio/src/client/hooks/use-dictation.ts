import { openLogin } from "@/client/atoms/login-modal";
import { MicCapture, MicrophoneError } from "@/client/lib/dictation-capture";
import { createLevelScale } from "@/client/lib/dictation-levels";
import { resolveMicrophone } from "@/client/lib/dictation-microphone";
import {
  describeDictationProblem,
  type DictationProblem,
} from "@/client/lib/dictation-problems";
import { toast } from "@/client/lib/toast";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type DictationSurface } from "@/shared/dictation";
import { safe } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** A recording stops itself here. */
const DICTATION_MAX_MS = 10 * 60 * 1000;
/** Anything shorter is a slip of the finger rather than something said. */
const MIN_RECORDING_MS = 1000;
/** How many bars the meter draws, newest at the right. */
const DICTATION_LEVEL_BARS = 18;
const TICK_MS = 100;

const silentLevels = () =>
  Array.from({ length: DICTATION_LEVEL_BARS }, () => 0);

/** The recording in progress, and what it reports to. */
type Session = {
  capture?: MicCapture;
  deliver: (text: string) => void;
  /** Stopped or canceled, so a start still opening the microphone lets it go. */
  ended: boolean;
  ticker?: ReturnType<typeof setInterval>;
};

export type DictationPhase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "starting" }
  /** `pressed` is the control that ended the recording, which carries the spinner. */
  | { kind: "transcribing"; pressed: "send" | "stop" };

export type Dictation = {
  /** Throws the recording away. Only while starting or recording. */
  cancel: () => void;
  /** How long the recording has run; held through transcription. */
  elapsedMs: number;
  /** Recent levels, 0..1, oldest first. */
  levels: number[];
  phase: DictationPhase;
  start: () => void;
  /**
   * Ends the recording and sends it to be transcribed. `onLanded` runs once the
   * words have landed, which is how Send while recording sends.
   */
  stop: (options?: { onLanded?: () => void }) => void;
};

/** Whether a dictation is in progress, from the press until its words land. */
export function isDictating(phase: DictationPhase): boolean {
  return phase.kind !== "idle";
}

/**
 * Records from the microphone, sends the recording to be transcribed, and
 * hands the words to `onText`. Owns everything between the press and the
 * words landing: the microphone permission, the device picked in Settings,
 * the level meter, the clock, and every way that can fail, each said in a
 * toast. A recording that fails to send for a reason that might pass is kept
 * in memory for the toast's Try Again until the next recording starts.
 *
 * `onText` is the one from when the recording started, so words always land
 * where they were spoken into. With `finishOnUnmount`, a surface that goes
 * away mid-recording still gets its words, for one whose `onText` writes
 * somewhere that outlives it; otherwise the recording is thrown away.
 */
export function useDictation({
  finishOnUnmount = false,
  onText,
  surface,
}: {
  finishOnUnmount?: boolean;
  onText: (text: string) => void;
  surface: DictationSurface;
}): Dictation {
  const [phase, setPhase] = useState<DictationPhase>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState(silentLevels);
  // Each dictation's toasts are its own, so one box starting or landing never
  // takes away another's Try Again and strands its recording.
  const toastId = `dictation:${surface}:${useId()}`;

  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );

  // Read when a recording starts, not when this rendered.
  const latest = useRef({ hasToken, onText, preferences });
  useLayoutEffect(() => {
    latest.current = { hasToken, onText, preferences };
  });

  // The recording in progress, if any, and what it reports to.
  const session = useRef<Session>(undefined);
  // A take that failed to send for a reason that might pass, for Try Again.
  const kept = useRef<{ audio: Blob; deliver: (text: string) => void }>(
    undefined,
  );

  const report = (problem: DictationProblem, retry?: () => void) => {
    const notice = describeDictationProblem(problem, {
      canOpenSettings: isMacOS(),
    });
    const action =
      notice.action === "retry" && retry
        ? { label: "Try again", onClick: retry }
        : notice.action === "sign-in" && retry
          ? {
              label: "Log in",
              onClick: () => {
                openLogin({ instrumentOnly: true, reason: "dictation" }, retry);
              },
            }
          : notice.action === "open-settings"
            ? {
                label: "Open System Settings",
                onClick: () => {
                  void rpcClient.mac.microphone.openSettings.call();
                },
              }
            : undefined;
    const options = {
      action,
      description: notice.description,
      // A toast that holds a recording stays until it is answered.
      ...(notice.keepsRecording && { duration: Number.POSITIVE_INFINITY }),
      id: toastId,
    };
    if (notice.tone === "info") {
      toast.info(notice.title, options);
    } else {
      toast.error(notice.title, options);
    }
  };

  const finish = (text: string, deliver: (text: string) => void) => {
    const words = text.trim();
    if (!words) {
      report({ kind: "nothing-heard" });
      return false;
    }
    deliver(words);
    return true;
  };

  const transcribe = async (
    audio: Blob,
    deliver: (text: string) => void,
    onLanded?: () => void,
  ) => {
    const [error, result] = await safe(
      rpcClient.dictation.transcribe.call({ audio, surface }),
    );
    setPhase({ kind: "idle" });
    if (error) {
      kept.current = { audio, deliver };
      report({ kind: "server" }, retryKept);
      return;
    }
    if (result.ok) {
      kept.current = undefined;
      toast.dismiss(toastId);
      if (finish(result.text, deliver)) {
        onLanded?.();
      }
      return;
    }
    const { failure } = result;
    if (failure.kind === "canceled") {
      return;
    }
    const problem: DictationProblem =
      failure.kind === "no-audio" ? { kind: "nothing-heard" } : failure;
    const notice = describeDictationProblem(problem, {
      canOpenSettings: isMacOS(),
    });
    kept.current = notice.keepsRecording ? { audio, deliver } : undefined;
    report(problem, retryKept);
  };

  function retryKept() {
    const take = kept.current;
    if (!take) {
      return;
    }
    setPhase({ kind: "transcribing", pressed: "stop" });
    void transcribe(take.audio, take.deliver);
  }

  const stopTicker = () => {
    if (session.current?.ticker !== undefined) {
      clearInterval(session.current.ticker);
    }
  };

  const stop = ({ onLanded }: { onLanded?: () => void } = {}) => {
    const current = session.current;
    const capture = current?.capture;
    if (!current || !capture || current.ended) {
      return;
    }
    current.ended = true;
    stopTicker();
    session.current = undefined;
    const length = capture.elapsedMs();
    setElapsedMs(length);
    setLevels(silentLevels());
    setPhase({ kind: "transcribing", pressed: onLanded ? "send" : "stop" });
    void capture.stop().then((audio) => {
      if (length < MIN_RECORDING_MS) {
        setPhase({ kind: "idle" });
        report({ kind: "too-short" });
        return;
      }
      return transcribe(audio, current.deliver, onLanded);
    });
  };

  const cancel = () => {
    const current = session.current;
    if (!current) {
      return;
    }
    current.ended = true;
    stopTicker();
    current.capture?.cancel();
    session.current = undefined;
    setLevels(silentLevels());
    setElapsedMs(0);
    setPhase({ kind: "idle" });
  };

  const start = async () => {
    if (phase.kind !== "idle" || session.current) {
      return;
    }
    const {
      hasToken: signedIn,
      onText: deliver,
      preferences: prefs,
    } = latest.current;
    if (signedIn === false) {
      openLogin({ instrumentOnly: true, reason: "dictation" });
      return;
    }
    const current: Session = {
      deliver,
      ended: false,
    };
    session.current = current;
    setElapsedMs(0);
    setPhase({ kind: "starting" });

    const giveUp = (problem?: DictationProblem) => {
      if (session.current === current) {
        session.current = undefined;
        setPhase({ kind: "idle" });
      }
      if (problem && !current.ended) {
        report(problem);
      }
    };

    // Known to be used up: say so rather than record something that can't
    // be sent, and leave a recording already held where it is.
    const [, allowance] = await safe(rpcClient.dictation.allowance.call());
    if (allowance?.exhausted) {
      giveUp();
      if (current.ended) {
        return;
      }
      if (kept.current) {
        report(
          { kind: "allowance-reached", resetsAt: allowance.resetsAt },
          retryKept,
        );
      } else {
        report({ kind: "allowance-used-up", resetsAt: allowance.resetsAt });
      }
      return;
    }
    kept.current = undefined;
    toast.dismiss(toastId);

    // macOS asks once; until then getUserMedia would fail without asking.
    const [, access] = await safe(rpcClient.mac.microphone.status.call());
    const answer =
      access === "not-determined"
        ? (await safe(rpcClient.mac.microphone.request.call()))[1]
        : access;
    if (answer === "denied" || answer === "restricted") {
      giveUp({ kind: "microphone-refused" });
      return;
    }

    const devices = await navigator.mediaDevices
      .enumerateDevices()
      .then((all) => all.filter((device) => device.kind === "audioinput"))
      .catch(() => []);
    const chosen = prefs?.dictationMicrophone;
    const microphone = resolveMicrophone(chosen, devices);
    if (microphone.missing && chosen) {
      toast.info("Using the system default microphone", {
        description: `“${chosen.label}” isn't connected right now.`,
        id: "dictation:microphone-missing",
      });
    }

    let capture: MicCapture;
    try {
      capture = await MicCapture.open(microphone.deviceId);
    } catch (error) {
      giveUp(
        error instanceof MicrophoneError
          ? { kind: error.kind }
          : { kind: "capture-failed" },
      );
      return;
    }
    if (current.ended) {
      // Canceled, or the surface went away, while the microphone opened.
      capture.cancel();
      return;
    }

    current.capture = capture;
    const scale = createLevelScale();
    current.ticker = setInterval(() => {
      const elapsed = capture.elapsedMs();
      setElapsedMs(elapsed);
      setLevels((previous) => [
        ...previous.slice(1),
        scale(capture.level(), performance.now()),
      ]);
      if (elapsed >= DICTATION_MAX_MS) {
        stop();
      }
    }, TICK_MS);
    // A microphone that goes away mid-take keeps what it heard.
    capture.onEnded(() => {
      stop();
    });
    setPhase({ kind: "recording" });
  };

  // Gone mid-recording: finish it when its words have somewhere to go,
  // otherwise let the microphone go.
  const onUnmount = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    onUnmount.current = () => {
      if (!session.current) {
        return;
      }
      if (finishOnUnmount && session.current.capture) {
        stop();
      } else {
        cancel();
      }
    };
  });
  useEffect(
    () => () => {
      onUnmount.current();
    },
    [],
  );

  return {
    cancel,
    elapsedMs,
    levels,
    phase,
    start: () => {
      void start();
    },
    stop,
  };
}
