import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import {
  type SessionMessage,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

/**
 * A transcript written as the things that happened, in order.
 *
 * A scenario is a list of these and nothing else. Turning one into the frames a
 * scrubber steps through is [frames.ts](./frames.ts)'s job, so a scenario says
 * what happened and never how it is drawn -- which is what makes it safe to add
 * cases without knowing the rendering rules.
 *
 * Everything here is typed against the schema the runtime writes: tool `input`
 * and `output` are read off the part union by `type`, and a data part's `data`
 * off the data-part union by its name. A call with the wrong fields, one naming
 * a tool that has since been renamed or removed, or a data part whose shape has
 * moved, is a compile error rather than a fixture that quietly rots.
 */
export type Act =
  | ToolCall
  | { acts: Act[]; kind: "same-step" }
  | { calls: ToolCall[]; kind: "batch" }
  | { chunkCount?: number; kind: "prose"; text: string }
  | { error: TurnError; kind: "fail"; model?: AIGatewayModel.Type }
  | { kind: "context"; realRole: ContextRole; text: string }
  | { kind: "empty-step" }
  | { kind: "max-steps"; maxStepCount: number }
  | { kind: "notes"; parts: DataPart[] }
  | { kind: "pause" }
  | { kind: "reasoning"; text: string }
  | { kind: "stop" }
  | { kind: "user"; parts: DataPart[]; text: string };

/** One of the `data-*` parts a message can carry, minus what the store assigns. */
export type DataPart = Omit<SessionMessagePart.DataPart, "metadata">;

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

/** How a turn ended when it ended badly, as the assistant metadata holds it. */
export type TurnError = NonNullable<
  SessionMessage.AssistantWithParts["metadata"]["error"]
>;

/** Whose words a context message carries, once it is unpacked for a model. */
type ContextRole = SessionMessage.ContextWithParts["metadata"]["realRole"];

type PartOfType<TType extends ToolType> = Extract<
  SessionMessagePart.ToolPart,
  { type: TType }
>;

/**
 * A call, at rest and while its input was still arriving.
 *
 * Written as a mapped type over the tool names rather than a generic, so each
 * member resolves to one concrete tool and TypeScript narrows a call by its
 * `type` the same way it narrows the part itself.
 */
type ToolCallShape =
  | UnknownToolCall
  | {
      [TType in ToolType]: {
        /**
         * What the input looked like part-way through arriving, for a case that
         * is about the arrival: half a path is a chip drawn from half a path.
         * Left alone, a streaming call carries no input at all, which is the row
         * drawn from the tool's name alone.
         */
        streamed?: Partial<ToolInput<TType>>;
      } & (
        | { error: string; input: ToolInput<TType>; type: TType }
        | { input: ToolInput<TType>; output: ToolOutput<TType>; type: TType }
      );
    }[ToolType];

/** The arguments of one tool, exactly as that tool declares them. */
type ToolInput<TType extends ToolType> = NonNullable<
  PartOfType<TType>["input"]
>;

/**
 * Every tool a scenario can call by name, as the part union names them.
 *
 * `unavailable` is left out. It is not a tool the agent calls: the runtime emits
 * it for a call naming something that does not exist, so its input is whatever
 * the model sent and is typed `any`. Including it here would put that `any` into
 * every call's input type and quietly switch the checking off for all of them;
 * `unknownTool` writes one out instead.
 */
type ToolType = Exclude<
  SessionMessagePart.ToolPart["type"],
  "tool-unavailable"
>;

/**
 * A call naming a tool that does not exist.
 *
 * Written out rather than taken from the part union for the reason `ToolType`
 * gives: the runtime types both sides of it as `any`, since they are whatever
 * the model sent.
 */
type UnknownToolCall = UnknownToolSpec & {
  streamed?: Record<string, unknown>;
  type: "tool-unavailable";
};

/** What a scenario writes for one: there is only the one tool it can name. */
type UnknownToolSpec =
  | { error: string; input: Record<string, unknown> }
  | { input: Record<string, unknown>; output: Record<string, unknown> };

/** Calls the model asked for in one response, worked off the queue in order. */
export function batch(...calls: ToolCall[]): Act {
  return { calls, kind: "batch" };
}

export function call(spec: ToolCallShape): ToolCall {
  return { ...spec, kind: "call" };
}

/**
 * The standing prompt a session opens with, as its own message.
 *
 * Persisted once per session rather than rebuilt per turn, and drawn only in
 * developer mode, so it is the one thing at the top of a transcript that nobody
 * normally sees.
 */
export function context(realRole: ContextRole, text: string): Act {
  return { kind: "context", realRole, text };
}

/**
 * A step that produced nothing to draw.
 *
 * A real one is a step the model opened and closed without saying anything, and
 * it matters because the turn's chrome has to step over it and land on the first
 * thing there is to see.
 */
export function emptyStep(): Act {
  return { kind: "empty-step" };
}

/** The turn ends here, badly. */
export function fail(error: TurnError, model?: AIGatewayModel.Type): Act {
  return { error, kind: "fail", model };
}

/** The run hit the unattended step cap, which the workspace says for itself. */
export function maxSteps(maxStepCount: number): Act {
  return { kind: "max-steps", maxStepCount };
}

/** Data parts riding on the open step, for what the turn did to the task. */
export function notes(...parts: DataPart[]): Act {
  return { kind: "notes", parts };
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

/** A call for a tool the model invented, which the runtime cannot dispatch. */
export function unknownTool(spec: UnknownToolSpec): ToolCall {
  return { ...spec, kind: "call", type: "tool-unavailable" };
}

/** What the user sent, and whatever the app attached to it on the way out. */
export function user(text: string, ...parts: DataPart[]): Act {
  return { kind: "user", parts, text };
}
