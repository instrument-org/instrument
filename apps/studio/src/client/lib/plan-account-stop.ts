import {
  PLAN_NOT_ELIGIBLE_CODES,
  type SessionMessage,
} from "@instrument-org/workspace/client";
import { z } from "zod";

import { describeWhen } from "./billing";
import { CONNECT_NAMES, connectNote } from "./connect-copy";

/** A plan the person brings from ChatGPT, Claude or Grok, signed in to its account. */
export type PlanAccountProvider =
  | "chatgpt-account"
  | "claude-account"
  | "grok-account";

const CONNECT_PROVIDER = {
  "chatgpt-account": "chatgpt",
  "claude-account": "claude",
  "grok-account": "grok",
} as const satisfies Record<PlanAccountProvider, string>;

/**
 * Why a turn on the person's ChatGPT, Claude or Grok plan stopped, when it is
 * the plan rather than the request: its usage ran out (with when it comes
 * back, where the provider says), or the account cannot be used here: no paid
 * plan, a plan that lapsed, a workspace that does not allow other apps, or a
 * Grok account without an eligible paid plan.
 */
export type PlanAccountStop =
  | { kind: "not-eligible"; provider: PlanAccountProvider }
  | { kind: "usage-limit"; provider: PlanAccountProvider; resetsAt?: Date };

const bodySchema = z.object({
  error: z.object({
    code: z.string().nullish(),
    /** Claude's reset, in seconds since the epoch. */
    resets_at: z.number().nullish(),
    /** A reset given as seconds from the answer. */
    resets_in_seconds: z.number().nullish(),
    type: z.string().nullish(),
  }),
});

function readBody(responseBody: string | undefined) {
  if (!responseBody) {
    return undefined;
  }
  try {
    return bodySchema.safeParse(JSON.parse(responseBody)).data?.error;
  } catch {
    return undefined;
  }
}

function isPlanAccountProvider(
  provider: string | undefined,
): provider is PlanAccountProvider {
  return provider !== undefined && provider in CONNECT_PROVIDER;
}

/** Why this turn's plan stopped it, or undefined when the plan did not. */
export function planAccountStop(
  message: SessionMessage.Assistant,
): PlanAccountStop | undefined {
  const error = message.metadata.error;
  const provider = message.metadata.aiGatewayModel?.params.provider;
  if (!error || !isPlanAccountProvider(provider)) {
    return undefined;
  }
  const body =
    error.kind === "api-call" ? readBody(error.responseBody) : undefined;
  const code = body?.code ?? body?.type;
  if (code && PLAN_NOT_ELIGIBLE_CODES.has(code)) {
    return { kind: "not-eligible", provider };
  }
  const classification =
    "classification" in error ? error.classification : undefined;
  // xAI refuses a Grok account with no plan behind it as a 429 the
  // classifier reads as `auth`; a 401 or 403 is a session that ended.
  if (
    provider === "grok-account" &&
    classification === "auth" &&
    error.kind === "api-call" &&
    error.statusCode === 429
  ) {
    return { kind: "not-eligible", provider };
  }
  if (classification !== "usage-limit") {
    return undefined;
  }
  const resetsAt =
    typeof body?.resets_at === "number"
      ? new Date(body.resets_at * 1000)
      : typeof body?.resets_in_seconds === "number"
        ? new Date(
            new Date(message.metadata.createdAt).getTime() +
              body.resets_in_seconds * 1000,
          )
        : undefined;
  return {
    kind: "usage-limit",
    provider,
    ...(resetsAt && !Number.isNaN(resetsAt.getTime()) && { resetsAt }),
  };
}

/**
 * The stop the chat ended on, read off its last reply as the billing notice
 * reads its own: nothing while a turn runs or once something has been said
 * since.
 */
export function lastPlanAccountStop({
  isAgentRunning,
  messages,
}: {
  isAgentRunning: boolean;
  messages: SessionMessage.WithParts[];
}): undefined | { messageId: string; stop: PlanAccountStop } {
  if (isAgentRunning) {
    return undefined;
  }
  const last = messages.findLast(
    (message) => message.role === "assistant" || message.role === "user",
  );
  if (last?.role !== "assistant") {
    return undefined;
  }
  const stop = planAccountStop(last);
  return stop && { messageId: last.id, stop };
}

function planAccountName(provider: PlanAccountProvider) {
  return CONNECT_NAMES[CONNECT_PROVIDER[provider]];
}

/** "3:40 PM", "tomorrow at 9:12 AM", "Monday at 9:12 AM", "November 5". */
function describeReset(resetsAt: Date, now: Date) {
  return describeWhen(resetsAt, now).replace(/^at /, "");
}

/** Has the usage the stop was about come back by now. */
export function hasUsageReturned(stop: PlanAccountStop, now: Date) {
  return (
    stop.kind === "usage-limit" &&
    stop.resetsAt !== undefined &&
    stop.resetsAt.getTime() <= now.getTime()
  );
}

/** The words of the note over the reply box. */
export function planAccountNoteText(stop: PlanAccountStop, now: Date) {
  if (hasUsageReturned(stop, now)) {
    return `Your ${planAccountName(stop.provider)} usage limit has reset.`;
  }
  return (
    connectNote(
      stop.kind === "not-eligible"
        ? { kind: "no-plan" }
        : {
            kind: "out-of-usage",
            ...(stop.resetsAt && { resetsAt: stop.resetsAt.toISOString() }),
          },
      CONNECT_PROVIDER[stop.provider],
      { now },
    ) ?? ""
  );
}

/**
 * The line the stopped turn ends on in the transcript, said as of when it
 * stopped, so it stays true once the usage is back.
 */
export function planAccountStopLine(stop: PlanAccountStop, stoppedAt: Date) {
  const name = planAccountName(stop.provider);
  if (stop.kind === "not-eligible") {
    return stop.provider === "grok-account"
      ? "I couldn't start on this. Grok says this account doesn't have an eligible paid plan."
      : `I couldn't start on this. ${name} says this account can't be used in other apps without a paid plan.`;
  }
  return stop.resetsAt
    ? `I had to stop here. Your ${name} plan is out of usage until ${describeReset(stop.resetsAt, stoppedAt)}.`
    : `I had to stop here. Your ${name} plan is out of usage for now.`;
}
