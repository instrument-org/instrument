import { openReportDialog } from "@/client/atoms/report-dialog";
import { feedbackReport } from "@/client/lib/problem-reports";
import { openLogin } from "@/client/atoms/login-modal";
import { openAccount, openPlans } from "@/client/lib/billing-website";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import {
  type BillingNoticeAction,
  featurePause,
  upgradePlan,
} from "@/client/lib/billing";
import { MicCapture, MicrophoneError } from "@/client/lib/dictation-capture";
import {
  microphoneName,
  resolveMicrophone,
} from "@/client/lib/dictation-microphone";
import {
  describeDictationProblem,
  type DictationBilling,
  type DictationProblem,
} from "@/client/lib/dictation-problems";
import { playDictationCue } from "@/client/lib/dictation-sounds";
import { toast } from "@/client/lib/toast";
import { currentOs, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type DictationStreamEvent,
  type DictationSurface,
} from "@/shared/dictation";
import { APP_NAME, SUPPORT_URL } from "@instrument-org/shared";
import { safe } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** A recording stops itself here. */
const DICTATION_MAX_MS = 10 * 60 * 1000;
/** Anything shorter is a slip of the finger rather than something said. */
const MIN_RECORDING_MS = 1000;
/** How often a recording checks whether it has run to its limit. */
const TICK_MS = 1000;
/**
 * How long Stop waits for the live stream's last words before uploading the
 * take instead. They usually come back in a tenth of a second.
 */
const LIVE_END_TIMEOUT_MS = 5000;

type StreamEnd = Extract<DictationStreamEvent, { type: "end" }>;

/** A take's live stream: where its audio goes and what it has heard. */
type LiveStream = {
  abort: AbortController;
  /** Settles with the stream's `end`, or nothing once it is gone without one. */
  ended: Promise<StreamEnd | undefined>;
  finals: string[];
  id?: string;
  interim: string;
  /** Chunks recorded before the stream opened, sent once it does. */
  pending: Blob[];
  sending: Promise<unknown>;
  status: LiveText["status"];
};

/** The recording in progress, and what it reports to. */
type Session = {
  capture?: MicCapture;
  deliver: (text: string) => void;
  /** Stopped or canceled, so a start still opening the microphone lets it go. */
  ended: boolean;
  live?: LiveStream;
  /** Ends the hold that tells quitting a recording is in progress. */
  release?: () => void;
  ticker?: ReturnType<typeof setInterval>;
};

/**
 * Tells the app a recording is in progress until the returned function is
 * called, so quitting asks first.
 */
function holdRecording() {
  const hold = new AbortController();
  void (async () => {
    const events = await rpcClient.dictation.recording.call(
      {},
      { signal: hold.signal },
    );
    for await (const _ of events) {
      // Nothing comes; the call is held open.
    }
  })().catch(() => undefined);
  return () => {
    hold.abort();
  };
}

/**
 * The words a take's live stream has heard so far, for the box to show while
 * the person talks. `settled` is what will land; `interim` is the stretch
 * still being heard, which may change. `lost` and `unavailable` mean the
 * stream went away or never opened: the recording goes on, and its words
 * come from the whole take at Stop.
 */
type LiveText = {
  interim: string;
  settled: string;
  status: "connecting" | "live" | "lost" | "unavailable";
};

export type DictationPhase =
  | { kind: "idle" }
  | { kind: "recording" }
  /** `asking` while the system's microphone prompt waits on an answer. */
  | { asking?: true; kind: "starting" }
  /**
   * `live` while the stream settles its last words, rather than the whole
   * take being transcribed.
   */
  | { kind: "transcribing"; live?: true };

export type Dictation = {
  /** Throws the recording away. Only while starting or recording. */
  cancel: () => void;
  /** What the live stream has heard, from the press until the words land. */
  live: LiveText | undefined;
  /** The microphone while it records, for the wave. */
  stream: MediaStream | undefined;
  phase: DictationPhase;
  start: () => void;
  /**
   * Ends the recording and sends it to be transcribed. `onLanded` runs once the
   * words have landed, which is how Enter while recording sends.
   */
  stop: (options?: { onLanded?: () => void }) => void;
};

/**
 * What a send does while dictation is in play, for a box whose Send and
 * Enter must never leave dictated words behind: send now when idle, stop and
 * send once the words land while recording, and wait while the mic opens or
 * the words are on their way.
 */
