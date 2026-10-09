import {
  type AIGatewayModel,
  type AIGatewayModelURI,
  findReplacement,
  modelNameFromURI,
  readModelURI,
} from "@instrument-org/ai-gateway/client";
import { type AIProviderType, OUR_MODELS } from "@instrument-org/shared";

/**
 * Where the chosen model stands, read once and shared by everything that talks
 * about it: the composer's notice row, the picker's trigger and its banner,
 * and the check before a send. One reading, so those places cannot disagree
 * about what is wrong or say it four different ways.
 *
 * Pure, and a function of the list rather than a machine: nothing here waits,
 * times out or is canceled, so the state is whatever the inputs say it is.
 */
export type ModelStatus =
  /** The list has not arrived; nothing is worth saying yet. */
  | { kind: "loading" }
  /** Nothing to say. */
  | { kind: "ready"; model: AIGatewayModel.Type }
  /** A newer release of the chosen model is listed and the offer has not been dismissed. */
  | {
      kind: "newer";
      model: AIGatewayModel.Type;
      newer: AIGatewayModel.Type;
      offerKey: string;
    }
  /** Listed, but this user may not run it (a plan or a policy). */
  | {
      fix?: AIGatewayModel.Type;
      kind: "restricted";
      message: string;
      model: AIGatewayModel.Type;
    }
  /** Chosen once, and no connected provider lists it any more. */
  | {
      fix?: AIGatewayModel.Type;
      /** The fix is this model through another connection, so the offer names the connection. */
      fixIsSameModel?: boolean;
      kind: "gone";
      name: string;
      /** The provider it was chosen through, when that can still be named. */
      provider?: string;
      /**
       * Why it is gone, as far as the list can tell: the connection it came
       * through lists nothing at all any more (removed, or signed out of), or
       * still lists models and this one is not among them.
       */
      reason: "disconnected" | "dropped";
    }
  /** Chosen through a provider whose list failed to load, so whether it is still offered is unknown. */
  | { kind: "provider-failed"; message: string; name: string; provider: string }
  /** The models list itself failed. */
  | { kind: "list-failed" }
  /** Models are listed but none is chosen. */
  | { kind: "none-chosen" }
  /** No provider offers anything. */
  | { kind: "no-models" };

export interface ModelListError {
  config: { displayName?: string; id: string };
  message: string;
}

/** The key a dismissed offer is remembered by: this model, offered that one. A newer release later is a new offer. */
export const offerKeyOf = (
  model: AIGatewayModel.Type,
  newer: AIGatewayModel.Type,
) => `${model.uri}>${newer.canonicalId}`;

export function readModelStatus({
  dismissedOffers,
  errors = [],
  isError = false,
  isLoading = false,
  models = [],
  modelURI,
  providerNames,
}: {
  dismissedOffers: ReadonlySet<string>;
  errors?: ModelListError[];
  isError?: boolean;
  isLoading?: boolean;
  models?: AIGatewayModel.Type[];
  modelURI?: AIGatewayModelURI.Type;
  /** What each kind of provider is called, for naming a connection that is no longer there. */
  providerNames?: ReadonlyMap<AIProviderType, string>;
}): ModelStatus {
  if (isLoading) {
    return { kind: "loading" };
  }

  const auto = models.find((model) => model.providerId === OUR_MODELS.text.id);
  const model = modelURI && models.find((entry) => entry.uri === modelURI);

  if (model) {
    if (model.restricted) {
      return {
        kind: "restricted",
        message: model.restricted.message,
        model,
        ...withFix(
          findReplacement(model.canonicalId, oursFirst(models)) ?? auto,
        ),
      };
    }
    const newer =
      model.replacedBy &&
      models.find(
        (entry) =>
          entry.canonicalId === model.replacedBy &&
          entry.params.providerConfigId === model.params.providerConfigId &&
          !entry.restricted,
      );
    if (newer) {
      const offerKey = offerKeyOf(model, newer);
      if (!dismissedOffers.has(offerKey)) {
        return { kind: "newer", model, newer, offerKey };
      }
    }
    return { kind: "ready", model };
  }

  // A list that never arrived outranks anything read off it: the selection is
  // unresolvable either way, and blaming the model would send the user to pick
  // another one that is equally beyond reach.
  if (isError) {
    return { kind: "list-failed" };
  }

  if (modelURI) {
    const name = modelNameFromURI(modelURI) ?? modelURI;
    const source = readModelURI(modelURI);
    const failed =
      source &&
      errors.find((error) => error.config.id === source.providerConfigId);
    if (failed) {
      return {
        kind: "provider-failed",
        message: failed.message,
        name,
        provider: failed.config.displayName ?? "a provider",
      };
    }
    const fix = replacementFor(source, models, auto);
    // A connection that still lists anything is still connected, and its own
    // name is the one the user gave it. One that lists nothing is named by
    // its kind, except the custom kind, whose generic name says nothing.
    const stillListed =
      source &&
      models.find(
        (entry) => entry.params.providerConfigId === source.providerConfigId,
      );
    const provider =
      stillListed?.providerName.trim() ??
      (source && source.provider !== "openai-compatible"
        ? providerNames?.get(source.provider)
        : undefined);
    return {
      kind: "gone",
      name,
      reason: stillListed ? "dropped" : "disconnected",
      ...(provider && { provider }),
      ...withFix(fix),
      ...(fix &&
        fix.canonicalId === source?.canonicalId && { fixIsSameModel: true }),
    };
  }

  return models.length > 0 ? { kind: "none-chosen" } : { kind: "no-models" };
}

