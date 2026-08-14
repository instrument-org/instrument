import { type SessionMessage } from "@instrument-org/workspace/client";

type MessageError = NonNullable<SessionMessage.Assistant["metadata"]["error"]>;

interface MessageErrorDescription {
  /** A sentence naming what the user can do about it. */
  detail: string;
  /** A few words for the collapsed row. */
  summary: string;
}

/**
 * Say what went wrong in our own words.
 *
 * A provider's error text is written for whoever integrated against it, not for
 * whoever is using the product: it names the upstream model, it cites the
 * vendor's dashboard, and it offers remedies that belong to an account the user
 * does not have. None of it reaches the transcript. What reaches the transcript
 * is one of these, chosen by what the rejection was rather than by which SDK
 * class carried it, because the same condition arrives as either depending on
 * whether the provider had already sent its response headers.
 *
 * The original text is not thrown away -- `MessageError` still shows it under
 * developer mode, which is where a message written for an integrator belongs.
 */
export function describeMessageError(
  error: MessageError,
): MessageErrorDescription {
  const classification =
    "classification" in error ? error.classification : undefined;

  switch (classification) {
    case "auth": {
      return {
        detail:
          "The provider would not accept the request. Check the model's provider settings, or switch to another model.",
        summary: "Provider rejected the request",
      };
    }
    case "context-overflow": {
      return {
        detail:
          "This conversation is longer than the model will accept. Starting a new task carries none of it over.",
        summary: "Conversation too long",
      };
    }
    case "rate-limit": {
      return {
        detail:
          "The model is busy right now. Trying again in a moment usually clears it.",
        summary: "Model is busy",
      };
    }
    case "transient": {
      return {
        detail: "The model provider had a temporary problem. Try again.",
        summary: "Provider problem",
      };
    }
    case "unsendable-content": {
      return {
        detail:
          "The model would not accept something in this conversation, such as an attached file. Starting a new task leaves it behind.",
        summary: "Content the model refused",
      };
    }
    default: {
      break;
    }
  }

  // No classification, either because nothing named the rejection or because
  // the error never came from a provider at all.
  switch (error.kind) {
    // Only ever rendered under developer mode, which is the one place a turn
    // the user stopped themselves is worth reporting as an error.
    case "aborted": {
      return { detail: "This turn was stopped.", summary: "Stopped" };
    }
    case "api-key": {
      return {
        detail:
          "No usable API key was found for this model. Check the model's provider settings.",
        summary: "No API key",
      };
    }
    case "invalid-tool-input":
    case "no-such-tool": {
      return {
        detail: "The model asked for a tool that does not exist. Try again.",
        summary: "Invalid model request",
      };
    }
    default: {
      return {
        detail: "Try again, or start a new task.",
        summary: "Something went wrong",
      };
    }
  }
}
