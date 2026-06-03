import { createFileRoute } from "@tanstack/react-router";

/**
 * Debug-only kind that throws on render so the `/studio-overlay` errorComponent
 * fallback (a dismissible error) can be verified. Reached via the dev panel.
 */
export const Route = createFileRoute("/studio-overlay/crash")({
  component: CrashModal,
});

function CrashModal(): never {
  throw new Error("Studio overlay crash test: this modal throws on render.");
}
