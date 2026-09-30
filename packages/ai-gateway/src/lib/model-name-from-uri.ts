import { type AIProviderType } from "@instrument-org/shared";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { generateModelName } from "./generate-model-name";

/**
 * Names a model we can only identify by its URI, for when a selection outlives
 * its place in the models list: a provider that was removed, a key that stopped
 * working, or a plan that no longer reaches it. The list is the only source of
 * real display names, so this derives one from the id and is a fallback rather
 * than a substitute. Returns null if the URI is not shaped like one.
 */
export function modelNameFromURI(uri: string): null | string {
  const parts = AIGatewayModelURI.parseURIParts(uri);
  if (!parts.ok) {
    return null;
  }

  const canonicalId = AIGatewayModel.CanonicalIdSchema.safeParse(
    parts.value.canonicalId,
  );

  return canonicalId.success ? generateModelName(canonicalId.data) : null;
}

/**
 * The provider type a model URI was chosen from, for saying why a selection
 * the list no longer resolves went missing. Null if the URI is not shaped
 * like one.
 */
export function providerTypeFromURI(uri: string): AIProviderType | null {
  const parsed = AIGatewayModelURI.parse(uri);
  return parsed.ok ? parsed.value.params.provider : null;
}
