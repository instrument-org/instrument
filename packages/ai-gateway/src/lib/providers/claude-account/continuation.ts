import {
  type LanguageModelV4Message,
  type LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";
import { createHash } from "node:crypto";

import { type RecordRead } from "./resume-record";

export type Continuation =
  | {
      kind: "tool-results";
      results: LanguageModelV4ToolResultPart[];
      /**
       * Messages that came in after the results, as a task finishing does
       * when the step before handed work off, and the notes that come with
       * them: read in the same turn, once the results are in.
       */
      followedBy: LanguageModelV4Message[];
    }
  | { kind: "turn"; messages: LanguageModelV4Message[] };

/** Why a request cannot continue the running process, for the log. */
export type Restart = { kind: "restart"; reason: string };

/**
 * A message the workspace says for one request and keeps nowhere, such as a
 * notice of how much context is left. It is sent with the turn it rides on,
 * and never counts toward what a process has seen, since the next request
 * leaves it out or says it differently.
 */
function isTransient(message: LanguageModelV4Message) {
  return message.providerOptions?.instrument?.transient === true;
}

/**
 * A request's messages split into the ones a process keeps, with their
 * fingerprints, and the transient ones that ride along with a turn.
 */
export function splitPrompt(prompt: LanguageModelV4Message[]) {
  const kept = prompt.filter((message) => !isTransient(message));
  return {
    kept,
    keptPrints: kept.map(fingerprintOf),
    transient: prompt.filter(isTransient),
  };
}

/**
 * What one message is, for telling whether a process has already seen it.
 * Provider options are left out at every depth: our loop moves its cache
 * breakpoints onto the newest messages each step, on the message or on its
 * last part, and a message that lost one is still the message the process saw.
 */
function fingerprintOf(message: LanguageModelV4Message) {
  return createHash("sha256")
    .update(
      JSON.stringify(message, (key, value: unknown) =>
        key === "providerOptions" ? undefined : value,
      ),
    )
    .digest("hex");
}

/**
 * The fingerprints of the transient messages among `messages`, which a
 * process notes as the notes it has been given.
 */
export function transientPrintsOf(messages: LanguageModelV4Message[]) {
  return messages.filter(isTransient).map(fingerprintOf);
}

/** A request's messages, as `splitPrompt` gives them. */
type Prompt = ReturnType<typeof splitPrompt>;

function restart(reason: string): Restart {
  return { kind: "restart", reason };
}

/** Whether a message is the user's or the system's, rather than a reply or results. */
function isSaid(message: LanguageModelV4Message) {
  return message.role === "user" || message.role === "system";
}

/**
 * What a request adds past `seen`, the messages a process, a record or a
 * parent saw (`who`), when they open the request unchanged; else why not.
 */
function pastSeen(
  seen: string[],
  { kept, keptPrints }: Prompt,
  who: string,
): LanguageModelV4Message[] | Restart {
  if (seen.length === 0) {
    return restart(`${who} saw no messages`);
  }
  if (kept.length < seen.length) {
    return restart(
      `the request has ${kept.length} messages, ${who} saw ${seen.length}`,
    );
  }
  const changed = seen.findIndex((print, index) => keptPrints[index] !== print);
  if (changed !== -1) {
    return restart(
      `message ${changed} of ${seen.length} (${kept[changed]?.role ?? "missing"}) changed since ${who} saw it`,
    );
  }
  return kept.slice(seen.length);
}

/**
 * What a request adds past the reply `who` gave to what it saw, when what it
 * saw opens the request unchanged and the reply follows; else why not.
 */
function pastReply(
  seen: string[],
  prompt: Prompt,
  who: string,
): LanguageModelV4Message[] | Restart {
  const added = pastSeen(seen, prompt, who);
  if (!Array.isArray(added)) {
    return added;
  }
  const [reply, ...after] = added;
  return reply?.role === "assistant"
    ? after
    : restart(
        `message ${seen.length} is ${reply?.role ?? "missing"}, not the reply`,
      );
}

/** The roles of `messages` in order, for a reason in the log. */
function rolesOf(messages: LanguageModelV4Message[]) {
  return messages.map((message) => message.role).join(", ") || "none";
}

/**
 * How a request follows from what a Claude Code session saw, or why it does
 * not and the session has to start over from our transcript. It follows
 * when every message the session saw opens the request unchanged, then the
 * reply it gave, then either the results of the tools that reply called
 * (and anything said since) or a new turn, which may be transient messages
 * alone.
 *
 * Transient notes go with tool results too, as they do for every other
 * provider, which reads them after the results: what a context budget or
 * rollover asks of the model applies mid-turn. Claude Code keeps every note
 * it is given, where another provider is sent only the latest, so one this
 * process was already given since its turn began (`notesGiven`, by
 * fingerprint) is not sent again: a rollover notice, repeated on every
 * request with the handoff notes in it, would otherwise pile up a copy per
 * step.
 */
export function continuationOf(
  session: {
    awaitingToolCallIds: string[];
    notesGiven?: ReadonlySet<string>;
    seen: string[];
  },
  prompt: Prompt,
): Continuation | Restart {
  const after = pastReply(session.seen, prompt, "the process");
  if (!Array.isArray(after)) {
    return after;
  }
  const { awaitingToolCallIds } = session;
  if (awaitingToolCallIds.length > 0) {
    const [results, ...followedBy] = after;
    if (results?.role !== "tool" || !followedBy.every(isSaid)) {
      return restart(
        `awaiting ${awaitingToolCallIds.length} tool results, the reply is followed by ${rolesOf(after)}`,
      );
    }
    const parts = results.content.filter(
      (part): part is LanguageModelV4ToolResultPart =>
        part.type === "tool-result",
    );
    const answered = new Set(parts.map((part) => part.toolCallId));
    const missing = awaitingToolCallIds.filter((id) => !answered.has(id));
    if (missing.length > 0) {
      return restart(
        `results answer ${parts.length} calls and leave ${missing.length} of ${awaitingToolCallIds.length} unanswered`,
      );
    }
    const notes = prompt.transient.filter(
      (message) => session.notesGiven?.has(fingerprintOf(message)) !== true,
    );
    return {
      followedBy: [...followedBy, ...notes],
      kind: "tool-results",
      results: parts,
    };
  }
  // A turn of transient messages alone is a note on the reply, as asking for
  // a correction or for the rest of a reply cut off is. Kept nowhere, it
  // leaves what the process saw ending on the reply it answers, so the next
  // request's reply is the one this turn gives.
  const added = [...after, ...prompt.transient];
  return added.length > 0 && after.every(isSaid)
    ? { kind: "turn", messages: added }
    : restart(
        `no tool results awaited, the reply is followed by ${rolesOf(after)}`,
      );
}

/**
 * The new messages a branch of a session starts with, when it carries on
 * from exactly the input of the session's last step, as a task's first
 * request carries on from the chat step that started it: everything the
 * session saw, unchanged, then only user or system messages.
 */
export function branchOf(
  parent: { seen: string[] },
  prompt: Prompt,
): LanguageModelV4Message[] | Restart {
  const added = pastSeen(parent.seen, prompt, "the parent");
  if (!Array.isArray(added)) {
    return added;
  }
  return added.length > 0 && added.every(isSaid)
    ? [...added, ...prompt.transient]
    : restart(`what the parent saw is followed by ${rolesOf(added)}`);
}

/**
 * What a request adds past the last step a resume record names, to be
 * replayed onto its transcript once that is cut back to the step's last
 * entry: everything after the step's reply, whatever it is, as long as it
 * ends on the user's side. That covers a step stopped or failed since
 * (our record of it, partial reply and stopped calls included), tool
 * results the record's process died waiting on, and turns another computer
 * or provider took.
 */
export function tailAfter(
  record: { awaitingToolCallIds: string[]; seen: string[] },
  prompt: Prompt,
): { kind: "tail"; messages: LanguageModelV4Message[] } | Restart {
  const after = pastReply(record.seen, prompt, "its record");
  if (!Array.isArray(after)) {
    return after;
  }
  const tail = [...after, ...prompt.transient];
  const [first] = tail;
  if (first === undefined) {
    return restart("nothing follows the reply its record ends on");
  }
  if (first.role === "assistant") {
    return restart(
      "the reply its record ends on is followed by another assistant message",
    );
  }
  if (
    first.role === "tool" &&
    !first.content.every(
      (part) =>
        part.type !== "tool-result" ||
        record.awaitingToolCallIds.includes(part.toolCallId),
    )
  ) {
    return restart(
      "the reply its record ends on is followed by results of calls it did not make",
    );
  }
  return tail.at(-1)?.role === "assistant"
    ? restart("the request ends on an assistant message")
    : { kind: "tail", messages: tail };
}

/**
 * Where a step starts: on the live process, which carries on from what it
 * saw; on the transcript its last process left, cut back to the last entry
 * of the step its record names, with what the request adds past that step
 * replayed onto it; on its parent's transcript, forked where it branched
 * off; or cold, on a new process given our history, with the reason a
 * process that had seen part of it could not continue.
 */
export type StepStart<Live> =
  | { continuation: Continuation; kind: "live"; session: Live }
  | {
      /** The transcript entry the step the record names ended on. */
      at: string;
      /** The tool calls that step ended on, which `messages` may answer. */
      awaitingToolCallIds: string[];
      claudeSessionId: string;
      kind: "resume";
      messages: LanguageModelV4Message[];
      /** Why the live process, when there was one, could not continue. */
      restart?: string;
    }
  | {
      at: string;
      from: string;
      kind: "fork";
      messages: LanguageModelV4Message[];
    }
  | { kind: "cold"; why: ColdStart };

/**
 * Why a step starts cold, for the log: `tag` sorts a day's cold starts by
 * cause, and `detail` says what did not line up.
 * - `restart`: the live process saw something this request does not carry on,
 *   and its transcript cannot take what the request adds either.
 * - `transcript`: no live process, and the transcript its record names does not
 *   line up with the request.
 * - `fork`: a task with nothing of its own, whose parent's transcript it could
 *   not branch from.
 * - `no-record`: nothing to carry on: no live process and no usable record.
 * - `shape`: the session's system prompt, tools, effort or built-in tools
 *   changed, and a step of another shape needs a process of its own.
 * - `busy`: the session's process is mid-step, so this one gets a process of
 *   its own that keeps nothing.
 */
interface ColdStart {
  detail: string;
  tag: "busy" | "fork" | "no-record" | "restart" | "shape" | "transcript";
}

/**
 * Why a step that starts cold does, as the log says it, or nothing when the
 * replay loses nothing: a one-off (a title, a summary) is cold by design, and
 * a session's first step has nothing to carry on.
 */
export function coldStartReason({
  busy,
  changedShape,
  kept,
  oneOff,
  why,
}: {
  /** Whether the session's own process is mid-step on another request. */
  busy: boolean;
  /** What of the session's shape changed since its last step, if anything. */
  changedShape: string | undefined;
  kept: LanguageModelV4Message[];
  oneOff: boolean;
  why: ColdStart;
}): ColdStart | undefined {
  if (oneOff || !kept.some((message) => message.role === "assistant")) {
    return undefined;
  }
  if (busy) {
    return {
      detail: "its process is mid-step on another request",
      tag: "busy",
    };
  }
  if (why.tag === "no-record" && changedShape !== undefined) {
    return {
      detail: `the session's ${changedShape} changed since its last step, which needs a process of its own`,
      tag: "shape",
    };
  }
  return why;
}

/**
 * Where a request's step starts, trying in order the live process, the
 * session's resume record, then its parent's. A record is read only when
 * what comes before it has nothing to offer. The parent's reader answers
 * nothing for a session with no parent.
 */
export async function planStep<
  Live extends { awaitingToolCallIds: string[]; seen: string[] },
>(
  from: {
    live: Live | undefined;
    parentRecord: () => Promise<RecordRead | undefined>;
    record: () => Promise<RecordRead>;
  },
  prompt: ReturnType<typeof splitPrompt>,
): Promise<StepStart<Live>> {
  const cold = (tag: ColdStart["tag"], detail: string): StepStart<Live> => ({
    kind: "cold",
    why: { detail, tag },
  });
  let liveRestart: string | undefined;
  if (from.live) {
    const continuation = continuationOf(from.live, prompt);
    if (continuation.kind !== "restart") {
      return { continuation, kind: "live", session: from.live };
    }
    // The live process's transcript, cut back to its last step, may still
    // take what the request adds since.
    liveRestart = continuation.reason;
  }
  const read = await from.record();
  if ("record" in read) {
    const { record } = read;
    const tail = tailAfter(record, prompt);
    if (tail.kind === "restart") {
      return liveRestart === undefined
        ? cold("transcript", tail.reason)
        : cold("restart", `${liveRestart}; its transcript: ${tail.reason}`);
    }
    return {
      at: record.leaf,
      awaitingToolCallIds: record.awaitingToolCallIds,
      claudeSessionId: record.claudeSessionId,
      kind: "resume",
      messages: tail.messages,
      ...(liveRestart !== undefined && { restart: liveRestart }),
    };
  }
  if (liveRestart !== undefined) {
    return cold(
      "restart",
      `${liveRestart}; its transcript has ${read.missing}`,
    );
  }
  const parentRead = await from.parentRecord();
  if (parentRead === undefined) {
    return cold("no-record", `no live process and ${read.missing}`);
  }
  if (!("record" in parentRead)) {
    return cold("fork", `the parent has ${parentRead.missing}`);
  }
  const parent = parentRead.record;
  if (parent.forkPoint === undefined) {
    return cold("fork", "the parent's record has no fork point");
  }
  const branch = branchOf(parent, prompt);
  if (!Array.isArray(branch)) {
    return cold("fork", `${branch.reason} (${read.missing} of its own)`);
  }
  return {
    at: parent.forkPoint,
    from: parent.claudeSessionId,
    kind: "fork",
    messages: branch,
  };
}
