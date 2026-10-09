import { OUR_MODELS } from "@instrument-org/shared";

import { type AIGatewayModel } from "../schemas/model";
import { type ModelRelease, readModelRelease } from "./read-model-release";

/**
 * Names, on each model an author has shipped a newer version of, the model in
 * this list that replaced it: `claude-sonnet-5` gets `claude-sonnet-5.5` when
 * the provider lists both.
 *
 * Unlike `demoteSupersededModels`, which only reconsiders what this build
 * recommends, this reads every model, because the one a user pinned months ago
 * is exactly the one they need telling about.
 *
 * A replacement is a higher version of the same series. A dated build or a
 * `-latest` alias of the same version is the same model served another way, so
 * it replaces nothing. A candidate may not hedge more than the model it would
 * replace, so a preview never stands in for a stable release.
 *
 * Left alone: a model whose id carries no version, a model whose series this
 * list has nothing newer of, and our own catalog, which is curated rather than
 * inferred.
 */
export function markReplacedModels(
  models: AIGatewayModel.Type[],
): AIGatewayModel.Type[] {
  const releases = new Map<AIGatewayModel.Type, ModelRelease>();
  for (const model of models) {
    if (model.author === OUR_MODELS.author) {
      continue;
    }
    const release = readModelRelease(model.canonicalId);
    if (release) {
      releases.set(model, release);
    }
  }

  return models.map((model) => {
    const release = releases.get(model);
    if (!release) {
      return model;
    }

    let replacement:
      | { model: AIGatewayModel.Type; release: ModelRelease }
      | undefined;
    for (const [candidate, candidateRelease] of releases) {
      if (
        candidateRelease.series !== release.series ||
        candidateRelease.version <= release.version ||
        candidateRelease.qualifierCount > release.qualifierCount
      ) {
        continue;
      }
      if (
        !replacement ||
        candidateRelease.version > replacement.release.version ||
        (candidateRelease.version === replacement.release.version &&
          candidateRelease.qualifierCount < replacement.release.qualifierCount)
      ) {
        replacement = { model: candidate, release: candidateRelease };
      }
    }

    return replacement
      ? { ...model, replacedBy: replacement.model.canonicalId }
      : model;
  });
}
