import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { readModelWindow } from "../model-window";
import { type CapabilityContext, type Surface } from "./define";

/** What a shell knows about the bash call it runs, from which each call's context is made. */
export interface CapabilityScope {
  chatId: ChatId;
  model?: string;
  role: "chat" | "task";
  sessionId: StoreId.Session;
}

/**
 * The contexts of the calls one bash call makes, on one surface. The model
 * window is read once, at the first call that asks: it is the same for the
 * whole bash call, since nothing it does is in the window until it returns.
 */
export function capabilityContexts(
  { chatId, model, role, sessionId }: CapabilityScope,
  surface: Surface,
): (signal?: AbortSignal) => CapabilityContext {
  let window: ReturnType<CapabilityContext["modelWindow"]> | undefined;
  const modelWindow = () =>
    (window ??= readModelWindow({ chatId, model, sessionId }));
  return (signal) => ({
    chatId,
    ...(model === undefined ? {} : { model }),
    modelWindow,
    role,
    sessionId,
    ...(signal === undefined ? {} : { signal }),
    surface,
  });
}
