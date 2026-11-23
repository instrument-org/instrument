import {
  type AIGatewayModel,
  type AIGatewayModelURI,
  findReplacement,
  type ModelConnection,
  modelNameFromURI,
  type ModelRouteTable,
  readModelURI,
  routeModel,
} from "@instrument-org/ai-gateway/client";
import {
  isSignInAccountType,
  SIGN_IN_ACCOUNT_NAMES,
  type SignInAccountType,
} from "@/shared/notices";
import {
  type AIProviderConfigId,
  AIProviderConfigIdSchema,
  type AIProviderType,
  APP_NAME,
  OUR_MODELS,
} from "@instrument-org/shared";

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
      /** The server's word for why, an open list. */
      reason: string;
    }
  /** Chosen once, and no connected provider lists it any more. */
  | {
      /** The account it was chosen through, when it is not connected here and can be signed in to. */
      account?: SignInAccountType;
      /** The signed-out account's connection id, to sign in to the same one again. */
      accountId?: string;
      /** The disabled connection it was chosen through, to enable again. */
      disabledId?: AIProviderConfigId;
      fix?: AIGatewayModel.Type;
      /** The fix is this model through another connection, so the offer names the connection. */
      fixIsSameModel?: boolean;
      kind: "gone";
      name: string;
      /** The provider it was chosen through, when that can still be named. */
      provider?: string;
      /** It was chosen through Instrument, which the person logs in to. */
      isOurs?: boolean;
      /** The connection it was chosen through, as its address names it. */
      source?: { id: string; provider: AIProviderType };
      /** Nothing at all is listed, so there is no other model to choose. */
      nothingListed?: boolean;
      /**
       * Why it is gone, as far as the list can tell: the connection it came
       * through lists nothing at all any more (removed, or signed out of), is
       * an account signed out without the person asking, is turned off in
       * Settings, or still lists models and this one is not among them.
       */
      reason: "disconnected" | "dropped" | "off" | "signed-out";
    }
  /** Chosen through a provider whose list failed to load, so whether it is still offered is unknown. */
  | {
      fix?: AIGatewayModel.Type;
      kind: "provider-failed";
      message: string;
      name: string;
      nothingListed?: boolean;
      provider: string;
    }
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

/** What the models list says this computer has: its models, its connections in the order added, and its routes. */
export interface ModelsHere {
  connections?: readonly ModelConnection[];
  models?: readonly AIGatewayModel.Type[];
  routes?: ModelRouteTable;
}

/**
 * A stored model URI as this computer reaches it (`routeModel`): the URI it
 * sends as, and the listed model at it, if any. A URI nothing here reaches is
 * answered as it is, for the status to call gone. Every place that shows or
 * checks a chosen model reads it through this, so none of them can differ
 * from the send, which routes in the main process the same way.
 */
export function reachModel(
  { connections = [], models = [], routes = {} }: ModelsHere = {},
  uri: AIGatewayModelURI.Type | undefined,
): { model?: AIGatewayModel.Type; uri?: AIGatewayModelURI.Type } {
  if (!uri) {
    return {};
  }
  const route = routeModel({ connections, models, routes, uri });
  const reached = route.kind === "none" ? uri : route.uri;
  return {
    model: models.find((entry) => entry.uri === reached),
    uri: reached,
  };
}

