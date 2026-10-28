import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { type ModelMessage } from "ai";
import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FOLDER_NAMES, FOLDER_VARIABLES } from "../constants";
import { type ChatId } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { ChatWrites } from "./chat-writes";
import { isToolPart } from "./is-tool-part";
import { workDir } from "./work-dir";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Old tool results sent as placeholders, for a model billed at a higher rate
 * past a prompt size (`higherPriceFromPromptTokens`).
 *
 * Once a request would come near that size, the oldest results are cleared
 * in one batch, enough to bring it to well under half of it, and the point
 * they were cleared up to is recorded on the newest message as a
 * `data-toolResultsCleared` part. Every request after reads the newest such
 * part and sends the same placeholders, so the history is append-only, and
 * the provider's cache holds, between one clearing and the next: each
 * clearing costs one rebuilt prefix rather than one per step.
 *
 * What is cleared is what a tool returned, and the long text a call was given
 * (a file's contents for `write_file`, a script in a command): each call's
 * name and short arguments, everything the model said or reasoned, and
 * everything the user said are sent whole, so the model still knows what it
 * did and why. A placeholder names the tool and the file its output was
 * saved to when it was cleared. Results that carry
 * instructions (a loaded skill, a guide handed over with a command's output)
 * are never cleared, since the commands that hand them over read the history
 * to decide whether the model already has them.
 *
 * Applied as a view over stored messages, like the rollover: nothing on disk
 * changes, and the transcript shows every result.
 */

/** Fraction of the price step a request may reach before results are cleared. */
const CLEAR_FROM_FRACTION = 0.85;

/** Fraction of the price step a clearing aims to bring the request down to. */
const CLEAR_TO_FRACTION = 0.45;

/**
 * Least a clearing must free, as a fraction of the price step. Each clearing
 * rewrites the cached prefix from the first result it clears, so one that
 * frees little costs more than it saves, and a history whose bulk is not tool
 * results would otherwise clear a sliver on every step.
 */
const MIN_CLEARED_FRACTION = 0.2;

/** Newest results always sent whole: the ones the model is working from. */
const KEPT_NEWEST_RESULTS = 3;

/**
 * Characters per token, to estimate what a result occupies. A selection
 * heuristic, as the rollover's character budget is: the trigger reads the
 * tokens the provider reported, and this only decides how far back to clear.
 * Low on purpose, since Haiku 5.5's tokenizer and the JSON and markup tools
 * return run denser than prose.
 */
const CHARACTERS_PER_TOKEN = 3;

/** Tokens an image or other file in a result is counted as. */
const TOKENS_PER_FILE = 1_600;

/**
 * Characters of text under which a result is always sent whole. A placeholder
 * runs to about 250 characters, so clearing a short result saves little or
 * makes the request longer, and short results (an exit code, a saved note)
 * are the cheapest record of what a call did.
 */
const MIN_CLEARED_CHARACTERS = 2_000;

/** Tokens the placeholder that replaces a result is counted as. */
const PLACEHOLDER_TOKENS = 90;

/** Characters from which a string in a call's input is cleared. */
const MIN_CLEARED_INPUT_CHARACTERS = 1_000;

/** A stored tool call whose result or input may be cleared. */
interface ClearableResult {
  messageId: StoreId.Message;
  partId: StoreId.Part;
  toolCallId: string;
  toolName: string;
}

/** What a result is sent as: its text, and the files beside it. */
interface RenderedResult {
  files: number;
  text: string;
}

/**
 * Whether a result may be cleared: one the app's tool returned, and that
 * carries no instructions the model is working under.
 */
function isClearable(
  part: SessionMessagePart.Type,
): part is SessionMessagePart.ToolPart {
  if (
    !isToolPart(part) ||
    part.state !== "output-available" ||
    part.providerExecuted === true ||
    part.type === "tool-load_skill"
  ) {
    return false;
  }
  const output: unknown = part.output;
  return !(
    typeof output === "object" &&
    output !== null &&
    ("browserSkill" in output || "appGuides" in output)
  );
}

/**
 * Every clearable result in `messages` that is sent at a size worth clearing,
 * oldest first.
 */
function clearableResults(
  messages: readonly SessionMessage.WithParts[],
  rendered: ReadonlyMap<string, RenderedResult>,
): ClearableResult[] {
  return messages.flatMap((message) =>
    message.parts
      .filter(isClearable)
      .filter((part) => {
        const result = rendered.get(part.toolCallId);
        return (
          result !== undefined &&
          (result.files > 0 || result.text.length >= MIN_CLEARED_CHARACTERS)
        );
      })
      .map((part) => ({
        messageId: message.id,
        partId: part.metadata.id,
        toolCallId: part.toolCallId,
        toolName: part.type.slice("tool-".length),
      })),
  );
}

/**
 * A call's input with every string in it of at least
 * {@link MIN_CLEARED_INPUT_CHARACTERS} replaced by a line saying how long it
 * was, and how many characters that takes out; undefined when nothing in it
 * is that long.
 */
function clearedInput(
  input: unknown,
): { characters: number; input: Record<string, unknown> } | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  let characters = 0;
  const cleared = Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (
        typeof value !== "string" ||
        value.length < MIN_CLEARED_INPUT_CHARACTERS
      ) {
        return [key, value];
      }
      const stub = `[${value.length} characters cleared from context]`;
      characters += value.length - stub.length;
      return [key, stub];
    }),
  );
  return characters === 0 ? undefined : { characters, input: cleared };
}

