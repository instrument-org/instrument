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
