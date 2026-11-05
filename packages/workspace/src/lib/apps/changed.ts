import { publisher } from "../../rpc/publisher";
import { recordAction } from "../actions/log";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { getWorkspaceConfig } from "../workspace-config";
import { type SignInEnd } from "./connection";
import { loadApp } from "./store";
import { signsInDirectly, webInsteadUrl } from "./site";

type AppEventPayload = Omit<
  SessionMessageDataPart.AppEventDataPart["events"][number],
  "event"
> & { event: AppEvent };

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
  happened?: Happened,
): Promise<void> {
  publisher.publish("app.updated", null);
  if (!happened) {
    return;
  }
  const event = await appEventOf(slug, happened);
  publisher.publish("app.event", event);
  const did = PERSON_DID[happened.event];
  if (did) {
    recordAction({ did, kind: "app", name: event.name });
  }
}

/**
 * What the action log says the person did, for the events that are a
 * sign-in of theirs going through or failing. A disconnect is recorded
 * where the person asks for one, since the agent can disconnect an app too.
 */
const PERSON_DID: Partial<Record<AppEvent, "sign-in failed" | "signed in">> = {
  connected: "signed in",
  failed: "sign-in failed",
};

type Happened = {
  detail?: string;
  /** For a failed sign-in, how it ended, when that was more than an error. */
  ended?: SignInEnd;
  event: AppEvent;
};

/** What the chat is told of something the user did to an app, in the app's own name and account. */
export async function appEventOf(
  slug: string,
  happened: Happened,
): Promise<AppEventPayload> {
  const loaded = await loadApp(getWorkspaceConfig().appsDir, slug);
  const app = loaded.isOk() ? loaded.value : undefined;
  const manifest = app?.manifest;
  return {
    ...(manifest?.account === undefined ? {} : { account: manifest.account }),
    ...(happened.detail === undefined ? {} : { detail: happened.detail }),
    event: happened.event,
    name: app?.name ?? slug,
    slug,
    // A web app is worked on its own site, which the chat is told.
    ...(manifest?.type === "web" ? { web: manifest.url } : {}),
    // A sign-in of the app's own that did not connect leaves the service's
    // site, where the chat is told to go next.
    ...(happened.event === "failed" &&
    manifest !== undefined &&
    signsInDirectly(manifest)
      ? {
          signIn: {
            ended: happened.ended ?? "failed",
            ...withWeb(webInsteadUrl(slug, manifest)),
          },
        }
      : {}),
  };
}

function withWeb(web: string | undefined): { web?: string } {
  return web === undefined ? {} : { web };
}