/**
 * Every stored tool call in `messages` whose input may be cleared, oldest
 * first: not one that handed over an app guide, since a guide the model wrote
 * (`app guide <slug> <<EOF`) is in front of it only in that command, and the
 * request gate reads the hand-off from the history.
 */
function toolCalls(
  messages: readonly SessionMessage.WithParts[],
): { messageId: StoreId.Message; part: SessionMessagePart.ToolPart }[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      isToolPart(part) &&
      part.providerExecuted !== true &&
      !handsOverAppGuides(part)
        ? [{ messageId: message.id, part }]
        : [],
    ),
  );
}

function handsOverAppGuides(part: SessionMessagePart.ToolPart): boolean {
  const output: unknown = part.state === "output-available" && part.output;
  return typeof output === "object" && output !== null && "appGuides" in output;
}

/**
 * The last message whose results are cleared, from the clearings recorded in
 * `messages`; undefined where none is.
 */
export function toolResultsClearedThrough(
  messages: readonly SessionMessage.WithParts[],
): StoreId.Message | undefined {
  let through: StoreId.Message | undefined;
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === "data-toolResultsCleared" &&
        (through === undefined || part.data.through > through)
      ) {
        through = part.data.through;
      }
    }
  }
  return through;
}

/**
 * Tokens the request about to be sent is expected to hold: what the model
 * reported for the newest request it measured, plus what that request's
 * reply and the results of its calls add. Undefined when the newest count
 * came from another model, whose tokenizer and price this says nothing about.
 */
export function projectedPromptTokens({
  messages,
  modelId,
  tokensOf,
}: {
  messages: readonly SessionMessage.WithParts[];
  modelId: string;
  tokensOf: (toolCallId: string) => number;
}): number | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }
    const usage = message.metadata.usage;
    if (
      usage?.inputTokens === undefined ||
      !Number.isFinite(usage.inputTokens)
    ) {
      continue;
    }
    if (message.metadata.modelId !== modelId) {
      return undefined;
    }
    let added = usage.outputTokens ?? 0;
    for (const later of messages.slice(index)) {
      for (const part of later.parts) {
        if (isToolPart(part)) {
          added += tokensOf(part.toolCallId);
        }
      }
    }
    return usage.inputTokens + added;
  }
  return undefined;
}

/**
 * Where the next clearing ends, or undefined when none is due: the request is
 * not near the step, or clearing would not free enough to be worth the
 * rebuilt prefix. Clears whole messages, oldest first, from past the last
 * clearing until the estimate is under the target, and never the newest
 * {@link KEPT_NEWEST_RESULTS} calls with something to clear.
 */
export function nextToolResultClearing({
  priceStepTokens,
  projectedTokens,
  results,
  through,
}: {
  priceStepTokens: number;
  projectedTokens: number;
  /**
   * The calls in the window with something to clear, oldest first, with the
   * tokens clearing each would free.
   */
  results: readonly { messageId: StoreId.Message; tokens: number }[];
  /** Where the clearing in force ends. */
  through: StoreId.Message | undefined;
}): { results: number; through: StoreId.Message } | undefined {
  if (projectedTokens < priceStepTokens * CLEAR_FROM_FRACTION) {
    return undefined;
  }
  const open = results.filter(
    (result) => through === undefined || result.messageId > through,
  );
  const keptFrom = open.at(-KEPT_NEWEST_RESULTS)?.messageId;
  if (keptFrom === undefined || open.length <= KEPT_NEWEST_RESULTS) {
    return undefined;
  }
  const wanted = projectedTokens - priceStepTokens * CLEAR_TO_FRACTION;
  let freed = 0;
  let cleared = 0;
  let end: StoreId.Message | undefined;
  for (const result of open) {
    if (result.messageId >= keptFrom) {
      break;
    }
    // A clearing ends on a message, so every result in the last one goes.
    if (freed >= wanted && result.messageId !== end) {
      break;
    }
    freed += result.tokens;
    cleared += 1;
    end = result.messageId;
  }
  if (end === undefined || freed < priceStepTokens * MIN_CLEARED_FRACTION) {
    return undefined;
  }
  return { results: cleared, through: end };
}

