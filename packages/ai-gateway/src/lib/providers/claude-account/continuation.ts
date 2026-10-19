import {
  type LanguageModelV4Message,
  type LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";
import { createHash } from "node:crypto";

import { type ResumeRecord } from "./resume-record";

export type Continuation =
  | {
      kind: "tool-results";
      results: LanguageModelV4ToolResultPart[];
      /**
       * Messages that came in after the results, as a task finishing does
       * when the step before handed work off: read in the same turn, once
       * the results are in.
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
 * How a request follows from what a Claude Code session saw, or why it does
 * not and the session has to start over from our transcript. It follows
 * when every message the session saw opens the request unchanged, then the
 * reply it gave, then either the results of the tools that reply called
 * (and anything said since) or a new turn.
 */
export function continuationOf(
  session: { awaitingToolCallIds: string[]; seen: string[] },
  kept: LanguageModelV4Message[],
  keptPrints: string[],
  transient: LanguageModelV4Message[],
): Continuation | Restart {
  const restart = (reason: string): Restart => ({ kind: "restart", reason });
  const { seen } = session;
  if (seen.length === 0) {
    return restart("the process saw no messages");
  }
  if (kept.length <= seen.length) {
    return restart(
      `the request has ${kept.length} messages, the process saw ${seen.length}`,
    );
  }
  const changed = seen.findIndex((print, index) => keptPrints[index] !== print);
  if (changed !== -1) {
    return restart(
      `message ${changed} of ${seen.length} (${kept[changed]?.role ?? "missing"}) changed since the process saw it`,
    );
  }
  const [reply, ...unseen] = kept.slice(seen.length);
  if (reply?.role !== "assistant") {
    return restart(
      `message ${seen.length} is ${reply?.role ?? "missing"}, not the reply`,
    );
  }
  const roles = unseen.map((message) => message.role).join(", ") || "none";
  if (session.awaitingToolCallIds.length > 0) {
    const [results, ...followedBy] = unseen;
    if (
      results?.role !== "tool" ||
      !followedBy.every(
        (message) => message.role === "user" || message.role === "system",
      )
    ) {
      return restart(
        `awaiting ${session.awaitingToolCallIds.length} tool results, the reply is followed by ${roles}`,
      );
    }
    const parts = results.content.filter(
      (part): part is LanguageModelV4ToolResultPart =>
        part.type === "tool-result",
    );
    const answered = new Set(parts.map((part) => part.toolCallId));
    const missing = session.awaitingToolCallIds.filter(
      (id) => !answered.has(id),
    );
    return missing.length === 0
      ? {
          kind: "tool-results",
          results: parts,
          followedBy:
            followedBy.length > 0 ? [...followedBy, ...transient] : [],
        }
      : restart(
          `results answer ${parts.length} calls and leave ${missing.length} of ${session.awaitingToolCallIds.length} unanswered`,
        );
  }
  return unseen.length > 0 &&
    unseen.every(
      (message) => message.role === "user" || message.role === "system",
    )
    ? { kind: "turn", messages: [...unseen, ...transient] }
    : restart(`no tool results awaited, the reply is followed by ${roles}`);
}

/**
 * The new messages a branch of a session starts with, when it carries on
 * from exactly the input of the session's last step, as a task's first
 * request carries on from the chat step that started it: everything the
 * session saw, unchanged, then only user or system messages.
 */
export function branchOf(
  parent: { seen: string[] },
  kept: LanguageModelV4Message[],
  keptPrints: string[],
  transient: LanguageModelV4Message[],
): LanguageModelV4Message[] | undefined {
  const { seen } = parent;
  if (seen.length === 0 || kept.length <= seen.length) {
    return undefined;
  }
  if (seen.some((print, index) => keptPrints[index] !== print)) {
    return undefined;
  }
  const added = kept.slice(seen.length);
  return added.every(
    (message) => message.role === "user" || message.role === "system",
  )
    ? [...added, ...transient]
    : undefined;
}

/**
 * Where a step starts: on the live process, which carries on from what it
 * saw; on the transcript its last process left, resumed where it stopped; on
 * its parent's transcript, forked where it branched off; or cold, on a new
 * process given our history, with the reason a process that had seen part
 * of it could not continue.
 */
export type StepStart<Live> =
  | { continuation: Continuation; kind: "live"; session: Live }
  | {
      claudeSessionId: string;
      kind: "resume";
      messages: LanguageModelV4Message[];
    }
  | {
      at: string;
      from: string;
      kind: "fork";
      messages: LanguageModelV4Message[];
    }
  | { kind: "cold"; restart?: string };

/**
 * Where a request's step starts, trying in order the live process, the
 * session's resume record, then its parent's. A record is read only when
 * what comes before it has nothing to offer.
 */
export async function planStep<
  Live extends { awaitingToolCallIds: string[]; seen: string[] },
>(
  from: {
    live: Live | undefined;
    parentRecord: () => Promise<ResumeRecord | undefined>;
    record: () => Promise<ResumeRecord | undefined>;
  },
  prompt: ReturnType<typeof splitPrompt>,
): Promise<StepStart<Live>> {
  const { kept, keptPrints, transient } = prompt;
  if (from.live) {
    const continuation = continuationOf(from.live, kept, keptPrints, transient);
    return continuation.kind === "restart"
      ? { kind: "cold", restart: continuation.reason }
      : { continuation, kind: "live", session: from.live };
  }
  const record = await from.record();
  if (record) {
    const continuation = continuationOf(record, kept, keptPrints, transient);
    if (continuation.kind === "restart") {
      return { kind: "cold", restart: continuation.reason };
    }
    // The calls it waited on died with its process, and a resumed one has no
    // way to take their results.
    if (continuation.kind === "tool-results") {
      return {
        kind: "cold",
        restart: "its process ended while waiting on tool results",
      };
    }
    return {
      claudeSessionId: record.claudeSessionId,
      kind: "resume",
      messages: continuation.messages,
    };
  }
  const parent = await from.parentRecord();
  const branch = parent && branchOf(parent, kept, keptPrints, transient);
  if (parent?.forkPoint !== undefined && branch !== undefined) {
    return {
      at: parent.forkPoint,
      from: parent.claudeSessionId,
      kind: "fork",
      messages: branch,
    };
  }
  return { kind: "cold" };
}
