import { useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";

import {
  type FilesIntent,
  nextStep,
  routedStep,
  type SettledStep,
  sentStep,
  shownStepOf,
  springEnded,
  sprungStep,
} from "./files-step";

/**
 * Moves the Files tab the way a change asks. `endSpring` is the end of a drag
 * that opened folders under itself: `dropped` into one of them, or not.
 */
export type GoFiles = (
  intent: FilesIntent | { dropped: boolean; type: "endSpring" },
) => void;

/**
 * Where the Files tab stands: the step its address holds, with the steps it
 * has just written shown ahead of the router rendering them (`ShownStep`).
 * `go` writes a change to the address, synchronously, as a step of its own or
 * in place of the one on screen; `arrivals` counts the address moving on its
 * own (back, forward, a place picked elsewhere).
 */
export function useFilesStep(routed: SettledStep) {
  const navigate = useNavigate();
  const [shown, setShown] = useState(() => shownStepOf(routed));
  // Read during render, as the props of an address that has moved.
  const next = routedStep(shown, routed);
  if (next !== shown) {
    setShown(next);
  }
  // What `go` builds on: every change made in one event sees the ones made
  // before it, which the state of the render it was handed cannot.
  const latest = useRef(next);
  useLayoutEffect(() => {
    latest.current = shown;
  }, [shown]);
  const send = (step: SettledStep, write: "push" | "replace") => {
    latest.current = sentStep(latest.current, step);
    setShown(latest.current);
    void navigate({
      replace: write === "replace",
      search: step,
      to: "/files",
    });
  };
  const go: GoFiles = (intent) => {
    if (intent.type === "endSpring") {
      if (latest.current.sprungFrom === undefined) {
        return;
      }
      const ended = springEnded(latest.current, intent.dropped);
      latest.current = ended.shown;
      setShown(latest.current);
      for (const each of ended.writes) {
        send(each.step, each.write);
      }
      return;
    }
    const from = latest.current.step;
    const { step, write } = nextStep(from, intent);
    if (write === "none") {
      return;
    }
    if (intent.type === "spring") {
      latest.current = sprungStep(latest.current, from);
    }
    send(step, write);
  };
  return { arrivals: next.arrivals, go, step: next.step };
}