/** The tool results in `messages`, by call id, as they are sent. */
function renderedToolResults(
  messages: readonly ModelMessage[],
): Map<string, RenderedResult> {
  const rendered = new Map<string, RenderedResult>();
  for (const message of messages) {
    if (message.role !== "tool" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-result") {
        rendered.set(part.toolCallId, renderedOutput(part.output));
      }
    }
  }
  return rendered;
}

function renderedOutput(
  output: Extract<
    Extract<ModelMessage, { role: "tool" }>["content"][number],
    { type: "tool-result" }
  >["output"],
): RenderedResult {
  switch (output.type) {
    case "text":
    case "error-text": {
      return { files: 0, text: output.value };
    }
    case "json":
    case "error-json": {
      return { files: 0, text: JSON.stringify(output.value, null, 2) };
    }
    case "content": {
      const texts: string[] = [];
      let files = 0;
      for (const item of output.value) {
        if (item.type === "text") {
          texts.push(item.text);
        } else {
          files += 1;
        }
      }
      return { files, text: texts.join("\n\n") };
    }
    case "execution-denied": {
      return { files: 0, text: output.reason ?? "" };
    }
  }
}

function estimatedTokens({ files, text }: RenderedResult): number {
  return (
    Math.ceil(text.length / CHARACTERS_PER_TOKEN) + files * TOKENS_PER_FILE
  );
}

/** Where a cleared result is saved, in the chat's work folder. */
function savedResultPath(partId: StoreId.Part): string {
  return path.posix.join(CHAT_FOLDER_NAMES.toolOutput, `${partId}.txt`);
}

/** What the model is sent in place of a cleared result. */
function clearedResultText({
  characters,
  partId,
  toolName,
}: {
  characters: number;
  partId: StoreId.Part;
  toolName: string;
}): string {
  return `[This ${toolName} result (${characters} characters) was cleared from context to save space. It was saved to $${FOLDER_VARIABLES.work}/${savedResultPath(partId)}: read that file if you need it again, or repeat the call if the file is missing and the call is safe to repeat.]`;
}

/**
 * `messages` with each result named in `placeholders` sent as its text, and
 * the long strings of each call in `calls` cleared from its input.
 */
function withToolResultsCleared(
  messages: readonly ModelMessage[],
  placeholders: ReadonlyMap<string, string>,
  calls: ReadonlySet<string>,
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant" && typeof message.content !== "string") {
      return {
        ...message,
        content: message.content.map((part) => {
          const cleared =
            part.type === "tool-call" && calls.has(part.toolCallId)
              ? clearedInput(part.input)
              : undefined;
          return cleared === undefined
            ? part
            : { ...part, input: cleared.input };
        }),
      };
    }
    if (message.role !== "tool" || typeof message.content === "string") {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part) => {
        const placeholder =
          part.type === "tool-result"
            ? placeholders.get(part.toolCallId)
            : undefined;
        return placeholder === undefined
          ? part
          : { ...part, output: { type: "text", value: placeholder } };
      }),
    };
  });
}

/**
 * The request's messages with old tool results cleared: the clearing in
 * force, and a new one first when the request is near the model's price step
 * and recording it succeeds. A clearing that cannot be recorded is not
 * applied, so the request reads only what is stored.
 *
 * `summaryDue` says the request is near the step with nothing left worth
 * clearing, which is when the conversation is summarized instead
 * (`prepareModelMessages`).
 */
