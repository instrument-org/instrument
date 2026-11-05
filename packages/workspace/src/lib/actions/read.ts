import { getWorkspaceConfig } from "../workspace-config";
import { actionLog } from "./log";
import { type Action, type HistoryAction } from "./schema";

/**
 * What the person did, as every reader takes it: the action log's lines
 * beside the pages and files the app's history keeps
 * (`readPersonHistory` on the workspace's config), each fact recorded once
 * in one of the two.
 */

function history(range: {
  limit?: number;
  since: number;
  until: number;
}): HistoryAction[] {
  return getWorkspaceConfig().readPersonHistory?.(range) ?? [];
}

const newestFirst = (a: Action, b: Action) =>
  Date.parse(b.at) - Date.parse(a.at);

/** Everything the person did from `since` to `until` (now when absent), oldest first. */
export async function readActions({
  since,
  until = Date.now(),
}: {
  since: number;
  until?: number;
}): Promise<Action[]> {
  const logged = await actionLog().read({ since, until });
  return [...logged, ...history({ since, until })].toSorted(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
}

/**
 * A page of what the person did from `since` to `until`, newest first:
 * `limit` of it after the first `skip`, and whether older is left. Each
 * source is read only as far as the page reaches, since the newest
 * `skip + limit` of the two together are among the newest that many of each.
 */
export async function readActionsNewestFirst({
  limit,
  since,
  skip,
  until,
}: {
  limit: number;
  since: number;
  skip: number;
  until: number;
}): Promise<{ actions: Action[]; more: boolean }> {
  const reach = skip + limit;
  const logged = await actionLog().newestFirst({
    limit: reach,
    since,
    skip: 0,
    until,
  });
  // One past the reach says whether any is left beyond it.
  const kept = history({ limit: reach + 1, since, until });
  const merged = [...logged.actions, ...kept].toSorted(newestFirst);
  return {
    actions: merged.slice(skip, reach),
    more: logged.more || merged.length > reach,
  };
}
