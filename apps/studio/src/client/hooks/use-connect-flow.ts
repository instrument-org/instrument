import { type ConnectOutcome } from "@/shared/connect-outcome";
import { useEffect, useRef, useState } from "react";

/**
 * Where a connect stands: idle, waiting on the browser, checking the plan,
 * or signed in with the website taking the person through its plans.
 */
export type ConnectPhase = "checking" | "idle" | "on-web" | "signing-in";

/** How a connect ended, with the model it made the default when it made one. */
export interface ConnectResult {
  modelName?: string;
  outcome: ConnectOutcome;
}

/** What one attempt is handed: its own signal, and a way to say its phase. */
interface Attempt {
  /** Moves the attempt on, while it is still the current one. */
  onPhase: (phase: ConnectPhase) => void;
  /** Ends when the attempt is canceled, replaced, or its surface unmounts. */
  signal: AbortSignal;
}

export interface ConnectFlow<Input> {
  cancel: () => void;
  /** The last attempt's answer, until the next one starts or `reset`. */
  outcome: ConnectOutcome | undefined;
  modelName: string | undefined;
  phase: ConnectPhase;
  /** Forgets the last answer, for a surface going back to its start. */
  reset: () => void;
  /**
   * Starts an attempt, replacing any under way. Resolves with how it ended,
   * `canceled` once `cancel` ends it, and undefined when a newer attempt or
   * an unmount dropped it, so a caller acts only on an answer that is still
   * its own.
   */
  start: (input: Input) => Promise<ConnectResult | undefined>;
  waiting: boolean;
}

/**
 * One way in's connect, from the press to the answer, guarded so only the
 * newest attempt lands: a result that arrives after a newer press, a cancel,
 * or the surface going away is dropped. Every attempt the hook settles puts
 * the phase back to idle, so a retry that lands on the same page never stays
 * waiting, and each hook keeps its own answer, so nothing leaks from one way
 * in to another.
 */
export function useConnectFlow<Input>({
  onCancel,
  run,
}: {
  /** Ends the provider's own side of an attempt in `phase`. */
  onCancel: (phase: ConnectPhase) => void;
  run: (input: Input, attempt: Attempt) => Promise<ConnectResult>;
}): ConnectFlow<Input> {
  const [phase, setPhase] = useState<ConnectPhase>("idle");
  const [result, setResult] = useState<ConnectResult>();
  const current = useRef<AbortController>(undefined);
  const phaseRef = useRef<ConnectPhase>("idle");

  const moveTo = (next: ConnectPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(
    () => () => {
      // Gone from the screen: whatever is still out lands nowhere.
      current.current?.abort();
      current.current = undefined;
    },
    [],
  );

  const start = async (input: Input): Promise<ConnectResult | undefined> => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const isCurrent = () => current.current === controller;
    setResult(undefined);
    moveTo("signing-in");
    const settled = await run(input, {
      onPhase: (next) => {
        if (isCurrent()) {
          moveTo(next);
        }
      },
      signal: controller.signal,
    }).catch(
      (error: unknown): ConnectResult => ({
        outcome: {
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    );
    if (!isCurrent()) {
      return controller.signal.reason === CANCELED
        ? { outcome: { kind: "canceled" } }
        : undefined;
    }
    current.current = undefined;
    moveTo("idle");
    setResult(settled);
    return settled;
  };

  const cancel = () => {
    const controller = current.current;
    if (!controller) {
      return;
    }
    current.current = undefined;
    onCancel(phaseRef.current);
    controller.abort(CANCELED);
    moveTo("idle");
    setResult(undefined);
  };

  return {
    cancel,
    modelName: result?.modelName,
    outcome: result?.outcome,
    phase,
    reset: () => {
      setResult(undefined);
    },
    start,
    waiting: phase !== "idle",
  };
}

/** The reason an attempt's signal carries when the person canceled it. */
const CANCELED = new Error("Canceled");
