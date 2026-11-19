import { type DebugStateEntry } from "./types";

/** The states this page draws, each reached at its `?state=`. */
export const controlsStates = [
  { id: "input", label: "Input", tab: "form-elements" },
  { id: "textarea", label: "Textarea", tab: "form-elements" },
  { id: "input-group", label: "Input group", tab: "form-elements" },
  { id: "select", label: "Select", tab: "form-elements" },
  { id: "buttons", label: "Buttons", tab: "form-elements" },
  { id: "badge", label: "Badge", tab: "form-elements" },
  { id: "checkbox", label: "Checkbox", tab: "form-elements" },
  { id: "switch", label: "Switch", tab: "form-elements" },
  { id: "tabs", label: "Tabs", tab: "form-elements" },
  { id: "accordion", label: "Accordion", tab: "form-elements" },
  { id: "spinner-sizes", label: "Spinner sizes", tab: "spinner" },
] as const satisfies readonly DebugStateEntry[];
