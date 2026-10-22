import { EventPublisher } from "@orpc/server";

import { type AppEvent } from "../lib/apps/changed";
import { type SignInEnd } from "../lib/apps/connection";
import { type RecordChanged } from "../lib/record-changes";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type StopNotice } from "../schemas/stop-notice";
import {
  type WindowTabAnswer,
  type WindowTabRequest,
} from "../schemas/window-tab";
import { type BrowserTargetId } from "../types";

export const publisher = new EventPublisher<{
  /**
   * The user acted on an app outside the conversation: finished a sign-in,
   * saved a key, declined, disconnected. Published only by `appChanged`,
   * which the host app calls from the surfaces it owns; the chat is woken
   * with it.
   */
  "app.event": {
    /** The account the app is signed in as, when it is named. */
    account?: string;
    detail?: string;
    event: AppEvent;
    name: string;
    /** For a sign-in of the app's own that did not connect: how it ended, and the site to sign in on instead. */
    signIn?: {
      ended: "failed" | SignInEnd;
      web?: string;
    };
    slug: string;
    /** For a web app, the site the work happens on. */
    web?: string;
  };
  /**
   * An app's folder or connection record changed. Carries no payload because
   * every listener re-reads the list. Published by `appChanged`, and by the
   * apps folder's watch while a list of apps is open (`appListChanges`).
   */
  "app.updated": null;
  /**
   * The app directory changed, because a copy our API served was taken in.
   * Carries no payload because every listener re-reads the directory.
   */
  "app.catalogChanged": null;
  /**
   * A background process in this chat appeared, ended, or was removed. Carries
   * no detail because every listener re-reads the list, and deliberately not
   * published per chunk of output: what a viewer needs is whether the process
   * is still there, not what it just printed.
   */
  "backgroundProcesses.changed": {
    id: ChatId;
  };
  /**
   * A session's background process ended without anyone asking it to: it
   * exited, failed, or hit the age cap. What wakes that session when it is
   * no longer working (`lib/chat/job-wake.ts`).
   */
  "backgroundProcess.settled": {
    id: ChatId;
    sessionId: StoreId.Session;
  };
  /**
   * An agent sent a command to a guest. One per command rather than a
   * start/stop pair: the agent's browser work arrives as separate tool calls
   * seconds apart, so where one stretch of it ends is a question for whoever
   * is displaying it, not one this can answer.
   */
  "browser.agentActivity": {
    /** The guest the command went to: a window tab a chat or one of its tasks holds. */
    targetId: BrowserTargetId;
  };
  /**
   * A memory was saved, corrected, or forgotten. Carries no payload because
   * every listener re-reads the folder.
   */
  "memory.changed": null;
  /**
   * Something about one record moved: its transcript, its sessions, its
   * settings or state, its agent, or the record itself is gone. Published
   * where the change is made (the store's write layer, the record writer,
   * the session actor), so a view that re-reads on it
   * hears every change without keeping a list of events. Read through
   * `recordChanges` in `lib/record-changes.ts`.
   */
  "record.changed": RecordChanged;
  "session.done": {
    id: ChatId;
    /** Present when a stop ended the turn and said whose it was. */
    notice?: StopNotice;
    sessionId: StoreId.Session;
  };
  /**
   * The workspace skills directory changed: a skill was installed, revised, or
   * deleted. Carries no payload because every listener re-reads the list.
   */
  "skill.changed": null;
  /**
   * A topic's folder changed on disk, by the app or anyone else. Carries no
   * payload because every listener re-reads the list.
   */
  "topic.changed": null;
  /**
   * An agent asking the window to act on its tabs: open one (on screen, or
   * behind whatever is up), point one at something else, close one, or bring
   * one forward. Each ask carries a request id, which the window's answer
   * comes back under.
   */
  "window.tab": WindowTabRequest & { id: ChatId };
  /**
   * The window answering an ask: the tab it acted on or made, by the id the
   * conversation names it with and a task can be handed, or why it did
   * nothing.
   */
  "window.tabDone": WindowTabAnswer & { id: ChatId };
}>({
  // Per subscription, starting empty when it subscribes: what a subscriber
  // that is still busy with one event holds of the ones after it. Many of
  // these carry something that cannot be read back later (a tab ask, a
  // tool call starting), so they queue rather than leave only the newest. A
  // live route re-reading state on them collapses a burst into one read
  // (`liveRead`), so queuing costs it nothing.
  maxBufferedEvents: 100,
});
