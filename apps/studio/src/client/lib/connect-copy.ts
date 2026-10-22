import {
  type ConnectOutcome,
  type ConnectProvider,
} from "@/shared/connect-outcome";
import { type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";

import { describeWhen } from "./billing";

/**
 * The words for how connecting a provider ended, one function per surface:
 * a page (setup, and the Add a provider sheet's answer), the line under a
 * button or a row, a toast, and the note above the reply box. Every surface
 * draws from these, so an answer reads the same wherever it shows.
 *
 * `canceled` has no words anywhere: the person did it. Network trouble has
 * none of its own either; the window's network pill says that, and here it
 * reads as `failed` or `timed-out`.
 */

/** Grok connection copy shared by setup, provider settings, and sign-in results. */
export const GROK_CONNECT_COPY = {
  caption: "Use your eligible Grok or X subscription here.",
  requirement: "Your plan needs to include Grok API access.",
};

/** What each way in is called. */
export const CONNECT_NAMES: Record<ConnectProvider, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  grok: "Grok",
  instrument: APP_NAME,
};

/**
 * The plans each subscription counts, as setup's subscription list and the
 * Add a provider sheet say them.
 */
export const CONNECT_PLANS: Record<
  Exclude<ConnectProvider, "instrument">,
  string
> = {
  chatgpt: "Plus, Pro or another paid plan",
  claude: "Pro, Max or another paid plan",
  grok: GROK_CONNECT_COPY.requirement,
};

interface Context {
  /** The model the sign-in made the default, when it made one. */
  modelName?: string;
  now?: Date;
}

export interface ConnectPageCopy {
  subtitle: string;
  title: string;
}

/** A page's title and the line under it. */
export function connectPageCopy(
  outcome: ConnectOutcome,
  provider: ConnectProvider,
  { modelName, now = new Date() }: Context = {},
): ConnectPageCopy | undefined {
  const name = CONNECT_NAMES[provider];
  switch (outcome.kind) {
    case "canceled": {
      return undefined;
    }
    case "declined": {
      return provider === "chatgpt"
        ? {
            subtitle: `Continue with ChatGPT again and allow ${APP_NAME} to use your plan.`,
            title: `${APP_NAME} can't use your ChatGPT plan yet`,
          }
        : {
            subtitle: "Try again, or pick another way in.",
            title: `You didn't finish signing in ${signInTo(provider)}`,
          };
    }
    case "failed": {
      return {
        subtitle: "Something went wrong. Try again, or pick another way in.",
        title: `Couldn't sign in ${signInTo(provider)}`,
      };
    }
    case "no-plan": {
      return {
        subtitle: `${noPlanReason(provider)} Upgrade and try again, or pick another way in.`,
        title: noPlanTitle(provider),
      };
    }
    case "out-of-usage": {
      return {
        subtitle: `${usageLimitReason(provider, outcome.resetsAt, now)} You can keep going and use it ${outcome.resetsAt ? "then" : "once it resets"}, or pick another way in now.`,
        title: `${name} is out of usage for now`,
      };
    }
    case "ready": {
      return {
        subtitle: readyLine(provider, modelName),
        title:
          provider === "instrument"
            ? `You're signed in to ${APP_NAME}`
            : `${name} is ready to use`,
      };
    }
    case "sign-up-refused": {
      return {
        subtitle: `You can still use ${APP_NAME} today with a plan you already pay for, or with your own API key.`,
        title: `${APP_NAME} isn't open to new accounts yet`,
      };
    }
    case "signed-out": {
      return {
        subtitle: `Sign in to ${name} again to use your plan here.`,
        title: `You're signed out of ${name}`,
      };
    }
    case "timed-out": {
      return {
        subtitle: `${APP_NAME} couldn't check your ${name} plan. Try again, or pick another way in.`,
        title: `${name} didn't answer in time`,
      };
    }
  }
}

/** One short sentence under a button or a row: a sign-in that didn't land. */
export function connectLine(
  outcome: ConnectOutcome,
  provider: ConnectProvider,
  { now = new Date() }: Context = {},
): string | undefined {
  const name = CONNECT_NAMES[provider];
  switch (outcome.kind) {
    case "canceled":
    case "ready": {
      return undefined;
    }
    case "declined": {
      return provider === "chatgpt"
        ? `Continue again and allow ${APP_NAME} to use your plan.`
        : "You didn't finish signing in.";
    }
    case "failed": {
      return "Something went wrong. Try again.";
    }
    case "no-plan": {
      return provider === "instrument"
        ? undefined
        : `${noPlanTitle(provider)}.`;
    }
    case "out-of-usage": {
      return outOfUsageLine(provider, outcome.resetsAt, now);
    }
    case "sign-up-refused": {
      return `${APP_NAME} isn't open to new accounts yet.`;
    }
    case "signed-out": {
      return "You're signed out. Sign in again.";
    }
    case "timed-out": {
      return `${name} didn't answer in time. Try again.`;
    }
  }
}

export interface ConnectToastCopy {
  description?: string;
  /** An answer that went wrong, said as an error toast. */
  isError: boolean;
  title: string;
}