/**
 * Where to move someone whose model is gone, best first: the next release of
 * it through the same connection, the same model through any other, a next
 * release anywhere, and Auto.
 */
function replacementFor(
  source: null | { canonicalId: string; providerConfigId: string },
  models: AIGatewayModel.Type[],
  auto: AIGatewayModel.Type | undefined,
): AIGatewayModel.Type | undefined {
  if (!source) {
    return auto;
  }
  const sameConnection = models.filter(
    (model) => model.params.providerConfigId === source.providerConfigId,
  );
  const elsewhere = oursFirst(models);
  return (
    findReplacement(source.canonicalId, sameConnection) ??
    elsewhere.find(
      (model) => model.canonicalId === source.canonicalId && !model.restricted,
    ) ??
    findReplacement(source.canonicalId, elsewhere) ??
    auto
  );
}

/**
 * Instrument's models ahead of every other connection's, so where the same
 * fix is offered by more than one, the one through Instrument is offered: it
 * is the subscription the app is built around, where another connection is
 * a key the user may only have added for one model.
 */
function oursFirst(models: AIGatewayModel.Type[]) {
  return models.toSorted(
    (a, b) =>
      Number(b.params.provider === OUR_MODELS.providerType) -
      Number(a.params.provider === OUR_MODELS.providerType),
  );
}

const withFix = (fix: AIGatewayModel.Type | undefined) => (fix ? { fix } : {});

/** What the user does about a status. */
export type ModelAction =
  | { kind: "add-provider"; label: string }
  | { kind: "choose"; label: string }
  | { kind: "retry"; label: string }
  | { kind: "switch"; label: string; model: AIGatewayModel.Type };

/** How a status reads wherever it is shown: one sentence, one action, and whether it can be set aside. */
export interface ModelNotice {
  action?: ModelAction;
  /** Only an offer: a problem cannot be dismissed, only fixed. */
  dismissible: boolean;
  /** Said under the sentence where there is room, as in a toast. */
  detail?: string;
  text: string;
  /** An offer is quiet; everything else is a problem the user has to act on to send. */
  tone: "offer" | "problem";
}

export function noticeFor(status: ModelStatus): ModelNotice | null {
  switch (status.kind) {
    case "loading":
    case "ready": {
      return null;
    }
    case "newer": {
      return {
        action: { kind: "switch", label: "Switch", model: status.newer },
        dismissible: true,
        text: `A newer version, ${status.newer.name.trim()}, is out`,
        tone: "offer",
      };
    }
    case "restricted": {
      return {
        ...switchTo(status.fix),
        detail: status.message,
        dismissible: false,
        text: `${status.model.name.trim()} is unavailable`,
        tone: "problem",
      };
    }
    case "gone": {
      return {
        ...(status.fix && status.fixIsSameModel
          ? {
              action: {
                kind: "switch" as const,
                label: `Switch to ${status.fix.providerName.trim()}`,
                model: status.fix,
              },
            }
          : switchTo(status.fix)),
        dismissible: false,
        text: goneText(status),
        tone: "problem",
      };
    }
    case "provider-failed": {
      return {
        action: { kind: "retry", label: "Retry" },
        detail: status.message,
        dismissible: false,
        text: `Couldn't load models from ${status.provider}`,
        tone: "problem",
      };
    }
    case "list-failed": {
      return {
        action: { kind: "retry", label: "Retry" },
        dismissible: false,
        text: "Couldn't load models",
        tone: "problem",
      };
    }
    case "none-chosen": {
      return {
        action: { kind: "choose", label: "Choose a model" },
        dismissible: false,
        text: "No model chosen",
        tone: "problem",
      };
    }
    case "no-models": {
      return {
        action: { kind: "add-provider", label: "Add a provider" },
        dismissible: false,
        text: "No models available",
        tone: "problem",
      };
    }
  }
}

const switchTo = (fix: AIGatewayModel.Type | undefined) =>
  fix
    ? {
        action: {
          kind: "switch" as const,
          label:
            fix.providerId === OUR_MODELS.text.id
              ? "Switch to Auto"
              : `Switch to ${fix.name.trim()}`,
          model: fix,
        },
      }
    : { action: { kind: "choose" as const, label: "Choose a model" } };

/**
 * What happened to a model that is gone, as far as the list can say: its
 * connection went away, or the connection stopped offering it. Said with the
 * provider's name where there is one, since that is what the user changed or
 * what changed under them.
 */
function goneText({
  name,
  provider,
  reason,
}: Extract<ModelStatus, { kind: "gone" }>) {
  if (!provider) {
    return `${name} isn't available anymore`;
  }
  return reason === "dropped"
    ? `${provider} doesn't offer ${name} anymore`
    : `${provider} isn't connected anymore, so ${name} isn't available`;
}
