import {
  type AIProviderConfigId,
  type AIProviderType,
} from "@instrument-org/shared";

import { type AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";

/**
 * The connection this computer settled on for a model a stored URI names
 * through a connection it does not have, by `routeKeyOf`: kept on this
 * computer only, so a chat another computer last chose for always goes
 * through the same one here.
 */
export type ModelRouteTable = Readonly<Record<string, string>>;

/** Where this computer keeps its routes, read whole and added to one at a time. */
export interface ModelRoutes {
  read(): ModelRouteTable;
  remember(key: string, providerConfigId: string): void;
}

export const noopModelRoutes: ModelRoutes = {
  read: () => ({}),
  remember: () => undefined,
};

/** One of this computer's connections, in the order they were added. */
export interface ModelConnection {
  id: AIProviderConfigId;
  type: AIProviderType;
}

/** The route table's key for a model reached through a kind of provider. */
export function routeKeyOf(provider: AIProviderType, canonicalId: string) {
  return `${provider}:${canonicalId}`;
}

export type ModelRoute =
  /** The URI's own connection is on this computer: used as it is. */
  | { kind: "exact"; uri: AIGatewayModelURI.Type }
  /** Another computer's connection, reached through the one this computer remembered. */
  | { kind: "remembered"; uri: AIGatewayModelURI.Type }
  /**
   * Another computer's connection, reached through the first connection of
   * the same kind here that lists the model, to remember under `key`.
   */
  | {
      key: string;
      kind: "found";
      providerConfigId: AIProviderConfigId;
      uri: AIGatewayModelURI.Type;
    }
  /** Nothing here reaches it without crossing to another kind of provider. */
  | { kind: "none" };

/**
 * Which URI this computer sends a stored model URI as. Never crosses
 * provider kinds and never consults anything but its inputs, so the composer
 * and the send, given the same inputs, always agree:
 *
 * 1. the URI's own connection, when this computer has it;
 * 2. the connection this computer remembered for the model and its kind;
 * 3. the first connection of the same kind, in the order added, that lists
 *    the model, preferring one that does not restrict it;
 * 4. none, for the caller's "gone" status.
 *
 * `models` is only read for step 3, so a caller that has no list yet still
 * gets steps 1 and 2.
 */
export function routeModel({
  connections,
  models,
  routes,
  uri,
}: {
  connections: readonly ModelConnection[];
  models: readonly AIGatewayModel.Type[];
  routes: ModelRouteTable;
  uri: string;
}): ModelRoute {
  const parsed = AIGatewayModelURI.parse(uri);
  if (!parsed.ok) {
    return { kind: "none" };
  }
  const { author, canonicalId, params } = parsed.value;
  if (connections.some((c) => c.id === params.providerConfigId)) {
    return { kind: "exact", uri: AIGatewayModelURI.Schema.parse(uri) };
  }

  const sameKind = connections.filter((c) => c.type === params.provider);
  const key = routeKeyOf(params.provider, canonicalId);
  const remembered = sameKind.find((c) => c.id === routes[key]);
  if (remembered) {
    return {
      kind: "remembered",
      uri:
        listed(models, remembered.id, canonicalId)?.uri ??
        AIGatewayModelURI.fromModel({
          author,
          canonicalId: AIGatewayModelURI.CanonicalIdSchema.parse(canonicalId),
          params: { ...params, providerConfigId: remembered.id },
        }),
    };
  }

  const offers = sameKind.flatMap((c) => {
    const model = listed(models, c.id, canonicalId);
    return model ? [model] : [];
  });
  const found = offers.find((m) => !m.restricted) ?? offers[0];
  return found
    ? {
        key,
        kind: "found",
        providerConfigId: found.params.providerConfigId,
        uri: found.uri,
      }
    : { kind: "none" };
}

function listed(
  models: readonly AIGatewayModel.Type[],
  providerConfigId: string,
  canonicalId: string,
) {
  return models.find(
    (m) =>
      m.params.providerConfigId === providerConfigId &&
      m.canonicalId === canonicalId,
  );
}
