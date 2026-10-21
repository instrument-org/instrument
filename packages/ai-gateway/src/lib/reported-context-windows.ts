/**
 * Context windows a provider reported while serving a model, which outrank
 * the catalog's figure: a Claude account's Claude Code says at the end of each
 * turn how large a window it ran the model in. Kept for as long as this
 * process runs, so the catalog's figure stands in until the model has
 * answered once.
 *
 * Its own entry point, apart from the provider stack, so the context budget
 * can read it without loading every provider SDK.
 */

/** Which model, as one provider connection serves it. */
interface ServedModel {
  params: { providerConfigId: string };
  providerId: string;
}

const reported = new Map<string, number>();

function keyOf(model: ServedModel) {
  return JSON.stringify([model.params.providerConfigId, model.providerId]);
}

export function noteReportedContextLength(model: ServedModel, tokens: number) {
  if (Number.isInteger(tokens) && tokens > 0) {
    reported.set(keyOf(model), tokens);
  }
}

/** The window the provider last reported for `model`, if it has reported one. */
export function reportedContextLength(model: ServedModel): number | undefined {
  return reported.get(keyOf(model));
}
