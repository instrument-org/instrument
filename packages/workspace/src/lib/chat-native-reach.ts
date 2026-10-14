import { type ChatId } from "../schemas/chat-id";
import { heldNativeReach, type NativeReach } from "./native-sandbox";
import { nativeReachFor } from "./permissions/chat-rules";
import { sessionLayout } from "./session-layout";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * What a native command the app starts for a chat is held to: the reach of
 * the shell call it runs in, or, for one the app starts outside any (a
 * skill's install, the chat's virtualenv), the chat's own, as its shell
 * holds it. Undefined where native commands run unwrapped.
 */
export async function chatNativeReach(
  chatId: ChatId,
): Promise<NativeReach | undefined> {
  const held = heldNativeReach();
  if (held) {
    return held;
  }
  if (!getWorkspaceConfig().nativeSandbox) {
    return undefined;
  }
  const layout = await sessionLayout({ chatId });
  return nativeReachFor(layout.rules, layout);
}