export function readModelStatus({
  connections,
  disabled,
  dismissedOffers,
  errors = [],
  isError = false,
  isLoading = false,
  models = [],
  modelURI,
  providerNames,
  routes,
  signedOut,
}: {
  /** This computer's connections and routes, from the list, for `reachModel`. */
  connections?: readonly ModelConnection[];
  /** The connections turned off in Settings, by id. */
  disabled?: ReadonlySet<string>;
  dismissedOffers: ReadonlySet<string>;
  errors?: ModelListError[];
  isError?: boolean;
  isLoading?: boolean;
  models?: AIGatewayModel.Type[];
  modelURI?: AIGatewayModelURI.Type;
  /** What each kind of provider is called, for naming a connection that is no longer there. */
  providerNames?: ReadonlyMap<AIProviderType, string>;
  routes?: ModelRouteTable;
  /** The accounts signed out without the person asking, by connection id. */
  signedOut?: ReadonlySet<string>;
}): ModelStatus {
  if (isLoading) {
    return { kind: "loading" };
  }

  const auto = models.find((model) => model.providerId === OUR_MODELS.text.id);
  const { model } = reachModel({ connections, models, routes }, modelURI);

  if (model) {
    if (model.restricted) {
      return {
        kind: "restricted",
        message: model.restricted.message,
        model,
        reason: model.restricted.reason,
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
    const nothingListed = models.length === 0;
    const fix = replacementFor(source, models, auto);
    if (failed) {
      return {
        ...withFix(fix),
        ...(nothingListed && { nothingListed }),
        kind: "provider-failed",
        message: failed.message,
        name,
        provider: failed.config.displayName ?? "a provider",
      };
    }
    // A connection that still lists anything is still connected, and its own
    // name is the one the user gave it. One that lists nothing is named by
    // its kind, except the custom kind, whose generic name says nothing.
    const stillListed =
      source &&
      models.find(
        (entry) => entry.params.providerConfigId === source.providerConfigId,
      );
    const isOff =
      source !== null &&
      !stillListed &&
      (disabled?.has(source.providerConfigId) ?? false);
    const account =
      source && !stillListed && !isOff && isSignInAccountType(source.provider)
        ? source.provider
        : undefined;
    const accountSignedOut =
      account !== undefined &&
      source !== null &&
      (signedOut?.has(source.providerConfigId) ?? false);
    const provider =
      stillListed?.providerName.trim() ??
      (source && source.provider !== "openai-compatible"
        ? providerNames?.get(source.provider)
        : undefined);
    return {
      kind: "gone",
      name,
      reason: stillListed
        ? "dropped"
        : isOff
          ? "off"
          : accountSignedOut
            ? "signed-out"
            : "disconnected",
      ...(account && { account }),
      ...(accountSignedOut && { accountId: source.providerConfigId }),
      ...(source && {
        source: { id: source.providerConfigId, provider: source.provider },
      }),
      ...(isOff && {
        disabledId: AIProviderConfigIdSchema.parse(source.providerConfigId),
      }),
      ...(!stillListed &&
        source?.provider === OUR_MODELS.providerType && { isOurs: true }),
      ...(nothingListed && { nothingListed }),
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
  /** Use the disabled connection again. */
  | { id: AIProviderConfigId; kind: "enable"; label: string }
  /** Instrument's plans, on the website, for a model the plan leaves out. */
  | { kind: "see-plans"; label: string }
  /** Log in to Instrument. */
  | { kind: "log-in"; label: string }
  | { kind: "retry"; label: string }
  /** Sign in to the account again, the one `accountId` names when known. */
  | {
      account: SignInAccountType;
      accountId?: string;
      kind: "sign-in";
      label: string;
    }
  | { kind: "switch"; label: string; model: AIGatewayModel.Type };

/** How a status reads wherever it is shown: one sentence, the ways forward, and whether it can be set aside. */
export interface ModelNotice {
  action?: ModelAction;
  /** Only an offer: a problem cannot be dismissed, only fixed. */
  dismissible: boolean;
  /**
   * The connection the action brings back. It lists no models meanwhile, so
   * the picker shows it from here.
   */
  connection?: { id: string; name: string; provider: AIProviderType };
  /** Another way forward, offered quietly beside the action. */
  secondary?: ModelAction;
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
        text: `A newer version of your model is available. Switch to ${status.newer.name.trim()}?`,
        tone: "offer",
      };
    }
    case "restricted": {
      return {
        // Only a plan's own restriction is one a plan lifts.
        ...(status.model.params.provider === OUR_MODELS.providerType &&
        status.reason === "plan"
          ? {
              action: { kind: "see-plans" as const, label: "See plans" },
              secondary: switchOrChoose(status),
            }
          : { action: switchOrChoose(status) }),
        dismissible: false,
        text: `${status.model.name.trim()} is unavailable. ${status.message}`,
        tone: "problem",
      };
    }
    case "gone": {
      return {
        ...goneActions(status),
        dismissible: false,
        text: goneText(status),
        tone: "problem",
      };
    }
    case "provider-failed": {
      return {
        action: { kind: "retry", label: "Retry" },
        secondary: switchOrChoose(status),
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
        action: ADD_PROVIDER,
        dismissible: false,
        text: "No models available",
        tone: "problem",
      };
    }
  }
}

/**
 * The ways forward from a model that is gone, the one that gets the person's
 * own model back first where a press can do it: sign in to its account, log in
 * to Instrument, or enable its connection. Moving to another model is then
 * offered beside it. A key that was removed can't be put back by a press, so
 * moving leads there, with adding a provider beside it.
 */
function goneActions(
  status: Extract<ModelStatus, { kind: "gone" }>,
): Pick<ModelNotice, "action" | "connection" | "secondary"> {
  const move = switchOrChoose(status);
  const name = status.account
    ? SIGN_IN_ACCOUNT_NAMES[status.account]
    : status.isOurs
      ? APP_NAME
      : (status.provider ?? status.name);
  const connection = status.source && { ...status.source, name };
  if (status.account) {
    return {
      action: {
        account: status.account,
        accountId: status.accountId,
        kind: "sign-in",
        label: status.reason === "signed-out" ? "Sign in" : `Connect ${name}`,
      },
      connection,
      secondary: move,
    };
  }
  if (status.disabledId) {
    return {
      action: {
        id: status.disabledId,
        kind: "enable",
        label: status.provider ? `Enable ${status.provider}` : "Enable",
      },
      connection,
      secondary: move,
    };
  }
  if (status.isOurs) {
    return {
      action: { kind: "log-in", label: `Log in to ${APP_NAME}` },
      connection,
      secondary: move,
    };
  }
  if (status.reason === "disconnected" && move.kind !== "add-provider") {
    return { action: move, secondary: ADD_PROVIDER };
  }
  return { action: move };
}

const ADD_PROVIDER = {
  kind: "add-provider",
  label: "Add a provider",
} as const satisfies ModelAction;

/**
 * Moving to another model: the one worked out as the best replacement, or the
 * picker to choose one, or a way to connect something when nothing is listed
 * to choose from.
 */
function switchOrChoose({
  fix,
  fixIsSameModel,
  nothingListed,
}: {
  fix?: AIGatewayModel.Type;
  fixIsSameModel?: boolean;
  nothingListed?: boolean;
}): ModelAction {
  if (!fix) {
    return nothingListed
      ? ADD_PROVIDER
      : { kind: "choose", label: "Choose a model" };
  }
  return {
    kind: "switch",
    label: fixIsSameModel
      ? `Switch to ${fix.providerName.trim()}`
      : fix.providerId === OUR_MODELS.text.id
        ? "Switch to Auto"
        : `Switch to ${fix.name.trim()}`,
    model: fix,
  };
}

/**
 * What happened to a model that is gone, as far as the list can say: its
 * connection went away, or the connection stopped offering it. Said with the
 * provider's name where there is one, since that is what the user changed or
 * what changed under them.
 */
function goneText({
  account,
  name,
  provider,
  reason,
}: Extract<ModelStatus, { kind: "gone" }>) {
  if (account && reason === "signed-out") {
    return `You're signed out of ${SIGN_IN_ACCOUNT_NAMES[account]}`;
  }
  if (reason === "off") {
    return provider
      ? `${provider} is turned off, so ${name} isn't available`
      : `${name} isn't available while its provider is turned off`;
  }
  if (!provider) {
    return `${name} isn't available anymore`;
  }
  return reason === "dropped"
    ? `${provider} doesn't offer ${name} anymore`
    : `${provider} isn't connected anymore, so ${name} isn't available`;
}