export function sendDuringDictation(
  phase: DictationPhase,
): "send" | "stop-then-send" | "wait" {
  switch (phase.kind) {
    case "idle": {
      return "send";
    }
    case "recording": {
      return "stop-then-send";
    }
    case "starting":
    case "transcribing": {
      return "wait";
    }
  }
}

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
  const [live, setLive] = useState<LiveText>();
  const [micStream, setMicStream] = useState<MediaStream>();
  // Each dictation's toasts are its own, so one box starting or landing never
  // takes away another's Try Again and strands its recording. Each toast gets
  // a fresh id: Sonner merges a toast into an earlier one with its id, buttons
  // included, and applies a dismiss a frame late to whatever has that id then.
  // An error toast's id is otherwise its title.
  const toastKey = `dictation:${surface}:${useId()}`;
  const toastCount = useRef(0);
  const nextToastId = () => `${toastKey}:${++toastCount.current}`;
  const shownToast = useRef<number | string>(undefined);
  const dismissToast = () => {
    if (shownToast.current !== undefined) {
      toast.dismiss(shownToast.current);
      shownToast.current = undefined;
    }
  };

  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const queryClient = useQueryClient();
  const openLink = useOpenExternalLink();

  // Read when a recording starts, not when this rendered.
  const latest = useRef({ hasToken, onText, preferences });
  useLayoutEffect(() => {
    latest.current = { hasToken, onText, preferences };
  });

  // The recording in progress, if any, and what it reports to.
  const session = useRef<Session>(undefined);
  // A take that failed to send for a reason that might pass, for Try Again.
  const kept = useRef<{
    audio: Blob;
    deliver: (text: string) => void;
    onLanded?: () => void;
  }>(undefined);

  // The live stream whose words the box shows, until they land.
  const shownLive = useRef<LiveStream>(undefined);
  const publishLive = (stream: LiveStream) => {
    if (shownLive.current === stream) {
      setLive({
        interim: stream.interim,
        settled: stream.finals.join(" "),
        status: stream.status,
      });
    }
  };
  const clearLive = () => {
    shownLive.current?.abort.abort();
    shownLive.current = undefined;
    setLive(undefined);
  };

  const feedLive = (stream: LiveStream, chunk: Blob) => {
    if (stream.status === "connecting") {
      stream.pending.push(chunk);
      return;
    }
    const { id } = stream;
    if (stream.status !== "live" || id === undefined) {
      return;
    }
    stream.sending = stream.sending.then(() =>
      safe(rpcClient.dictation.feed.call({ chunk, id })),
    );
  };

  /**
   * Sends Stop down the stream once the take's last audio has gone, and
   * waits for its `end`, or gives up on it after a moment.
   */
  const finishLive = async (stream: LiveStream) => {
    await stream.sending;
    if (stream.id !== undefined) {
      await safe(rpcClient.dictation.finish.call({ id: stream.id }));
    }
    return Promise.race([
      stream.ended,
      new Promise<undefined>((resolve) => {
        setTimeout(resolve, LIVE_END_TIMEOUT_MS);
      }),
    ]);
  };

  /**
   * The account as billing describes it now, read after a refusal so its
   * toast says what the chat's billing note would.
   */
  const readBilling = async (): Promise<DictationBilling> => {
    const refusedAt = new Date();
    const [status, offer] = await Promise.all([
      queryClient
        .fetchQuery({
          ...rpcClient.billing.status.queryOptions(),
          staleTime: 0,
        })
        .catch(() => undefined),
      queryClient
        .fetchQuery(rpcClient.billing.offer.queryOptions())
        .catch(() => undefined),
    ]);
    return { offer, refusedAt, status, statusReadAt: Date.now() };
  };

  const actOnBilling = (
    kind: BillingNoticeAction,
    billing: DictationBilling | undefined,
  ) => {
    switch (kind) {
      case "choose-plan":
      case "start-trial": {
        openPlans();
        break;
      }
      case "contact-support": {
        openLink(SUPPORT_URL);
        break;
      }
      case "continue": {
        break;
      }
      case "send-feedback": {
        openReportDialog(feedbackReport({ surface: "usage-limit" }));
        break;
      }
      case "sign-in": {
        openLogin({ instrumentOnly: true, reason: "dictation" });
        break;
      }
      case "update-card": {
        openAccount();
        break;
      }
      case "upgrade": {
        openPlans(upgradePlan(billing?.offer, billing?.status)?.key);
        break;
      }
      default: {
        kind satisfies never;
      }
    }
  };

  const report = (
    problem: DictationProblem,
    retry?: () => void,
    billing?: DictationBilling,
  ) => {
    const notice = describeDictationProblem(problem, {
      billing,
      os: currentOs(),
    });
    const billingAction =
      typeof notice.action === "object" ? notice.action : undefined;
    const action = billingAction
      ? {
          label: billingAction.label,
          onClick: (event: { preventDefault: () => void }) => {
            // A toast holding the recording stays up for its Try again.
            if (notice.keepsRecording && retry) {
              event.preventDefault();
            }
            actOnBilling(billingAction.kind, billing);
          },
        }
      : notice.action === "retry" && retry
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
                label: isMacOS()
                  ? // oxlint-disable-next-line studio/no-os-words -- only on macOS
                    "Open System Settings"
                  : "Open settings",
                onClick: () => {
                  void rpcClient.dictation.access.openSettings.call();
                },
              }
            : notice.action === "reopen"
              ? {
                  label: "Reopen",
                  onClick: () => {
                    void rpcClient.dictation.access.reopen.call();
                  },
                }
              : undefined;
    const options = {
      action,
      // Billing's way forward leads; the held recording is sent from beside it.
      ...(billingAction &&
        notice.keepsRecording &&
        retry && { cancel: { label: "Try again", onClick: retry } }),
      description: notice.description,
      // A toast that holds a recording stays until it is answered, and so
      // does Reopen, the one place a chat says a restart is needed.
      ...((notice.keepsRecording || notice.action === "reopen") && {
        duration: Number.POSITIVE_INFINITY,
      }),
      id: nextToastId(),
    };
    dismissToast();
    shownToast.current =
      notice.tone === "info"
        ? toast.info(notice.title, options)
        : toast.error(notice.title, options);
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
    clearLive();
    setPhase({ kind: "idle" });
    if (error) {
      kept.current = { audio, deliver, onLanded };
      report({ kind: "server" }, retryKept);
      return;
    }
    if (result.ok) {
      kept.current = undefined;
      dismissToast();
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
      os: currentOs(),
    });
    kept.current = notice.keepsRecording
      ? { audio, deliver, onLanded }
      : undefined;
    if (problem.kind === "billing-refused") {
      const billing = await readBilling();
      report(problem, retryKept, billing);
      return;
    }
    report(problem, retryKept);
  };

  /**
   * Says why billing ended a take mid-stream. The stream's end names no
   * refusal, so billing's status for dictation says what it was.
   */
  const reportLimit = async () => {
    const billing = await readBilling();
    const pause = featurePause(billing.status, "dictation", billing.refusedAt);
    const code = pause?.code;
    report(
      {
        kind: "billing-stopped",
        ...((code === "subscription-required" ||
          code === "usage-limit-exceeded") && {
          refusal: {
            code,
            reason: pause?.reason,
            resetsAt: pause?.resetsAt?.toISOString(),
          },
        }),
      },
      undefined,
      billing,
    );
  };

  // Only from rest: a retry while another take records or lands would set
  // the phase under it.
  const busy = useRef(false);
  function retryKept() {
    const take = kept.current;
    if (!take || session.current || busy.current) {
      return;
    }
    busy.current = true;
    setPhase({ kind: "transcribing" });
    void transcribe(take.audio, take.deliver, take.onLanded).finally(() => {
      busy.current = false;
    });
  }

  const stopTicker = () => {
    if (session.current?.ticker !== undefined) {
      clearInterval(session.current.ticker);
    }
    setMicStream(undefined);
  };

  const playCue = (cue: "start" | "stop") => {
    if (latest.current.preferences?.dictationSounds !== false) {
      playDictationCue(cue);
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
    playCue("stop");
    session.current = undefined;
    const length = capture.elapsedMs();
    const stream = current.live;
    const streaming = stream?.status === "live";
    setPhase({
      kind: "transcribing",
      ...(streaming && { live: true }),
    });
    void capture
      .stop()
      .then(async (audio) => {
        if (length < MIN_RECORDING_MS) {
          clearLive();
          setPhase({ kind: "idle" });
          report({ kind: "too-short" });
          return;
        }
        const end = stream && streaming ? await finishLive(stream) : undefined;
        if (stream && end?.complete) {
          const text = stream.finals.join(" ");
          clearLive();
          setPhase({ kind: "idle" });
          kept.current = undefined;
          dismissToast();
          if (finish(text, current.deliver)) {
            onLanded?.();
          }
          if (end.reason === "limit") {
            void reportLimit();
          }
          return;
        }
        // The stream missed some of the take, or never had it: the whole
        // recording is transcribed instead, as it would be without one.
        stream?.abort.abort();
        setPhase({ kind: "transcribing" });
        return transcribe(audio, current.deliver, onLanded);
      })
      .finally(() => {
        // Quitting asks until the words have landed or the take has failed.
        current.release?.();
      });
  };

  const cancel = () => {
    const current = session.current;
    if (!current) {
      return;
    }
    current.ended = true;
    stopTicker();
    current.release?.();
    current.capture?.cancel();
    session.current = undefined;
    clearLive();
    setPhase({ kind: "idle" });
  };

  /**
   * Opens the take's live stream and keeps what it hears. A stream that
   * can't open leaves the recording going, for an upload at Stop, unless
   * what refused it would refuse the upload too.
   */
  const openLive = (current: Session) => {
    let settle: (end: StreamEnd | undefined) => void = () => undefined;
    const stream: LiveStream = {
      abort: new AbortController(),
      ended: new Promise((resolve) => {
        settle = resolve;
      }),
      finals: [],
      interim: "",
      pending: [],
      sending: Promise.resolve(),
      status: "connecting",
    };
    current.live = stream;
    shownLive.current = stream;
    publishLive(stream);
    void (async () => {
      let end: StreamEnd | undefined;
      try {
        const events = await rpcClient.dictation.listen.call(
          { surface },
          { signal: stream.abort.signal },
        );
        for await (const event of events) {
          switch (event.type) {
            case "open": {
              stream.id = event.id;
              stream.status = "live";
              for (const chunk of stream.pending.splice(0)) {
                feedLive(stream, chunk);
              }
              break;
            }
            case "unavailable": {
              stream.status = "unavailable";
              const { failure } = event;
              if (session.current === current) {
                if (failure.kind === "signed-out") {
                  cancel();
                  report(failure);
                } else if (failure.kind === "billing-refused") {
                  cancel();
                  const { refusal } = failure;
                  void readBilling().then((billing) => {
                    report(
                      { kind: "billing-stopped", refusal },
                      undefined,
                      billing,
                    );
                  });
                }
              }
              break;
            }
            case "text": {
              if (event.final) {
                if (event.text) {
                  stream.finals.push(event.text);
                }
                stream.interim = "";
              } else {
                stream.interim = event.text;
              }
              break;
            }
            case "end": {
              end = event;
              // Billing ended the take: what was heard lands.
              if (event.reason === "limit" && session.current === current) {
                stop();
              }
              break;
            }
            case "lost": {
              stream.status = "lost";
              break;
            }
          }
          publishLive(stream);
        }
      } catch {
        // Closed by us, or the app's own link went away mid-take.
        if (stream.status === "connecting") {
          stream.status = "unavailable";
        } else if (stream.status === "live" && !end) {
          stream.status = "lost";
        }
        publishLive(stream);
      }
      settle(end);
    })();
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
      // The sign-in dialog would take the place of a dialog this box sits
      // in, and what was written there with it, so only the composer opens it.
      if (surface === "composer") {
        openLogin({ instrumentOnly: true, reason: "dictation" });
      } else {
        dismissToast();
        shownToast.current = toast.info("Log in to dictate", {
          description: `Dictation comes with an ${APP_NAME} account.`,
          id: nextToastId(),
        });
      }
      return;
    }
    const current: Session = {
      deliver,
      ended: false,
    };
    session.current = current;

    const giveUp = (problem?: DictationProblem) => {
      if (session.current === current) {
        session.current = undefined;
        clearLive();
        setPhase({ kind: "idle" });
      }
      if (problem && !current.ended) {
        report(problem);
      }
    };

    // A refusal is known before anything starts, so it goes straight to the
    // toast. macOS asks once, and until then getUserMedia would fail without
    // asking, so the box says it waits on that answer meanwhile.
    const [, access] = await safe(rpcClient.dictation.access.status.call());
    let answer = access;
    if (answer === "not-determined") {
      setPhase({ asking: true, kind: "starting" });
      answer = (await safe(rpcClient.dictation.access.request.call()))[1];
    }
    if (answer === "reopen") {
      giveUp({ kind: "microphone-reopen" });
      return;
    }
    if (answer === "denied" || answer === "restricted") {
      giveUp({ kind: "microphone-refused" });
      return;
    }
    if (current.ended) {
      // Canceled while macOS was asked: the microphone stays closed.
      giveUp();
      return;
    }
    setPhase({ kind: "starting" });

    kept.current = undefined;
    dismissToast();
    // The stream opens while the microphone does, and hears the take from
    // its first chunk once it is ready.
    openLive(current);

    const devices = await navigator.mediaDevices
      .enumerateDevices()
      .then((all) => all.filter((device) => device.kind === "audioinput"))
      .catch(() => []);
    if (current.ended) {
      // Canceled while the microphones were listed: the microphone stays closed.
      giveUp();
      return;
    }
    const chosen = prefs?.dictationMicrophone;
    const microphone = resolveMicrophone(chosen, devices);
    if (microphone.missing && chosen) {
      toast.info("Using the system default microphone", {
        description: `“${microphoneName(chosen.label)}” isn't connected right now.`,
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
    current.release = holdRecording();
    capture.onChunk((chunk) => {
      if (current.live) {
        feedLive(current.live, chunk);
      }
    });
    current.ticker = setInterval(() => {
      if (capture.elapsedMs() >= DICTATION_MAX_MS) {
        stop();
      }
    }, TICK_MS);
    // A microphone that goes away mid-take keeps what it heard.
    capture.onEnded(() => {
      stop();
    });
    setMicStream(capture.stream);
    setPhase({ kind: "recording" });
    playCue("start");
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
    live,
    phase,
    start: () => {
      void start();
    },
    stop,
    stream: micStream,
  };
}
