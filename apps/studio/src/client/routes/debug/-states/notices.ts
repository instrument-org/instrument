import { type DebugStateEntry } from "./types";

/** The states this page draws, each reached at its `?state=`. */
export const noticesStates = [
  { id: "loading", label: "Loading", tab: "model-notices" },
  { id: "fine", label: "Fine", tab: "model-notices" },
  { id: "newer-release", label: "Newer release listed", tab: "model-notices" },
  {
    id: "newer-release-dismissed",
    label: "Newer release, offer dismissed",
    tab: "model-notices",
  },
  {
    id: "restricted-auto-fallback",
    label: "Restricted, with Auto to fall back on",
    tab: "model-notices",
  },
  {
    id: "withdrawn-series-continues",
    label: "Withdrawn, its series continues",
    tab: "model-notices",
  },
  {
    id: "withdrawn-nothing-continues",
    label: "Withdrawn, nothing continues it",
    tab: "model-notices",
  },
  {
    id: "provider-removed-same-model",
    label: "Provider removed, same model elsewhere",
    tab: "model-notices",
  },
  {
    id: "provider-off-same-model",
    label: "Provider turned off, same model elsewhere",
    tab: "model-notices",
  },
  {
    id: "provider-removed-instrument-first",
    label: "Provider removed, same model through OpenRouter and Instrument",
    tab: "model-notices",
  },
  {
    id: "claude-account-signed-out",
    label: "Claude account signed out",
    tab: "model-notices",
  },
  {
    id: "restricted-by-plan",
    label: "Restricted on Instrument, by the plan",
    tab: "model-notices",
  },
  {
    id: "claude-account-disconnected",
    label: "Claude account disconnected",
    tab: "model-notices",
  },
  {
    id: "claude-account-only",
    label: "Claude account disconnected, nothing else listed",
    tab: "model-notices",
  },
  {
    id: "instrument-logged-out",
    label: "Instrument logged out",
    tab: "model-notices",
  },
  {
    id: "other-computer-same-kind",
    label: "Another computer's connection, one of the kind here",
    tab: "model-notices",
  },
  {
    id: "other-computer-other-kind",
    label: "Another computer's connection, only another kind here",
    tab: "model-notices",
  },
  {
    id: "provider-failed",
    label: "Its provider failed to load",
    tab: "model-notices",
  },
  { id: "list-failed", label: "The list failed", tab: "model-notices" },
  { id: "none-chosen", label: "No model chosen", tab: "model-notices" },
  { id: "nothing-listed", label: "Nothing listed", tab: "model-notices" },
  { id: "brief-toast", label: "Brief toast", tab: "toasts" },
  { id: "success-toast", label: "Success toast", tab: "toasts" },
  { id: "info-toast", label: "Info toast", tab: "toasts" },
  { id: "message-toast", label: "Message toast", tab: "toasts" },
  { id: "error-toast", label: "Error toast", tab: "toasts" },
  {
    id: "error-toast-action",
    label: "Error toast with an action",
    tab: "toasts",
  },
  { id: "developer-toast", label: "Developer toast", tab: "toasts" },
  {
    id: "contact-error-retry",
    label: "Contact error alert with retry",
    tab: "alerts",
  },
  { id: "simple-error", label: "Simple error card", tab: "error-card" },
  { id: "error-with-code", label: "Error card with a code", tab: "error-card" },
  {
    id: "error-with-cause",
    label: "Error card with a cause",
    tab: "error-card",
  },
  { id: "window-crash", label: "Window crash", tab: "error-card" },
] as const satisfies readonly DebugStateEntry[];

type NoticesState = (typeof noticesStates)[number];

/** The states drawn under one of this page's tabs, by id. */
export type NoticesStateId<Tab extends NoticesState["tab"]> = Extract<
  NoticesState,
  { tab: Tab }
>["id"];

/** The states drawn under one of this page's tabs, in the page's order. */
export function noticesStatesOn<Tab extends NoticesState["tab"]>(tab: Tab) {
  return noticesStates.filter(
    (state): state is Extract<NoticesState, { tab: Tab }> => state.tab === tab,
  );
}
