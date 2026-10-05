import { publisher } from "../../rpc/publisher";
import { getWorkspaceConfig } from "../workspace-config";
import { loadApp } from "./store";

/** What the user did to an app outside the conversation, which the chat is told. */
export type AppEvent =
  | "connected"
  | "declined"
  | "disconnected"
  | "failed"
  | "removed";

/**
 * Says an app changed: its folder, its connection, its key. Every list of
 * apps reads again (`app.updated`), and, given what the user did, the chat
 * hears it under the app's own name (`app.event`), so the two can never be
 * published apart. The name is read before anything is said, so call this
 * before an app's folder goes to the trash.
 */
export async function appChanged(
  slug: string,
  happened?: { detail?: string; event: AppEvent },
): Promise<void> {
  publisher.publish("app.updated", null);
  if (!happened) {
    return;
  }
  const loaded = await loadApp(getWorkspaceConfig().appsDir, slug);
  publisher.publish("app.event", {
    ...(happened.detail === undefined ? {} : { detail: happened.detail }),
    event: happened.event,
    name: loaded.isOk() ? loaded.value.manifest.name : slug,
    slug,
  });
}
