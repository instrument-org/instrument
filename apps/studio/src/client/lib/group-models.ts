import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import { OUR_MODELS } from "@instrument-org/shared";
import { fork, listify } from "radashi";

export interface GroupedModels {
  Legacy: AIGatewayModel.Type[];
  "May not support tools": AIGatewayModel.Type[];
  New: AIGatewayModel.Type[];
  Other: AIGatewayModel.Type[];
  Premium: AIGatewayModel.Type[];
  Recommended: AIGatewayModel.Type[];
}

type GroupedModelsEntry = {
  [K in keyof GroupedModels]: [K, GroupedModels[K]];
}[keyof GroupedModels];

export function getGroupedModelsEntries(
  grouped: GroupedModels,
): GroupedModelsEntry[] {
  return listify(grouped, (key, value) => [key, value]);
}

export function groupAndFilterModels({
  hasPlan,
  models,
}: {
  hasPlan: boolean;
  models: AIGatewayModel.Type[];
}): GroupedModels {
  const shouldSeparatePremium = !hasPlan;

  const [recommended, notRecommended] = fork(
    models,
    (model) =>
      model.tags.includes("recommended") && model.tags.includes("coding"),
  );

  const [ourPremium, otherPremium] = shouldSeparatePremium
    ? fork(
        recommended,
        (model) =>
          model.params.provider === OUR_MODELS.providerType &&
          model.tags.includes("premium"),
      )
    : [[], recommended];

  const [defaultRecommended, nonDefaultRecommended] = fork(
    otherPremium,
    (model) => model.tags.includes("default"),
  );

  const [supportsTools, doesNotSupportTools] = fork(notRecommended, (model) =>
    model.features.includes("tools"),
  );

  const [newModels, notNewModels] = fork(supportsTools, (model) =>
    model.tags.includes("new"),
  );

  const [legacy, notLegacy] = fork(notNewModels, (model) =>
    model.tags.includes("legacy"),
  );

  /* eslint-disable perfectionist/sort-objects */
  const result: GroupedModels = {
    Recommended: prioritizeOurModels([
      ...defaultRecommended,
      ...nonDefaultRecommended,
    ]),
    Premium: prioritizeOurModels(ourPremium),
    New: prioritizeOurModels(newModels),
    Other: prioritizeOurModels(notLegacy),
    Legacy: prioritizeOurModels(legacy),
    "May not support tools": prioritizeOurModels(doesNotSupportTools),
  };
  /* eslint-enable perfectionist/sort-objects */

  return result;
}

function prioritizeOurModels(
  models: AIGatewayModel.Type[],
): AIGatewayModel.Type[] {
  return sortModelsByProviderAndName(models);
}

function sortModelsByProviderAndName(
  models: AIGatewayModel.Type[],
): AIGatewayModel.Type[] {
  return models.toSorted((a, b) => {
    const authorA = a.author;
    const authorB = b.author;

    if (authorA !== authorB) {
      if (authorA === OUR_MODELS.author) {
        return -1;
      }
      if (authorB === OUR_MODELS.author) {
        return 1;
      }
    }

    const providerA = a.params.provider;
    const providerB = b.params.provider;

    if (providerA !== providerB) {
      if (providerA === OUR_MODELS.providerType) {
        return -1;
      }
      if (providerB === OUR_MODELS.providerType) {
        return 1;
      }

      return providerA.localeCompare(providerB);
    }

    // Keep our models in the order they are returned by the API
    if (authorA === OUR_MODELS.author && authorB === OUR_MODELS.author) {
      return 0;
    }

    return a.name.localeCompare(b.name);
  });
}