export async function clearOldToolResults({
  chatId,
  messages,
  model,
  modelMessages,
  sessionId,
}: {
  chatId: ChatId;
  /** The stored messages the request is built from, oldest first. */
  messages: readonly SessionMessage.WithParts[];
  model: AIGatewayModel.Type;
  modelMessages: ModelMessage[];
  sessionId: StoreId.Session;
}): Promise<{ messages: ModelMessage[]; summaryDue: boolean }> {
  const rendered = renderedToolResults(modelMessages);
  const tokensOf = (toolCallId: string) => {
    const result = rendered.get(toolCallId);
    return result === undefined ? 0 : estimatedTokens(result);
  };
  const results = clearableResults(messages, rendered);
  let through = toolResultsClearedThrough(messages);

  const priceStepTokens = model.pricing?.higherPriceFromPromptTokens;
  const projectedTokens =
    priceStepTokens === undefined
      ? undefined
      : projectedPromptTokens({
          messages,
          modelId: model.canonicalId,
          tokensOf,
        });
  const next =
    priceStepTokens === undefined || projectedTokens === undefined
      ? undefined
      : nextToolResultClearing({
          priceStepTokens,
          projectedTokens,
          results: savings(messages, results, tokensOf),
          through,
        });
  const newest = messages.at(-1);

  if (next !== undefined && newest !== undefined) {
    const saved = await ChatWrites.savePart(
      {
        data: next,
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId: newest.id,
          sessionId,
        },
        type: "data-toolResultsCleared",
      },
      chatId,
    );
    if (saved.isOk()) {
      await saveClearedResults({
        chatId,
        rendered,
        results: results.filter(
          (result) =>
            result.messageId <= next.through &&
            (through === undefined || result.messageId > through),
        ),
      });
      through = next.through;
    }
  }

  return {
    messages: withRecordedClearing({ messages, modelMessages, through }),
    summaryDue:
      next === undefined &&
      priceStepTokens !== undefined &&
      projectedTokens !== undefined &&
      projectedTokens >= priceStepTokens * CLEAR_FROM_FRACTION,
  };
}

/**
 * `modelMessages` with every clearable result in `messages` up to and
 * including `through` sent as its placeholder: read from the stored messages
 * and the bytes each result is sent as alone, so every request assembles the
 * same history until the next clearing.
 */
export function withRecordedClearing({
  messages,
  modelMessages,
  through,
}: {
  messages: readonly SessionMessage.WithParts[];
  modelMessages: ModelMessage[];
  through: StoreId.Message | undefined;
}): ModelMessage[] {
  if (through === undefined) {
    return modelMessages;
  }
  const rendered = renderedToolResults(modelMessages);
  const placeholders = new Map(
    clearableResults(messages, rendered)
      .filter((result) => result.messageId <= through)
      .map((result) => [
        result.toolCallId,
        clearedResultText({
          characters: rendered.get(result.toolCallId)?.text.length ?? 0,
          partId: result.partId,
          toolName: result.toolName,
        }),
      ]),
  );
  const callsThrough = new Set(
    toolCalls(messages)
      .filter((call) => call.messageId <= through)
      .map((call) => call.part.toolCallId),
  );
  return withToolResultsCleared(modelMessages, placeholders, callsThrough);
}

/**
 * What clearing each call in `messages` would free, for the calls with
 * something to clear, oldest first: its result as sent less the placeholder,
 * when the result is clearable, and the long strings of its input.
 */
function savings(
  messages: readonly SessionMessage.WithParts[],
  results: readonly ClearableResult[],
  tokensOf: (toolCallId: string) => number,
): { messageId: StoreId.Message; tokens: number }[] {
  const clearable = new Set(results.map((result) => result.toolCallId));
  return toolCalls(messages).flatMap(({ messageId, part }) => {
    const result = clearable.has(part.toolCallId)
      ? tokensOf(part.toolCallId) - PLACEHOLDER_TOKENS
      : 0;
    const input = Math.floor(
      (clearedInput(part.input)?.characters ?? 0) / CHARACTERS_PER_TOKEN,
    );
    return result + input > 0 ? [{ messageId, tokens: result + input }] : [];
  });
}

/**
 * Each newly cleared result written where its placeholder says, as the model
 * was sent it. Best effort: a result that could not be saved is still
 * cleared, and its placeholder says to repeat the call.
 */
async function saveClearedResults({
  chatId,
  rendered,
  results,
}: {
  chatId: ChatId;
  rendered: ReadonlyMap<string, RenderedResult>;
  results: readonly ClearableResult[];
}): Promise<void> {
  const report = (error: unknown) =>
    getWorkspaceConfig().captureException(error, {
      area: "tool-result-clearing",
      chatId,
    });
  const folder = path.join(workDir(chatId), CHAT_FOLDER_NAMES.toolOutput);
  try {
    await fs.mkdir(folder, { recursive: true });
  } catch (error) {
    report(error);
    return;
  }
  await Promise.all(
    results.map(async (result) => {
      const output = rendered.get(result.toolCallId);
      if (output === undefined) {
        return;
      }
      const files =
        output.files > 0
          ? `\n\n[${output.files} file(s) the result carried are not saved here]`
          : "";
      try {
        // Never over a file already there: the tool's own copy of its whole
        // output (`web_fetch` spills under the same name), or an earlier save
        // of the same result.
        await fs.writeFile(
          path.join(workDir(chatId), savedResultPath(result.partId)),
          `${output.text}${files}`,
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        ) {
          report(error);
        }
      }
    }),
  );
}
