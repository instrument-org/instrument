import { OUR_MODELS } from "@instrument-org/shared";

import { type AIGatewayModel } from "../schemas/model";
import {
  type ModelRelease,
  outranksRelease,
  readModelRelease,
} from "./read-model-release";

/**
 * Takes `recommended` and `default` off any model an author has since replaced.
 *
 * A version floor can only say how old is too old, and a catalog answers with
 * every release above it at once: DeepSeek V4 Flash three times over, Gemini at
 * 3.1 and 3.5 and 3.6 and 3.7, Kimi at K2.6 and K2.7 and K3. Under one heading
 * they read as a choice the user has to make, when in truth all but one of them
 * is a model their author has moved on from.
 *
 * Two things supersede a model, both read out of the list rather than off a
 * date we are not given:
 *
 * 1. A later release of its own series. `deepseek-v4-flash-0731` supersedes the
 *    0423 build beside it and the `-latest` alias pointing at the same weights.
 * 2. A later generation of its family, whatever tier that generation landed in,
 *    where a generation is a version two of the family's lines have reached.
 *    Claude Haiku 4.5 is what Anthropic shipped for the 4.5 generation and the
 *    lineup has since moved to 5, so it is last generation's small model rather
 *    than this one's. That is the same reading, applied across a family's tiers
 *    instead of within one.
 *
 * Both hold for a model released after this build without anyone touching a
 * floor, which is the point: the floors say which families are worth
 * recommending, and the list says which release of each.
 *
 * Left alone: a model whose id carries no version, since it has nothing to be
 * newer or older than, and our own catalog, which is curated rather than
 * inferred.
 *
 * Needs a whole provider's list, so it runs beside the fetch rather than in
 * `addHeuristicTags`, which only ever sees one model.
 */
export function demoteSupersededModels(
  models: AIGatewayModel.Type[],
): AIGatewayModel.Type[] {
  const releases = new Map<string, ModelRelease>();
  for (const model of models) {
    if (!isRankedAgainstTheList(model)) {
      continue;
    }
    const release = readModelRelease(model.canonicalId);
    if (release) {
      releases.set(model.canonicalId, release);
    }
  }

  const newestInSeries = new Map<string, ModelRelease>();
  for (const release of releases.values()) {
    const newest = newestInSeries.get(release.series);
    if (!newest || outranksRelease(release, newest)) {
      newestInSeries.set(release.series, release);
    }
  }

  const familyGeneration = readGenerationByFamily(newestInSeries.values());

  return models.map((model) => {
    const release = releases.get(model.canonicalId);
    if (!release) {
      return model;
    }

    const newest = newestInSeries.get(release.series);
    const generation = familyGeneration.get(release.family) ?? release.version;
    if (
      (newest && outranksRelease(newest, release)) ||
      release.version < generation
    ) {
      return {
        ...model,
        tags: model.tags.filter(
          (tag) => tag !== "recommended" && tag !== "default",
        ),
      };
    }

    return model;
  });
}

// Only a model this build put forward as a recommendation is ranked against the
// rest of the list. Everything else either has no recommendation to lose or
// carries one nothing here is in a position to second-guess.
function isRankedAgainstTheList(model: AIGatewayModel.Type): boolean {
  return (
    model.tags.includes("recommended") && model.author !== OUR_MODELS.author
  );
}

/**
 * The version each family's lineup has moved to, read as the highest version
 * two of its lines have both reached.
 *
 * One line does not move a lineup on its own. Anthropic shipping Fable 5.1
 * leaves Opus 5 and Sonnet 5 as that generation's flagship and workhorse, and
 * reading the family as 5.1 would take both off the list over a point release
 * of a third tier. Two lines standing at 5 is the lineup standing at 5.
 *
 * When no two lines share a version there is no shared generation to read, so
 * the newest release speaks for the family. That is what carries Gemini, whose
 * Pro, Flash, and Flash Lite have each stopped at a different version.
 */
function readGenerationByFamily(
  releases: Iterable<ModelRelease>,
): Map<string, number> {
  const versionsByFamily = new Map<string, number[]>();
  for (const release of releases) {
    versionsByFamily.set(release.family, [
      ...(versionsByFamily.get(release.family) ?? []),
      release.version,
    ]);
  }

  const generations = new Map<string, number>();
  for (const [family, versions] of versionsByFamily) {
    const reachedTwice = versions.filter(
      (version, index) => versions.indexOf(version) !== index,
    );
    generations.set(
      family,
      Math.max(...(reachedTwice.length > 0 ? reachedTwice : versions)),
    );
  }

  return generations;
}
