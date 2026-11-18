import { type DebugStateEntry } from "./types";

/**
 * The states this page draws, each reached at its `?state=`: every surface
 * whose words or buttons follow how the trial starts.
 */
export const trialStates = [
  { id: "setup-outcome", label: "Setup outcome" },
  { id: "settings-plan", label: "Plan in Settings" },
  { id: "model-picker", label: "Model picker" },
  { id: "chat-note", label: "Chat note" },
  { id: "chat-note-refused", label: "Note after a refused turn" },
  { id: "chat-note-image", label: "Note after a refused image" },
  { id: "chat-note-image-signed-out", label: "Image note, signed out" },
  { id: "add-provider", label: "Add a provider" },
  { id: "log-in-free-account", label: "Free account sign-in" },
] as const satisfies readonly DebugStateEntry[];
