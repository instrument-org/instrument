import { type SessionMessage } from "@instrument-org/workspace/client";
import { z } from "zod";

import { describeWhen } from "./billing";

/** A plan the person brings from ChatGPT or Claude, signed in to its account. */
export type PlanAccountProvider = "chatgpt-account" | "claude-account";

/**
 * Why a turn on the person's ChatGPT or Claude plan stopped, when it is the
 * plan rather than the request: its usage ran out (with when it comes back,
 * where the provider says), or the account has no paid plan anymore.
 */
export type PlanAccountStop =
  | { kind: "plan-ended"; provider: PlanAccountProvider }
  | { kind: "usage-limit"; provider: PlanAccountProvider; resetsAt?: Date };

/**
 * The provider codes that mean the account has no paid plan. ChatGPT answers
 * this one for an account its plan does not let use the app.
 */
const PLAN_ENDED_CODES = new Set(["subscription_sharing_user_not_eligible"]);

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
  return provider === "chatgpt-account" || provider === "claude-account";
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
  if (code && PLAN_ENDED_CODES.has(code)) {
    return { kind: "plan-ended", provider };
  }
  if (!("classification" in error) || error.classification !== "usage-limit") {
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

export function planAccountName(provider: PlanAccountProvider) {
  return provider === "chatgpt-account" ? "ChatGPT" : "Claude";
}

/** The other plan the person could keep going with. */
export function otherPlanAccount(
  provider: PlanAccountProvider,
): PlanAccountProvider {
  return provider === "chatgpt-account" ? "claude-account" : "chatgpt-account";
}

/** "3:40 PM", "tomorrow at 9:12 AM", "Monday at 9:12 AM", "November 5". */
export function describeReset(resetsAt: Date, now: Date) {
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
  const name = planAccountName(stop.provider);
  if (stop.kind === "plan-ended") {
    return `Your ${name} plan has ended.`;
  }
  if (hasUsageReturned(stop, now)) {
    return `Your ${name} plan has usage again.`;
  }
  return stop.resetsAt
    ? `${name} is out of usage until ${describeReset(stop.resetsAt, now)}.`
    : `${name} is out of usage for now.`;
}

/**
 * The line the stopped turn ends on in the transcript, said as of when it
 * stopped, so it stays true once the usage is back.
 */
export function planAccountStopLine(stop: PlanAccountStop, stoppedAt: Date) {
  const name = planAccountName(stop.provider);
  if (stop.kind === "plan-ended") {
    return `I couldn't start on this. ${name} says this account no longer has a paid plan.`;
  }
  return stop.resetsAt
    ? `I had to stop here. Your ${name} plan is out of usage until ${describeReset(stop.resetsAt, stoppedAt)}.`
    : `I had to stop here. Your ${name} plan is out of usage for now.`;
}
