/**
 * The setup assistant's pages, the way in the person chose, and what they
 * answered along the way. Pure, so the order of pages can be checked without
 * drawing them.
 */

import {
  type AIProviderConfigId,
  type AIProviderType,
} from "@instrument-org/shared";

/** Every page the assistant can show. */
export type SetupStep =
  // Ways in.
  | "welcome"
  | "plans"
  | "trial-started"
  | "free-account"
  | "no-paid-plan"
  | "out-of-usage"
  | "claude-sign-in"
  | "claude-device"
  | "providers"
  | "paste-key"
  | "model"
  // Returning beta testers.
  | "welcome-back"
  | "beta-offer"
  // The setup every way in shares.
  | "memories"
  | "folder"
  | "notifications"
  | "week"
  | "look"
  | "tasks"
  | "all-set";

/** How the person gets AI: the account they connected or the key they gave. */
export type SetupWay = "chatgpt" | "claude" | "google" | "key";

export type MemorySource = "chatgpt" | "claude" | "gemini";

/** A task the assistant offers to save as a draft. */
export type SetupTask = { detail: string; icon: string; prompt: string };

export type SetupAnswers = {
  /** Apps to save an import-memories prompt for. */
  memories: Record<MemorySource, boolean>;
  /** The kinds of work picked on "What fills your week?". */
  work: string[];
  /** What they typed into Something else. */
  workOther: string;
  /** Whether setup may spend their own key writing task suggestions. */
  useAIDuringSetup: boolean;
  /** The tasks offered on the tasks page, and which of them are checked. */
  tasks: { checked: boolean; task: SetupTask }[];
  /** The provider config the own-key path saved, once its key is accepted. */
  providerId: AIProviderConfigId | null;
  /** The provider picked on the own-key path, before its key is pasted. */
  keyProvider: AIProviderType | null;
  /** Their first name, known only from a Google sign-in. */
  firstName: string | null;
  /** Whether the way in is out of usage, so setup skips what needs AI. */
  isOutOfUsage: boolean;
  /**
   * Why the ChatGPT or Claude account they just connected can't carry them,
   * for the no-paid-plan and out-of-usage pages. `resetsAt` is an ISO date,
   * when the account said when its usage comes back.
   */
  connectTrouble: {
    provider: "chatgpt" | "claude";
    reason: "could-not-connect" | "no-paid-plan" | "out-of-usage";
    resetsAt?: string;
  } | null;
};

export type SetupState = {
  answers: SetupAnswers;
  /** Pages behind this one, for Back. */
  history: SetupStep[];
  step: SetupStep;
  way: SetupWay | null;
};

export const INITIAL_ANSWERS: SetupAnswers = {
  connectTrouble: null,
  firstName: null,
  isOutOfUsage: false,
  keyProvider: null,
  memories: { chatgpt: true, claude: false, gemini: false },
  providerId: null,
  tasks: [],
  useAIDuringSetup: true,
  work: [],
  workOther: "",
};

export function initialSetupState({
  returning,
}: {
  returning: boolean;
}): SetupState {
  return {
    answers: INITIAL_ANSWERS,
    history: [],
    step: returning ? "welcome-back" : "welcome",
    way: null,
  };
}

/** The first page of the setup every way in shares. */
export const SHARED_SETUP_START: SetupStep = "memories";

/**
 * Which of the eight progress dots a page lights, or none for a page outside
 * the count. The first two dots are the way in (the plan and its start, or
 * the connection and the free account), the rest the shared setup.
 */
export function progressDot(step: SetupStep): number | null {
  switch (step) {
    case "plans":
    case "model":
    case "beta-offer":
      return 0;
    case "trial-started":
    case "free-account":
    case "out-of-usage":
      return 1;
    case "memories":
      return 2;
    case "folder":
      return 3;
    case "notifications":
      return 4;
    case "week":
      return 5;
    case "look":
      return 6;
    case "tasks":
      return 7;
    default:
      return null;
  }
}

export const PROGRESS_DOTS = 8;

export type SetupAction =
  | { answers: Partial<SetupAnswers>; type: "answer" }
  | { step: SetupStep; type: "go" }
  | { step: SetupStep; type: "replace" }
  | { type: "back" }
  | { type: "way"; way: SetupWay | null };

export function setupReducer(
  state: SetupState,
  action: SetupAction,
): SetupState {
  switch (action.type) {
    case "answer":
      return { ...state, answers: { ...state.answers, ...action.answers } };
    case "go":
      return {
        ...state,
        history: [...state.history, state.step],
        step: action.step,
      };
    case "replace":
      return { ...state, step: action.step };
    case "back": {
      const previous = state.history.at(-1);
      return previous
        ? { ...state, history: state.history.slice(0, -1), step: previous }
        : state;
    }
    case "way":
      return { ...state, way: action.way };
  }
}
