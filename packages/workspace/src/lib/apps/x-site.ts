import ms from "ms";

import { type ChatId } from "../../schemas/chat-id";
import { getCurrentDate } from "../get-current-date";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppManifest } from "./manifest";

/**
 * X's hosts: its site and the one it had as Twitter, bare or as `www.` and
 * `mobile.`. Its other hosts (ads, developer) are services of their own.
 */
const X_HOSTS = new Set(
  ["x.com", "twitter.com"].flatMap((site) => [
    site,
    `www.${site}`,
    `mobile.${site}`,
  ]),
);

/**
 * Whether an app is X: a web app on X's site, whatever its id. Every such
 * app also has Instrument's own X tools (`lib/capabilities/x.ts`), which run
 * on the user's Grok plan.
 */
export function isXApp(manifest: AppManifest): boolean {
  if (manifest.type !== "web") {
    return false;
  }
  try {
    return X_HOSTS.has(new URL(manifest.url).hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a Grok plan is signed in on this computer, which X's tools run on:
 * an account with a plan xAI has not said it lacks.
 */
export function grokPlanSignedIn(): boolean {
  return getWorkspaceConfig()
    .getAIProviderConfigs()
    .some((config) => config.type === "grok-account");
}

/** How long an X tool refused for want of a Grok plan has a chat's ask for X ask for the plan. */
const PLAN_REFUSAL_LASTS_MS = ms("10 minutes");

/**
 * When an X tool was last refused for want of a Grok plan, by the chat the
 * call was made in, its tasks' included. Kept in memory: a refusal from
 * before a restart is long past.
 */
const planRefusedAt = new Map<ChatId, number>();

/** Notes that an X tool call in the chat, or one of its tasks, was refused for want of a Grok plan. */
export function noteGrokPlanRefused(chatId: ChatId): void {
  planRefusedAt.set(chatId, getCurrentDate().getTime());
}

/** Whether an X tool call in the chat was refused for want of a Grok plan in the last ten minutes. */
export function grokPlanRefusedLately(chatId: ChatId): boolean {
  const at = planRefusedAt.get(chatId);
  return (
    at !== undefined && getCurrentDate().getTime() - at < PLAN_REFUSAL_LASTS_MS
  );
}
