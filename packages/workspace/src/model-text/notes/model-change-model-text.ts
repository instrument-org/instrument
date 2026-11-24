import {
  type AIGatewayModel,
  isRouterModel,
  modelDisplayName,
} from "@instrument-org/ai-gateway";
import { APP_NAME } from "@instrument-org/shared";

import { modelSide } from "../../lib/model-change";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { systemNote } from "./system-note";

type ModelSide = SessionMessageDataPart.ModelChangeDataPart["from"];

/** Makers as they write their own names; another is named by its slug. */
const MAKERS: Record<string, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  "x-ai": "xAI",
  xai: "xAI",
};

/** What a model is and what the user saw it called, as its record says. */
function factsOf(side: ModelSide) {
  const label = modelDisplayName(side.modelId, side.name);
  const line = side.family?.trim() || label;
  const isRouter =
    side.providerId !== undefined &&
    isRouterModel({ providerId: side.providerId });
  return {
    id: side.providerId,
    isRouter,
    label,
    line,
    // Our own models name the maker apart from their author, which is us.
    maker:
      !isRouter && side.maker ? (MAKERS[side.maker] ?? side.maker) : undefined,
    served: side.providerName?.trim(),
  };
}

/** The model as a name, with the picker's name for it where that differs. */
function named(side: ModelSide): string {
  const { isRouter, label, line, maker } = factsOf(side);
  if (isRouter) {
    return `"${label}"`;
  }
  return [
    line,
    maker && `, made by ${maker}`,
    line !== label && ` (picked as "${label}")`,
  ]
    .filter(Boolean)
    .join("");
}

function routerText(label: string): string {
  return `"${label}" chooses a model for each request, so it can change between replies; a note says which one answered last once that is known`;
}

/** What to say when the user asks, which differs only in what is known. */
function whenAsked(isRouter: boolean, label: string): string {
  return `You are still ${APP_NAME}, the agent. Asked what model you are, ${
    isRouter
      ? `say ${label} chose it and name the last one you were told of, if any`
      : "name the model plainly"
  }.`;
}

/**
 * The model a session starts on, as its baseline tells it: the model line and
 * its maker, the id to look it up by, and the name the user picked it under. A
 * router is named as itself: which model it picks is decided per request,
 * after this is written, so naming its current pick would be a guess.
 */
export function runningModelText(model: AIGatewayModel.Type): string {
  const { id, isRouter, label, line, maker, served } = factsOf(
    modelSide(model),
  );
  const through = served ? `, served through ${served}` : "";
  const asId = id ? ` (model id ${id})` : "";
  if (isRouter) {
    return `Model: the user picked "${label}"${through}${asId}. ${routerText(label)}. ${whenAsked(true, label)}`;
  }
  const by = maker ? `, made by ${maker}` : "";
  const picked =
    line === label ? "The user picked it" : `The user picked it as "${label}"`;
  return `Model: you run on ${line}${by}. ${picked}${through}${asId}. ${whenAsked(false, label)}`;
}

/**
 * Tells the model the user switched models since the last reply. The model
 * named in the baseline is where the session started and is never rewritten,
 * so this supersedes it from this turn on. A record from before a switch kept
 * the model's facts says what it always has, so a chat's earlier turns are
 * sent as they were.
 */
export function modelChangeModelNote(
  data: SessionMessageDataPart.ModelChangeDataPart,
) {
  const to = factsOf(data.to);
  if (to.id === undefined) {
    const from = modelDisplayName(data.from.modelId, data.from.name);
    return systemNote`
      The user switched this chat's model from ${from} to ${to.label}. From this turn on you run on ${to.label}${to.served ? ` from ${to.served}` : ""}; this supersedes the model named above.
    `;
  }
  const through = to.served ? `, served through ${to.served}` : "";
  return systemNote`
    The user switched this chat's model from ${named(data.from)} to ${named(data.to)}${through} (model id ${to.id}). Replies before this came from the earlier model. ${
      to.isRouter
        ? `${routerText(to.label)}.`
        : `From here you run on ${to.line}.`
    } This replaces what you were told above about your model. ${whenAsked(to.isRouter, to.label)}
  `;
}

/** Which model wrote the last reply, where the provider reported another id than the one asked. */
export function modelAnsweredModelNote({
  modelId,
  providerName,
}: SessionMessageDataPart.ModelAnsweredDataPart) {
  const by = providerName?.trim();
  return systemNote`
    About your model, for reference only, and not part of the user's message: the reply just before this message was written by ${modelDisplayName(modelId)} (model id ${modelId})${by ? `, as ${by} reported` : ""}. Don't mention it unless asked what model you are.
  `;
}
