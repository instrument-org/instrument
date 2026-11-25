import {
  type AIGatewayModel,
  type ModelChoice,
} from "@instrument-org/ai-gateway/client";
import { capitalize } from "radashi";

export interface ReadChoice {
  /** The chosen level, or nothing on Default. */
  effort: AIGatewayModel.Choices["efforts"][number] | undefined;
  fast: boolean;
  /** What the choice names that the model cannot do, said over the reply box. */
  notice: string | undefined;
  /** The choice without what the model cannot do. */
  kept: ModelChoice | undefined;
}

/**
 * A person's choice as the model now takes it. A model whose choices are not
 * known yet (its list or our API's settings still on their way) keeps the
 * choice without showing it.
 */
export function readChoice(
  model: AIGatewayModel.Type | undefined,
  choice: ModelChoice | undefined,
): ReadChoice {
  const nothing = { effort: undefined, fast: false, notice: undefined };
  if (
    !model ||
    !choice ||
    choice.model !== model.canonicalId ||
    choice.provider !== model.params.provider
  ) {
    return { ...nothing, kept: undefined };
  }
  const { choices } = model;
  if (!choices) {
    return { ...nothing, kept: choice };
  }
  const effort = choices.efforts.find(({ id }) => id === choice.effort);
  const fast = choice.fast === true && choices.fast?.off === undefined;
  const runsFast = fast && choices.fast !== undefined;
  return {
    effort,
    fast: runsFast,
    kept: makeChoice(model, { effort: effort?.id, fast: runsFast }),
    notice:
      choice.effort !== undefined && !effort
        ? `${model.name.trim()} no longer supports ${EFFORT_NAMES[choice.effort] ?? capitalize(choice.effort)}. This chat now uses Default.`
        : choice.fast && !runsFast
          ? (choices.fast?.off?.note ??
            `${model.name.trim()} no longer supports Fast.`)
          : undefined,
  };
}

/** Names for a level a model no longer lists. */
const EFFORT_NAMES: Record<string, string> = { xhigh: "Extra High" };

/** The choice for `model`, or nothing when all of it is on Default. */
export function makeChoice(
  model: AIGatewayModel.Type,
  { effort, fast }: { effort: string | undefined; fast: boolean },
): ModelChoice | undefined {
  return effort === undefined && !fast
    ? undefined
    : {
        ...(effort !== undefined && { effort }),
        ...(fast && { fast }),
        model: model.canonicalId,
        provider: model.params.provider,
      };
}
