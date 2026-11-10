import { type ToolName } from "../../tools/types";
import { getToolNameByType } from "../get-tool-name-by-type";
import { type ActivityRow, type TurnStep } from "./turns-of";

/*
 * The words an activity's rows draw, worked out here so the transcript draws
 * them and a chat's find counts them in the records from one place: a match
 * counted in a turn not loaded yet is one the reader finds once it is drawn.
 */

// | undefined ensures runtime type safety
const TOOL_LABELS: Record<ToolName, string | undefined> = {
  ask_permission: "Asked for permission",
  bash: "Ran terminal command",
  choose: "Waiting for answer",
  connect_app: "Asked to connect an app",
  edit_file: "Edited",
  generate_image: "Generated image",
  load_skill: "Loaded skill",
  offer_feedback: "Offered to send feedback",
  read_file: "Read",
  unavailable: "Used unknown tool",
  web_fetch: "Read web page",
  web_search: "Searched web",
  write_file: "Created",
};

const TOOL_WORKING_LABELS: Record<ToolName, string | undefined> = {
  ask_permission: "Asking for permission",
  bash: "Running terminal command",
  choose: "Thinking about a question",
  connect_app: "Asking to connect an app",
  edit_file: "Editing a file",
  generate_image: "Generating an image",
  load_skill: "Loading skill",
  offer_feedback: "Writing up a problem",
  read_file: "Reading file",
  unavailable: "Using unknown tool",
  web_fetch: "Reading web page",
  web_search: "Searching the web",
  write_file: "Creating a file",
};

/** What a finished call of `tool` is called when nothing better names it. */
export function toolLabel(tool: ToolName): string {
  return TOOL_LABELS[tool] ?? "Unknown tool";
}

/** What a call of `tool` still going is called when nothing better names it. */
export function toolWorkingLabel(tool: ToolName): string {
  return TOOL_WORKING_LABELS[tool] ?? "Processing";
}

/**
 * A step's own line: what the agent said the call was for, else what kind of
 * call it is, going on or done.
 */
export function stepLine(step: TurnStep): string {
  if (step.tool === "reasoning") {
    return "Thought";
  }
  if (step.explanation) {
    return step.explanation;
  }
  const tool = getToolNameByType(step.tool);
  return step.status === "running" || step.status === "writing"
    ? toolWorkingLabel(tool)
    : toolLabel(tool);
}

/** An activity's counts as its row writes them: "3 files, 2 pages". */
export function countsLine(counts: ActivityRow["counts"]): string {
  return counts
    .map((counted) => `${counted.count.toString()} ${counted.label}`)
    .join(", ");
}

/**
 * A finished activity as one line, as a turn that does not fold draws it:
 * its name, else its last call's line.
 */
export function activityLine(row: ActivityRow): string {
  const last = row.steps.at(-1);
  return row.title ?? (last ? stepLine(last) : "Thought");
}

/**
 * An activity in an opened Worked row: its name as a heading over its calls'
 * lines. A run the agent didn't name has no heading, since it would only
 * repeat its call, and a named activity of one call is that call's row under
 * the activity's name, with no heading over it.
 */
export function foldedActivityLines(row: ActivityRow): {
  calls: { label: string; step: TurnStep }[];
  heading?: string;
} {
  const [onlyStep] = row.steps;
  if (row.title && onlyStep && row.steps.length === 1) {
    return { calls: [{ label: row.title, step: onlyStep }] };
  }
  const calls = row.steps.map((step) => ({ label: stepLine(step), step }));
  return row.title ? { calls, heading: row.title } : { calls };
}

/** Every line an activity draws, folded in a Worked row or as its own line. */
export function activityWords(
  row: ActivityRow,
  { inFold }: { inFold: boolean },
): string[] {
  const counts = countsLine(row.counts);
  if (!inFold) {
    return [activityLine(row), counts];
  }
  const { calls, heading } = foldedActivityLines(row);
  return [
    ...(heading === undefined ? [] : [heading, counts]),
    ...calls.map((call) => call.label),
  ];
}
