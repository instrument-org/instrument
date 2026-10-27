import { isPlainObject } from "radashi";
import { z } from "zod";

import { recordAppGuideHandOff } from "../apps/guide-hand-off";
import { recordRaisedAsk } from "../shell-commands/raised-asks";
import {
  type Capability,
  type CapabilityContext,
  type CapabilityErrorReply,
  CapabilityFailure,
  type Gate,
} from "./define";
import { CAPABILITIES } from "./registry";

/** A call's answer: the parsed input and the output, or the error a surface reports. */
export type Dispatched =
  | { capability: Capability; input: Record<string, unknown>; output: unknown }
  | { error: CapabilityErrorReply };

/** One capability as a script's describe handshake reads it. */
export interface DescribedCapability {
  /** The input's JSON Schema, which Python builds a signature from. */
  input: unknown;
  name: string;
  /** Fields a script passes in order, before the rest. */
  positional: string[];
  summary: string;
}

/** Whether a capability exists for this call: its platform, its build, the shell's role. */
function availableHere(
  capability: Capability,
  ctx: CapabilityContext,
): boolean {
  const { where } = capability;
  return (
    (where?.platforms?.includes(process.platform) ?? true) &&
    (where?.available?.() ?? true) &&
    (where?.roles?.includes(ctx.role) ?? true)
  );
}

function onSurface(capability: Capability, ctx: CapabilityContext): boolean {
  return ctx.surface === "cli"
    ? capability.surfaces.cli !== undefined
    : capability.surfaces.script !== undefined;
}

function snakeCase(key: string): string {
  return key.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * The arguments with each top-level key the capability does not declare
 * spelled as one it does, in snake_case: a Node script's `startTime` for
 * `start_time`. Keys inside a value are the caller's and stay as they are.
 */
function declaredKeys(capability: Capability, args: unknown): unknown {
  if (!isPlainObject(args)) {
    return args;
  }
  const { shape } = capability.input;
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) =>
      Object.hasOwn(shape, key) || !Object.hasOwn(shape, snakeCase(key))
        ? [key, value]
        : [snakeCase(key), value],
    ),
  );
}

/**
 * One problem with the input, in the words the schema gave it, or Zod's
 * own with the field it is about.
 */
function issueText(issue: z.core.$ZodIssue): string {
  return issue.path.length > 0 &&
    /^(?:Invalid|Too|Expected|Unrecognized)/.test(issue.message)
    ? `${issue.path.join(".")}: ${issue.message}`
    : issue.message;
}

/**
 * What a call that sent nothing says: the guides to read before it is made
 * again, and that a guide counts only where its output is shown.
 */
function guidesMessage(
  guides: readonly { app: string; guide: string }[],
  surface: CapabilityContext["surface"],
): string {
  const next =
    surface === "cli"
      ? "Not sent (exit 3): before the first request to"
      : "Not sent: before the first request to";
  const then =
    surface === "cli" ? "repeat the request" : "run the script again";
  const shown =
    "A guide counts as read only where its output is shown: this one, or `instrument app guide <slug>` printed whole. One sent to /dev/null or cut with head does not count, and the next request stops here again.";
  const [only] = guides;
  if (guides.length === 1 && only) {
    return `${next} "${only.app}", its guide. Read it, then ${then}. ${shown}\n\n${only.guide.trimEnd()}\n`;
  }
  const names = new Intl.ListFormat("en", { type: "conjunction" }).format(
    guides.map(({ app }) => `"${app}"`),
  );
  return `${next} ${names}, the connected API apps whose guides are not read yet. Read them, then ${then}. ${shown}\n\n${guides
    .map(
      ({ app, guide }) =>
        `--- the guide to "${app}" ---\n\n${guide.trimEnd()}\n`,
    )
    .join("\n")}`;
}

/** A gate's answer as the error the surface reports, with what it leaves behind. */
function gateError(
  gate: Exclude<Gate, { kind: "allowed" }>,
  ctx: CapabilityContext,
): CapabilityErrorReply {
  switch (gate.kind) {
    case "ask":
      return { ask: gate.ask, kind: "ask", message: gate.message };
    case "card":
      // The card is up already; the bash call's result says so, and the
      // turn ends on it, whatever the script does after catching this.
      recordRaisedAsk(gate.askId);
      return { kind: "card", message: gate.message };
    case "read-first": {
      const message = guidesMessage(gate.guides, ctx.surface);
      // A hand-off counts once the model is shown it whole in the bash
      // call's output, which is where an uncaught exception prints it.
      for (const { app, guide } of gate.guides) {
        recordAppGuideHandOff({ app, guide, printed: message });
      }
      return { kind: "read-first", message };
    }
    case "refused":
      return { kind: "refused", message: gate.message };
  }
}

/**
 * Runs one call on any surface: finds the capability, checks it exists for
 * this shell and surface, parses the input, runs its gate, then the work.
 * The one place every call passes, so a later check (a review of a send, a
 * rate limit, an audit line) attaches here.
 */
export async function dispatch(
  name: string,
  rawArgs: unknown,
  ctx: CapabilityContext,
  registry: readonly Capability[] = CAPABILITIES,
): Promise<Dispatched> {
  const capability = registry.find((candidate) => candidate.name === name);
  if (!capability || !onSurface(capability, ctx)) {
    return {
      error: { kind: "failed", message: `there is no capability "${name}".` },
    };
  }
  if (!availableHere(capability, ctx)) {
    return {
      error: {
        kind: "refused",
        message:
          capability.where?.roles?.includes(ctx.role) === false
            ? `only the chat has ${capability.name}. Say in your report what the chat should do with it.`
            : `${capability.name} is not available on this computer.`,
      },
    };
  }
  const parsed = capability.input.safeParse(declaredKeys(capability, rawArgs));
  if (!parsed.success) {
    return {
      error: {
        kind: "failed",
        message: parsed.error.issues.map(issueText).join("; "),
      },
    };
  }
  const input = parsed.data;
  try {
    const gate = (await capability.gate?.(input, ctx)) ?? { kind: "allowed" };
    if (gate.kind !== "allowed") {
      return { error: gateError(gate, ctx) };
    }
    return { capability, input, output: await capability.run(input, ctx) };
  } catch (error) {
    // A card the work itself met is up as a gate's is, and ends the turn
    // the same way.
    if (error instanceof CapabilityFailure && error.askId !== undefined) {
      recordRaisedAsk(error.askId);
    }
    return {
      error: {
        kind: error instanceof CapabilityFailure ? error.kind : "failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

const inputSchemas = new WeakMap<Capability, unknown>();

/** The capabilities a script in this shell may call, with their input schemas. */
export function describeCapabilities(
  ctx: CapabilityContext,
  registry: readonly Capability[] = CAPABILITIES,
): DescribedCapability[] {
  return registry
    .filter(
      (capability) =>
        capability.surfaces.script !== undefined &&
        availableHere(capability, ctx),
    )
    .map((capability) => {
      let input = inputSchemas.get(capability);
      if (input === undefined) {
        input = z.toJSONSchema(capability.input, {
          io: "input",
          unrepresentable: "any",
        });
        inputSchemas.set(capability, input);
      }
      return {
        input,
        name: capability.name,
        positional: [...(capability.surfaces.script?.positional ?? [])],
        summary: capability.summary,
      };
    });
}