/** A toast, for a surface that has no room of its own to say it, like Settings. */
export function connectToast(
  outcome: ConnectOutcome,
  provider: ConnectProvider,
  { modelName, now = new Date() }: Context = {},
): ConnectToastCopy | undefined {
  const name = CONNECT_NAMES[provider];
  switch (outcome.kind) {
    case "canceled": {
      return undefined;
    }
    case "declined": {
      // Saying no on the service's page was the person's own choice, except
      // that ChatGPT also answers this for plan access left unchecked.
      return provider === "chatgpt"
        ? {
            description: `Continue with ChatGPT again and allow ${APP_NAME} to use your plan.`,
            isError: true,
            title: `${APP_NAME} can't use your ChatGPT plan yet`,
          }
        : undefined;
    }
    case "failed": {
      return {
        isError: true,
        title: `Couldn't sign in ${signInTo(provider)}`,
      };
    }
    case "no-plan": {
      return {
        description: noPlanReason(provider),
        isError: true,
        title: noPlanTitle(provider),
      };
    }
    case "out-of-usage": {
      return {
        description: usageLimitReason(provider, outcome.resetsAt, now),
        isError: true,
        title: `${name} is out of usage for now`,
      };
    }
    case "ready": {
      return {
        description: readyLine(provider, modelName),
        isError: false,
        title:
          provider === "instrument"
            ? `Signed in to ${APP_NAME}`
            : `Connected your ${name} account`,
      };
    }
    case "sign-up-refused": {
      return {
        description: "You can still use your own ChatGPT, Claude or Grok plan.",
        isError: true,
        title: `${APP_NAME} isn't open to new accounts yet`,
      };
    }
    case "signed-out": {
      return {
        description: `Sign in to ${name} again to use your plan here.`,
        isError: true,
        title: `You're signed out of ${name}`,
      };
    }
    case "timed-out": {
      return {
        description: `${APP_NAME} couldn't check your ${name} plan. Try again.`,
        isError: true,
        title: `${name} didn't answer in time`,
      };
    }
  }
}

/**
 * The note above the reply box once a turn on the plan stopped: only the
 * answers a turn can stop on have one.
 */
export function connectNote(
  outcome: ConnectOutcome,
  provider: Exclude<ConnectProvider, "instrument">,
  { now = new Date() }: Context = {},
): string | undefined {
  const name = CONNECT_NAMES[provider];
  switch (outcome.kind) {
    case "no-plan": {
      return `${noPlanTitle(provider)}.`;
    }
    case "out-of-usage": {
      return outOfUsageLine(provider, outcome.resetsAt, now);
    }
    case "signed-out": {
      return `You're signed out of ${name}.`;
    }
    default: {
      return undefined;
    }
  }
}

/** "to ChatGPT", or "with Google" for Instrument, whose sign-in is Google's. */
function signInTo(provider: ConnectProvider) {
  return provider === "instrument"
    ? "with Google"
    : `to ${CONNECT_NAMES[provider]}`;
}

function noPlanTitle(provider: ConnectProvider) {
  return `Your ${CONNECT_NAMES[provider]} account doesn't have a paid plan`;
}

function noPlanReason(provider: ConnectProvider) {
  if (provider === "instrument") {
    return `This account doesn't have an ${APP_NAME} plan.`;
  }
  // Grok's plan can be paid through X, which counts only once the X
  // account is linked to the xAI account that signed in.
  return provider === "grok"
    ? `${GROK_CONNECT_COPY.requirement} If you pay through X, link your X account at accounts.x.ai.`
    : `${APP_NAME} only works with paid ${CONNECT_NAMES[provider]} plans.`;
}

/**
 * The page for an OpenRouter key whose account has nothing to spend.
 * OpenRouter still serves its free models with no credits, so the line says
 * most models rather than all of them.
 */
export function noCreditsPageCopy(): ConnectPageCopy {
  return {
    subtitle: `${APP_NAME} needs credits on the account to use most OpenRouter models. Add some and try again, or pick another way in.`,
    title: "Your OpenRouter account has no credits",
  };
}

function usageLimitReason(
  provider: ConnectProvider,
  resetsAt: string | undefined,
  now: Date,
) {
  const name = CONNECT_NAMES[provider];
  return resetsAt
    ? `Your ${name} plan hit its limit, and ${name} says it resets ${describeWhen(new Date(resetsAt), now).replace(/^at /, "around ")}.`
    : `Your ${name} plan hit its limit for now.`;
}

function outOfUsageLine(
  provider: ConnectProvider,
  resetsAt: string | undefined,
  now: Date,
) {
  const name = CONNECT_NAMES[provider];
  return resetsAt
    ? `${name} is out of usage until ${describeWhen(new Date(resetsAt), now).replace(/^at /, "")}.`
    : `${name} is out of usage for now.`;
}

function readyLine(provider: ConnectProvider, modelName: string | undefined) {
  if (provider === "instrument") {
    return `New chats can use ${APP_NAME}'s models.`;
  }
  return modelName
    ? `New chats use ${modelName} from your plan.`
    : "Its models are in the model picker.";
}

/**
 * How the Instrument way in reads beside the subscriptions, from the
 * server's trial offer: a free trial when one can start without paying
 * first (no card, or a card trial), otherwise signing in to choose a plan.
 * Setup's rows, the Add a provider sheet and the sign-in screen use it.
 */
export function instrumentWayCopy(
  offer: RPCOutput["billing"]["offer"] | undefined,
): { action: string; isTrial: boolean; line: string; title: string } {
  const trial = offer?.trial;
  if (trial && trial.available !== false && trial.mode !== "intro") {
    return {
      action: "Start free trial",
      isTrial: true,
      line: `Sign in with Google and get ${String(trial.days)} days free.${trial.cardRequired ? "" : " No card needed."}`,
      title: `Try ${APP_NAME} free`,
    };
  }
  return {
    action: "Log in",
    isTrial: false,
    line: "Sign in with Google and choose a plan.",
    title: APP_NAME,
  };
}
