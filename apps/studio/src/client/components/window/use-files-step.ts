import { useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";

import {
  type FilesIntent,
  nextStep,
  routedStep,
  type SettledStep,
  sentStep,
  shownStepOf,
} from "./files-step";

/** Moves the Files tab the way a change asks. */
export type GoFiles = (intent: FilesIntent) => void;

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
  const go: GoFiles = (intent) => {
    const { step, write } = nextStep(latest.current.step, intent);
    if (write === "none") {
      return;
    }
    latest.current = sentStep(latest.current, step);
    setShown(latest.current);
    void navigate({
      replace: write === "replace",
      search: step,
      to: "/files",
    });
  };
  return { arrivals: next.arrivals, go, step: next.step };
}
