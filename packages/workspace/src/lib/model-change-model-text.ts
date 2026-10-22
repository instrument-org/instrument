import {
  type AIGatewayModel,
  isRouterModel,
  modelDisplayName,
} from "@instrument-org/ai-gateway";
import { APP_NAME } from "@instrument-org/shared";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

const WHEN_ASKED = `Asked what model you are, name it plainly; you are still ${APP_NAME}.`;

/**
 * The model a session starts on, as its baseline tells it. A router is named
 * as itself: which model it picks is decided per request, after this is
 * written, so naming its current pick would be a guess.
 */
export function runningModelText(model: AIGatewayModel.Type): string {
  const name = modelDisplayName(model.canonicalId, model.name);
  const provider = model.providerName?.trim();
  const from = provider ? ` from ${provider}` : "";
  return isRouterModel(model)
    ? `Model: you run on ${name}${from}, which picks a model for each request; which one answered is not known to you. ${WHEN_ASKED}`
    : `Model: you run on ${name}${from}, the model the user picked for this chat. ${WHEN_ASKED}`;
}

/**
 * Tells the model the user switched models since the last reply. The model
 * named in the baseline is where the session started and is never rewritten,
 * so this supersedes it from this turn on.
 */
export function modelChangeModelNote(
  data: SessionMessageDataPart.ModelChangeDataPart,
) {
  const from = modelDisplayName(data.from.modelId, data.from.name);
  const to = modelDisplayName(data.to.modelId, data.to.name);
  const provider = data.to.providerName?.trim();
  return systemNote`
    The user switched this chat's model from ${from} to ${to}. From this turn on you run on ${to}${provider ? ` from ${provider}` : ""}; this supersedes the model named above.
  `;
}
