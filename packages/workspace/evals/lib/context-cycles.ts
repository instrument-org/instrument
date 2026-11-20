/**
 * How a long session spent its context window, read back from its records:
 * each request's prompt size, each clearing and each rollover, what a cycle
 * between two rollovers had to work with, and what the agent did right after
 * one. For a case scored on the cost of context management rather than only on
 * whether the work got done.
 *
 * One assistant message with `usage` is one request, its usage what the
 * provider reported for it, cache reads included; a reply with none, as a
 * case seeds an earlier conversation with, is no request, and a rollover
 * before the first request is part of that conversation, not of the run. A
 * summary rollover's own request is not a message; its usage is on the
 * `data-contextRollover` part.
 */
import { isToolPart } from "../../src/lib/is-tool-part";
import { type Session } from "../../src/schemas/session";

type Message = Session.WithMessagesAndParts["messages"][number];

/** What one request's calls did, as the case judges it from their commands. */
export type StepKind = "act" | "other" | "read";

interface ContextStep {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** The `bash` commands the step ran, each cut to 200 characters. */
  commands: string[];
  kind: StepKind;
  messageId: string;
  outputTokens: number;
  /** The request's prompt, cache reads and writes included. */
  prompt: number;
  /** Whether a result in this step handed over the browser guide. */
  sentBrowserGuide: boolean;
  text: string;
}

interface Rollover {
  /** Steps after the rollover that only read, before the first that acted. */
  readStepsBeforeAct: number;
  /** The step the rollover came after, 0-based over the session's requests. */
  afterStep: number;
  droppedMessages: number;
  /** Whether the newest message dropped was a step with a tool result in it. */
  droppedNewestToolResult: boolean;
  /** The first thing the agent said after the rollover, cut to 300 characters. */
  firstTextAfter?: string;
  /** The last command before the cut, cut to 200 characters. */
  lastCommandBefore?: string;
  /** The prompt of the first request after the rollover. */
  promptAfter?: number;
  /** The prompt the summary was asked from: the request at the cut. */
  promptAtCut: number;
  /** Whether a step after it ran the last command before the cut again. */
  reranLastCommand: boolean;
  /** `promptAtCut - promptAfter`: what the cycle before it had to work in. */
  room?: number;
  summary?: string;
  summaryCacheReadTokens?: number;
  summaryCacheWriteTokens?: number;
  summaryInputTokens?: number;
  summaryOutputTokens?: number;
}

interface Clearing {
  afterStep: number;
  promptAfter?: number;
  promptBefore: number;
  results: number;
}

export interface ContextCycles {
  clearings: Clearing[];
  /** Estimated USD at `price`, every request priced at the step's rate past it. */
  estimatedUSD?: number;
  rollovers: Rollover[];
  steps: ContextStep[];
  /** Prompt tokens over every request, the summaries' included. */
  totalInputTokens: number;
  totalOutputTokens: number;
}

/** Dollars per million tokens, and the prompt size past which all of them multiply. */
export interface SteppedPrice {
  cacheRead: number;
  cacheWrite: number;
  input: number;
  output: number;
  /** Prompt tokens from which every rate is `stepMultiplier` times higher. */
  step: number;
  stepMultiplier: number;
}

function promptOf(message: Message): number {
  return message.role === "assistant"
    ? (message.metadata.usage?.inputTokens ?? 0)
    : 0;
}

function commandsOf(message: Message): string[] {
  return message.parts.flatMap((part) =>
    part.type === "tool-bash" && part.input?.command !== undefined
      ? [part.input.command.slice(0, 200)]
      : [],
  );
}

function textOf(message: Message): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function sentBrowserGuide(message: Message): boolean {
  return message.parts.some((part) => {
    if (!isToolPart(part) || part.state !== "output-available") {
      return false;
    }
    const output: unknown = part.output;
    // A pointer to a guide handed over before the window (`earlier`) is not
    // the guide.
    return (
      typeof output === "object" &&
      output !== null &&
      "browserSkill" in output &&
      !(
        typeof output.browserSkill === "object" &&
        output.browserSkill !== null &&
        "earlier" in output.browserSkill
      )
    );
  });
}

function priced(
  price: SteppedPrice,
  {
    cacheRead,
    cacheWrite,
    input,
    output,
  }: { cacheRead: number; cacheWrite: number; input: number; output: number },
): number {
  const times = input > price.step ? price.stepMultiplier : 1;
  const fresh = Math.max(0, input - cacheRead - cacheWrite);
  return (
    (times *
      (fresh * price.input +
        cacheRead * price.cacheRead +
        cacheWrite * price.cacheWrite +
        output * price.output)) /
    1_000_000
  );
}

/**
 * The cycles of one session. `classify` says from a step's commands whether
 * it read state, acted on it, or did neither, which only the case knows.
 */
