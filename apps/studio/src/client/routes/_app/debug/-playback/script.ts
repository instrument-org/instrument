import { type SessionMessagePart } from "@instrument-org/workspace/client";

/**
 * A transcript written as the things the agent did, in order.
 *
 * A scenario is a list of these and nothing else. Turning one into the frames a
 * scrubber steps through is [frames.ts](./frames.ts)'s job, so a scenario says
 * what happened and never how it is drawn -- which is what makes it safe to add
 * cases without knowing the rendering rules.
 *
 * Tool calls are typed against the tool that receives them: `input` and `output`
 * are read off the part union by `type`, so a call with the wrong fields, or one
 * naming a tool that has since been renamed or removed, is a compile error. The
 * older hand-built fixtures type those as `unknown` and quietly rot instead.
 */
export type Act =
  | ToolCall
  | { acts: Act[]; kind: "same-step" }
  | { calls: ToolCall[]; kind: "batch" }
  | { chunkCount?: number; kind: "prose"; text: string }
  | { kind: "pause" }
  | { kind: "reasoning"; text: string }
  | { kind: "stop" }
  | { kind: "user"; text: string };

export interface Scenario {
  /** What the case is for, shown under the picker. */
  about: string;
  id: string;
  name: string;
  script: Act[];
}

export type ToolCall = ToolCallShape & { kind: "call" };

/** What one tool returns. */
export type ToolOutput<TType extends ToolType> = Extract<
  PartOfType<TType>,
  { state: "output-available" }
>["output"];

/**
 * Every tool a scenario can call, as the part union names them.
 *
 * `unavailable` is left out. It is not a tool the agent calls: the runtime emits
 * it for a call naming something that does not exist, so its input is whatever
 * the model sent and is typed `any`. Including it would put that `any` into
 * every call's input type and quietly switch the checking off for all of them.
 */
export type ToolType = Exclude<
  SessionMessagePart.ToolPart["type"],
  "tool-unavailable"
>;

type PartOfType<TType extends ToolType> = Extract<
  SessionMessagePart.ToolPart,
  { type: TType }
>;

/**
 * A call the queue picked up and ran to completion, or one that failed.
 *
 * Written as a mapped type over the tool names rather than a generic, so each
 * member resolves to one concrete tool and TypeScript narrows a call by its
 * `type` the same way it narrows the part itself.
 */
type ToolCallShape = {
  [TType in ToolType]:
    | { error: string; input: ToolInput<TType>; type: TType }
    | { input: ToolInput<TType>; output: ToolOutput<TType>; type: TType };
}[ToolType];

/** The arguments of one tool, exactly as that tool declares them. */
type ToolInput<TType extends ToolType> = NonNullable<
  PartOfType<TType>["input"]
>;

/** Calls the model asked for in one response, worked off the queue in order. */
export function batch(...calls: ToolCall[]): Act {
  return { calls, kind: "batch" };
}

export function call(spec: ToolCallShape): ToolCall {
  return { ...spec, kind: "call" };
}

/** The agent between steps, with nothing in flight and nothing yet to show. */
export function pause(): Act {
  return { kind: "pause" };
}

/**
 * `chunkCount` is how many growing frames the text arrives over, for a case
 * that is about the arrival itself rather than what was said. Left alone it
 * stays at the handful that is enough to show a row growing.
 */
export function prose(text: string, chunkCount?: number): Act {
  return { chunkCount, kind: "prose", text };
}

export function reasoning(text: string): Act {
  return { kind: "reasoning", text };
}

/**
 * Several acts inside one assistant message.
 *
 * A real turn is one message per step, which is what a bare act produces. This
 * is the other shape a provider can send: several parts arriving together.
 */
export function sameStep(...acts: Act[]): Act {
  return { acts, kind: "same-step" };
}

/** The turn ends here, rather than at the end of the script. */
export function stop(): Act {
  return { kind: "stop" };
}

export function user(text: string): Act {
  return { kind: "user", text };
}
