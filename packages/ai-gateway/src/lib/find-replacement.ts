import { type AIProviderType } from "@instrument-org/shared";

import { type AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { readModelRelease } from "./read-model-release";

/**
 * What a model URI names, for a selection the models list no longer resolves:
 * which connection it was reached through, what kind of provider that was,
 * and which model it was.
 */
export function readModelURI(uri: string): null | {
  canonicalId: string;
  provider: AIProviderType;
  providerConfigId: string;
} {
  const parsed = AIGatewayModelURI.parse(uri);
  return parsed.ok
    ? {
        canonicalId: parsed.value.canonicalId,
        provider: parsed.value.params.provider,
        providerConfigId: parsed.value.params.providerConfigId,
      }
    : null;
}

/**
 * The model among `candidates` to move a user to when `canonicalId` is gone:
 * the newest release of the same series at or above its version, never more
 * hedged than it (a preview does not stand in for a stable release). Returns
 * undefined when the id carries no version or nothing in the list continues
 * its series.
 */
export function findReplacement(
  canonicalId: string,
  candidates: AIGatewayModel.Type[],
): AIGatewayModel.Type | undefined {
  const release = readModelRelease(canonicalId);
  if (!release) {
    return undefined;
  }

  let best: { model: AIGatewayModel.Type; version: number } | undefined;
  for (const model of candidates) {
    if (model.restricted || model.canonicalId === canonicalId) {
      continue;
    }
    const candidate = readModelRelease(model.canonicalId);
    if (
      candidate?.series === release.series &&
      candidate.version >= release.version &&
      candidate.qualifierCount <= release.qualifierCount &&
      (!best || candidate.version > best.version)
    ) {
      best = { model, version: candidate.version };
    }
  }
  return best?.model;
}