export function contextCycles(
  session: Session.WithMessagesAndParts,
  {
    classify,
    price,
  }: { classify: (commands: string[]) => StepKind; price?: SteppedPrice },
): ContextCycles {
  const messages = session.messages;
  const steps: ContextStep[] = [];
  /** Each message's position among the requests: the step it is or follows. */
  const stepAt = new Map<string, number>();
  for (const message of messages) {
    if (message.role === "assistant" && message.metadata.usage !== undefined) {
      const commands = commandsOf(message);
      steps.push({
        cacheReadTokens:
          message.metadata.usage?.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWriteTokens:
          message.metadata.usage?.inputTokenDetails.cacheWriteTokens ?? 0,
        commands,
        kind: classify(commands),
        messageId: message.id,
        outputTokens: message.metadata.usage?.outputTokens ?? 0,
        prompt: promptOf(message),
        sentBrowserGuide: sentBrowserGuide(message),
        text: textOf(message),
      });
    }
    stepAt.set(message.id, steps.length - 1);
  }

  const rollovers: Rollover[] = [];
  const clearings: Clearing[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-toolResultsCleared") {
        const afterStep = stepAt.get(part.metadata.messageId) ?? -1;
        clearings.push({
          afterStep,
          promptAfter: steps[afterStep + 1]?.prompt,
          promptBefore: steps[afterStep]?.prompt ?? 0,
          results: part.data.results,
        });
      }
      if (part.type !== "data-contextRollover") {
        continue;
      }
      const boundary = messages.find(
        (one) => one.id === part.metadata.messageId,
      );
      const afterStep = stepAt.get(part.metadata.messageId) ?? -1;
      if (afterStep === -1) {
        continue;
      }
      const before = steps[afterStep];
      // A summary asked for again records both attempts' usage added
      // together, which reads here as a cut twice its size.
      const promptAtCut =
        part.data.summaryUsage?.inputTokens ?? before?.prompt ?? 0;
      const promptAfter = steps[afterStep + 1]?.prompt;
      const later = steps.slice(afterStep + 1);
      const firstAct = later.findIndex((step) => step.kind === "act");
      const lastCommandBefore = before?.commands.at(-1);
      rollovers.push({
        afterStep,
        droppedMessages: part.data.droppedMessages,
        droppedNewestToolResult:
          boundary?.role === "assistant" &&
          boundary.parts.some(
            (one) => isToolPart(one) && one.state === "output-available",
          ),
        firstTextAfter: later
          .find((step) => step.text !== "")
          ?.text.slice(0, 300),
        lastCommandBefore,
        promptAfter,
        promptAtCut,
        readStepsBeforeAct: (firstAct === -1
          ? later
          : later.slice(0, firstAct)
        ).filter((step) => step.kind === "read").length,
        reranLastCommand:
          lastCommandBefore !== undefined &&
          // Up to and including the first step that acted, which is where a
          // lost call is run again.
          (firstAct === -1 ? later : later.slice(0, firstAct + 1)).some(
            (step) => step.commands.includes(lastCommandBefore),
          ),
        room: promptAfter === undefined ? undefined : promptAtCut - promptAfter,
        summary: part.data.summary,
        summaryCacheReadTokens: part.data.summaryUsage?.cacheReadTokens,
        summaryCacheWriteTokens: part.data.summaryUsage?.cacheWriteTokens,
        summaryInputTokens: part.data.summaryUsage?.inputTokens,
        summaryOutputTokens: part.data.summaryUsage?.outputTokens,
      });
    }
  }

  const summaries = rollovers.map((rollover) => ({
    cacheRead: rollover.summaryCacheReadTokens ?? 0,
    cacheWrite: rollover.summaryCacheWriteTokens ?? 0,
    input: rollover.summaryInputTokens ?? 0,
    output: rollover.summaryOutputTokens ?? 0,
  }));
  const requests = [
    ...steps.map((step) => ({
      cacheRead: step.cacheReadTokens,
      cacheWrite: step.cacheWriteTokens,
      input: step.prompt,
      output: step.outputTokens,
    })),
    ...summaries,
  ];
  return {
    clearings,
    estimatedUSD:
      price === undefined
        ? undefined
        : requests.reduce((sum, request) => sum + priced(price, request), 0),
    rollovers,
    steps,
    totalInputTokens: requests.reduce((sum, request) => sum + request.input, 0),
    totalOutputTokens: requests.reduce(
      (sum, request) => sum + request.output,
      0,
    ),
  };
}

/** The p50 and max of a list of numbers, 0 for an empty one. */
export function spreadOf(values: number[]): { max: number; p50: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    max: sorted.at(-1) ?? 0,
    p50: sorted[Math.floor(sorted.length / 2)] ?? 0,
  };
}
