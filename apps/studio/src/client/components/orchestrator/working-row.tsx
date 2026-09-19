import { PlanningDotIcon } from "@/client/components/icons/planning-dot";

/**
 * The thread at work with nothing being typed: a task of its own is running,
 * or its agent is between steps, and the next thing to land here is theirs.
 * Drawn at the transcript's tail where the reply will arrive, as the agent's
 * breathing dot and a line saying so, rather than as a bubble, since a bubble
 * is a reply and this is the promise of one. The line over the composer says
 * which task and what step; this says only that the wait is a live one.
 */
export function WorkingRow() {
  return (
    <div
      aria-live="polite"
      className="-ml-1 flex animate-in items-center gap-1 py-1 fill-mode-both fade-in"
    >
      <PlanningDotIcon />
      <span className="brand-shiny-text text-sm">Instrument is working</span>
    </div>
  );
}
