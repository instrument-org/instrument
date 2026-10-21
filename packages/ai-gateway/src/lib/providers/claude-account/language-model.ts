import {
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4Content,
  type LanguageModelV4FinishReason,
  type LanguageModelV4FunctionTool,
  type LanguageModelV4Message,
  type LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { type EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { createHash, randomUUID } from "node:crypto";

import { CLIENT_SESSION_ID_HEADER } from "../../../constants";
import { noteReportedContextLength } from "../../reported-context-windows";
import {
  coldStartReason,
  planStep,
  splitPrompt,
  type StepStart,
} from "./continuation";
import {
  coldStartContent,
  type ReplayFrame,
  replayFrames,
  splitSystemPrompt,
} from "./prompt";
import {
  readResumeRecord,
  removeResumeRecord,
  writeResumeRecord,
} from "./resume-record";
import {
  ClaudeCodeSession,
  type SessionShape,
  sessionShapeKey,
  TOOL_PREFIX,
  type TranscriptStart,
} from "./session";
import {
  CLAUDE_ACCOUNT_PROVIDER_ID,
  emptyUsage,
  pumpStep,
} from "./step-stream";

/**
 * The live CLI processes, keyed by our session id and the request's shape. A
 * session sends more than its agent's steps under its id (a title, a
 * summary), each with a prompt and tools of its own, and those must not take
 * over the process its steps run in.
 */
const sessions = new Map<string, ClaudeCodeSession>();

/**
 * Ends every live process, as an idle timeout or quitting would. Their
 * transcripts stay, so the next request resumes them.
 */
export function closeClaudeAccountSessions() {
  for (const session of sessions.values()) {
    session.close();
  }
}

/**
 * A Claude account's subscription as an AI SDK model, run through the Claude
 * Code at `executablePath`, signed in through `configDir`. Each step the model
 * takes is one `doStream`, so our agent loop, tools and transcript work as
 * they do for any other model.
 */
export function createClaudeAccountLanguageModel({
  configDir,
  executablePath,
  providerConfigId,
}: {
  configDir: string | undefined;
  executablePath: string;
  /** The connection the account is, which a reported window is noted under. */
  providerConfigId: string;
}) {
  return (modelId: string): LanguageModelV4 => {
    const doStream = (options: LanguageModelV4CallOptions) =>
      Promise.resolve({
        stream: streamStep({
          configDir,
          executablePath,
          modelId,
          options,
          providerConfigId,
        }),
      });
    return {
      doGenerate: async (options) => collect(await doStream(options)),
      doStream,
      modelId,
      provider: CLAUDE_ACCOUNT_PROVIDER_ID,
      specificationVersion: "v4",
      supportedUrls: {},
    };
  };
}

function streamStep({
  configDir,
  executablePath,
  modelId,
  options,
  providerConfigId,
}: {
  configDir: string | undefined;
  executablePath: string;
  modelId: string;
  options: LanguageModelV4CallOptions;
  providerConfigId: string;
}) {
  const key = sessionKeyOf(options);
  const parentKey = parentKeyOf(options);
  const { rest, systemPrompt } = splitSystemPrompt(options.prompt);
  const shape: SessionShape = {
    builtInTools: builtInToolsOf(options),
    configDir,
    effort: effortOf(options),
    executablePath,
    modelId,
    systemPrompt,
    tools: (options.tools ?? []).filter(
      (tool): tool is LanguageModelV4FunctionTool => tool.type === "function",
    ),
  };
  let running: ClaudeCodeSession | undefined;

  return new ReadableStream<LanguageModelV4StreamPart>({
    // The reader went away mid-step: its process cannot finish the step for
    // anyone, so it ends here.
    cancel: () => {
      running?.close();
    },
    start: async (controller) => {
      const shapeHash = createHash("sha256")
        .update(sessionShapeKey(shape))
        .digest("hex");
      // A request with no tools is a one-off (a title, a summary), and so is
      // one that arrives while its session's process is mid-step. Each gets
      // a process of its own that ends with it, and keeps no transcript.
      const slot =
        key === undefined || shape.tools.length === 0
          ? undefined
          : `${key}:${shapeHash}`;
      const existing = slot === undefined ? undefined : sessions.get(slot);
      const persistent = existing?.busy === true ? undefined : slot;
      const prompt = splitPrompt(options.prompt);
      let planned: StepStart<ClaudeCodeSession>["kind"] | undefined;
      const onAbort = () => {
        running?.close();
      };
      options.abortSignal?.addEventListener("abort", onAbort, { once: true });

      try {
        controller.enqueue({ type: "stream-start", warnings: [] });
        // A live process for this slot, or else the transcript its last one
        // left, resumed at its last finished step, or else for a task's
        // first step, its chat's transcript forked where the task branched
        // off.
        const { frames, plan } = withResumeFrames(
          await planStep(
            {
              live: persistent === undefined ? undefined : existing,
              parentRecord: () =>
                persistent === undefined || parentKey === undefined
                  ? Promise.resolve(undefined)
                  : readResumeRecord(configDir, `${parentKey}:${shapeHash}`, {
                      readFor: "fork",
                    }),
              record: () =>
                persistent === undefined
                  ? Promise.resolve({ missing: "no process of its own" })
                  : readResumeRecord(configDir, persistent),
            },
            prompt,
          ),
        );
        const changedShape =
          key === undefined || persistent === undefined
            ? undefined
            : shapeChangeOf(key, shape);
        if (plan.kind === "cold" && persistent !== undefined) {
          // What the live process saw is not what this request continues,
          // and the slot goes on in a new transcript, which its record does
          // not name.
          existing?.close();
          await removeResumeRecord(configDir, persistent);
          if (key !== undefined) {
            closeOtherIdleSlots(key, persistent);
          }
        }
        planned = plan.kind;
        if (plan.kind === "resume") {
          // Its transcript goes on in a new process, cut back to its last
          // finished step.
          existing?.close();
        }
        const session = startOn(plan, persistent, slot, shape);
        running = session;
        session.beginStep(prompt.keptPrints);
        try {
          // Before the step starts, so it runs on the model now asked for.
          await session.useModel(modelId);
          if (plan.kind === "cold") {
            session.noteGiven(rest, { newTurn: true });
            const how = await coldStart(session, rest);
            // A replay re-sends the history uncached and loses what Claude
            // Code's own tools found, so each one says why it happened.
            const why = coldStartReason({
              busy: slot !== undefined && persistent === undefined,
              changedShape,
              kept: prompt.kept,
              oneOff: slot === undefined,
              why: plan.why,
            });
            if (why !== undefined && slot !== undefined) {
              console.warn(
                `[claude-account] session ${slot} cold start (${why.tag}), ${how} replay of ${rest.length} messages: ${why.detail}`,
              );
            }
          } else if (plan.kind === "resume") {
            session.noteGiven(plan.messages, { newTurn: true });
            await session.replay(frames);
          } else {
            await session.continueWith(
              plan.kind === "live"
                ? plan.continuation
                : { kind: "turn", messages: plan.messages },
            );
          }
          await pumpStep(session, controller);
          if (session.contextWindow !== undefined) {
            // Claude Code's own word on the window, which the context budget
            // reads in place of the catalog's from the next request on.
            noteReportedContextLength(
              { params: { providerConfigId }, providerId: modelId },
              session.contextWindow,
            );
          }
        } finally {
          session.endStep();
        }
        // Only a finished step moves the record on: one stopped or failed
        // leaves it naming the step before, which the next request resumes.
        if (
          persistent !== undefined &&
          session.transcript &&
          session.leaf !== undefined
        ) {
          await writeResumeRecord(configDir, persistent, {
            awaitingToolCallIds: session.awaitingToolCallIds,
            claudeSessionId: session.transcript.claudeSessionId,
            forkPoint: session.forkPoint,
            leaf: session.leaf,
            seen: session.seen,
          });
        }
        if (persistent === undefined) {
          // Nothing continues a one-off, so a tool call it ended on would
          // only hold its process open.
          session.close();
        }
        controller.close();
      } catch (error) {
        running?.close();
        // Claude Code refusing the entry a resume starts from is not
        // something a retry changes, so the slot starts cold next time.
        if (
          planned === "resume" &&
          persistent !== undefined &&
          RESUME_REFUSED.test(String(error))
        ) {
          await removeResumeRecord(configDir, persistent);
        }
        controller.enqueue({ error, type: "error" });
        controller.close();
      } finally {
        options.abortSignal?.removeEventListener("abort", onAbort);
      }
    },
  });
}

/**
 * The process a step starts on: the live one, or a new one on the transcript
 * the plan names, or on a new transcript for a cold start. A one-off's keeps
 * no transcript, and is not among the live processes.
 */
function startOn(
  plan: StepStart<ClaudeCodeSession>,
  persistent: string | undefined,
  slot: string | undefined,
  shape: SessionShape,
) {
  const open = (
    start: TranscriptStart,
    claudeSessionId: string = randomUUID(),
  ) => {
    const created = new ClaudeCodeSession(
      slot ?? randomUUID(),
      shape,
      () => {
        if (sessions.get(created.key) === created) {
          sessions.delete(created.key);
        }
      },
      persistent === undefined ? undefined : { claudeSessionId, start },
    );
    if (persistent !== undefined) {
      sessions.set(created.key, created);
    }
    return created;
  };
  switch (plan.kind) {
    case "live": {
      return plan.session;
    }
    case "resume": {
      // Into a transcript of its own, which only this process writes: the
      // one it carries on may still take entries from the process that last
      // wrote it, which a stop or an error closed a moment ago, and Claude
      // Code reads a transcript by its newest entries.
      const session = open({
        at: plan.at,
        from: plan.claudeSessionId,
        kind: "fork",
      });
      console.info(
        `[claude-account] session ${session.key} resumed its Claude Code transcript at its last finished step, replaying ${plan.messages.length} messages after it${plan.restart === undefined ? "" : ` (its live process could not continue: ${plan.restart})`}`,
      );
      return session;
    }
    case "fork": {
      const session = open({ at: plan.at, from: plan.from, kind: "fork" });
      console.info(
        `[claude-account] session ${session.key} forked its parent's Claude Code transcript`,
      );
      return session;
    }
    case "cold": {
      return open({ kind: "new" });
    }
  }
}

/**
 * The frames a resume replays onto its transcript, or a cold start in its
 * place when what the request adds cannot be told as frames.
 */
function withResumeFrames(plan: StepStart<ClaudeCodeSession>): {
  frames: ReplayFrame[];
  plan: StepStart<ClaudeCodeSession>;
} {
  if (plan.kind !== "resume") {
    return { frames: [], plan };
  }
  try {
    return {
      frames: replayFrames(
        plan.messages,
        TOOL_PREFIX,
        plan.awaitingToolCallIds,
      ),
      plan,
    };
  } catch (error) {
    const detail = `what follows its transcript cannot be replayed: ${String(error)}`;
    return {
      frames: [],
      plan: {
        kind: "cold",
        why:
          plan.restart === undefined
            ? { detail, tag: "transcript" }
            : { detail: `${plan.restart}; ${detail}`, tag: "restart" },
      },
    };
  }
}

/**
 * Starts a process that has seen nothing on the request's messages: natively,
 * as turns of its own, when the history can be told that way, else as the
 * lossy text of `coldStartContent`. Says which.
 */
async function coldStart(
  session: ClaudeCodeSession,
  rest: LanguageModelV4Message[],
): Promise<"native" | "text"> {
  let frames: ReturnType<typeof replayFrames> | undefined;
  try {
    frames = replayFrames(rest, TOOL_PREFIX);
  } catch (error) {
    console.warn(
      `[claude-account] native replay refused, replaying as text: ${String(error)}`,
    );
  }
  if (frames === undefined) {
    session.send(coldStartContent(rest));
    return "text";
  }
  const started = performance.now();
  await session.replay(frames);
  if (frames.length > 1) {
    console.info(
      `[claude-account] replayed ${frames.length} frames in ${Math.round(performance.now() - started)}ms`,
    );
  }
  return "native";
}

/**
 * A fingerprint of each part of the shape each session's last step ran
 * with, kept for as long as this process runs.
 */
const lastShapes = new Map<string, Record<string, string>>();

/**
 * Which parts of `shape` differ from the one the session's last step ran
 * with, named for the log ("system prompt and tools"), if any. Notes `shape`
 * as the session's latest.
 */
function shapeChangeOf(key: string, shape: SessionShape) {
  const parts: Record<string, string> = Object.fromEntries(
    Object.entries({
      "Claude Code": [shape.executablePath, shape.configDir],
      "built-in tools": shape.builtInTools,
      effort: shape.effort ?? null,
      "system prompt": shape.systemPrompt,
      tools: shape.tools.map((tool) => [
        tool.name,
        tool.description,
        tool.inputSchema,
      ]),
    }).map(([name, value]) => [
      name,
      createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    ]),
  );
  const last = lastShapes.get(key);
  lastShapes.set(key, parts);
  if (last === undefined) {
    return undefined;
  }
  const changed = Object.keys(parts).filter(
    (name) => parts[name] !== last[name],
  );
  return changed.length > 0 ? changed.join(" and ") : undefined;
}

/**
 * Close a session's processes for request shapes it has moved on from (its
 * tools or prompt changed), so each does not wait out its idle time.
 */
function closeOtherIdleSlots(key: string, keep: string | undefined) {
  for (const [slot, session] of sessions) {
    if (slot !== keep && slot.startsWith(`${key}:`) && !session.busy) {
      session.close();
    }
  }
}

/** What Claude Code says when the entry a resume cuts back to is not there. */
const RESUME_REFUSED = /No message found with message\.uuid/;

const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Claude Code's own tools a request asks to have run, as a search does with
 * `{ "claude-account": { builtInTools: ["WebSearch"] } }`.
 */
function builtInToolsOf(options: LanguageModelV4CallOptions) {
  const asked =
    options.providerOptions?.[CLAUDE_ACCOUNT_PROVIDER_ID]?.builtInTools;
  return Array.isArray(asked)
    ? asked.filter((tool): tool is string => typeof tool === "string")
    : [];
}

/**
 * Which of our sessions a request belongs to, and so which process and
 * transcript answer it: `{ "claude-account": { sessionId } }`, its own even
 * for a task, whose client session header names its chat's for the caches
 * other providers route by. The header stands in where no id is given.
 */
function sessionKeyOf(options: LanguageModelV4CallOptions) {
  const asked =
    options.providerOptions?.[CLAUDE_ACCOUNT_PROVIDER_ID]?.sessionId;
  return typeof asked === "string"
    ? asked
    : options.headers?.[CLIENT_SESSION_ID_HEADER];
}

/**
 * The session a task branched from, `{ "claude-account": { parentSessionId } }`,
 * whose transcript its first step can fork rather than replay.
 */
function parentKeyOf(options: LanguageModelV4CallOptions) {
  const asked =
    options.providerOptions?.[CLAUDE_ACCOUNT_PROVIDER_ID]?.parentSessionId;
  return typeof asked === "string" ? asked : undefined;
}

function effortOf(options: LanguageModelV4CallOptions) {
  const asked = options.providerOptions?.[CLAUDE_ACCOUNT_PROVIDER_ID]?.effort;
  return EFFORTS.find((effort) => effort === asked);
}

/** One whole step from `doStream`, for callers that do not stream. */
async function collect({
  stream,
}: {
  stream: ReadableStream<LanguageModelV4StreamPart>;
}) {
  const content: LanguageModelV4Content[] = [];
  const texts = new Map<string, { text: string; type: "reasoning" | "text" }>();
  let finishReason: LanguageModelV4FinishReason = {
    raw: undefined,
    unified: "other",
  };
  let usage = emptyUsage();
  for await (const part of stream) {
    switch (part.type) {
      case "text-start":
      case "reasoning-start": {
        const entry = {
          text: "",
          type:
            part.type === "text-start"
              ? ("text" as const)
              : ("reasoning" as const),
        };
        texts.set(part.id, entry);
        content.push(entry);
        break;
      }
      case "text-delta":
      case "reasoning-delta": {
        const entry = texts.get(part.id);
        if (entry) {
          entry.text += part.delta;
        }
        break;
      }
      case "tool-call": {
        content.push(part);
        break;
      }
      case "finish": {
        finishReason = part.finishReason;
        usage = part.usage;
        break;
      }
      case "error": {
        throw part.error;
      }
      default: {
        break;
      }
    }
  }
  return { content, finishReason, usage, warnings: [] };
}
