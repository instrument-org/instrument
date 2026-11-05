import { ChatIdSchema } from "../../schemas/chat-id";
import { chatTitle } from "../chat-info";
import { readPermissionSettings } from "../permissions/rules";
import { getWorkspaceConfig } from "../workspace-config";
import { actionLog } from "./log";
import { type Action, type HistoryAction } from "./schema";

/**
 * What the person did, as every reader takes it: the action log's lines
 * beside the pages and files the app's history keeps
 * (`readPersonHistory` on the workspace's config) and the permissions they
 * answered, which each chat's grants and refusals in `permissions.json`
 * keep. Each fact is recorded once, in one of the three.
 */

type Range = { since: number; until: number };

function history(range: Range & { limit?: number }): HistoryAction[] {
  return getWorkspaceConfig().readPersonHistory?.(range) ?? [];
}

type PermissionAction = Extract<Action, { kind: "permission" }>;

/**
 * The permissions the person answered on a chat's card in a range: a folder
 * allowed from the card (a file sent with a message is no answer), an app
 * allowed, and either refused. A grant taken back since is gone from the
 * file, and from here with it. A chat is named by its title, and one with
 * none to read is left out.
 */
async function permissions({ since, until }: Range): Promise<Action[]> {
  const { chats } = await readPermissionSettings();
  const answered: (Omit<PermissionAction, "title"> & { chat: string })[] = [];
  const add = (
    at: Date,
    chat: string,
    answer: Omit<PermissionAction, "at" | "id" | "kind" | "title">,
  ) => {
    const ms = at.getTime();
    if (ms >= since && ms <= until) {
      answered.push({
        ...answer,
        at: at.toISOString(),
        chat,
        id: chat,
        kind: "permission",
      });
    }
  };
  for (const [chat, { appGrants, denials, grants }] of Object.entries(chats)) {
    for (const grant of grants) {
      if (grant.source === "card") {
        add(grant.grantedAt, chat, { did: "allowed", path: grant.path });
      }
    }
    for (const grant of appGrants) {
      add(grant.grantedAt, chat, { app: grant.app, did: "allowed" });
    }
    for (const denial of denials) {
      add(denial.deniedAt, chat, {
        did: "refused",
        ...(denial.kind === "folder"
          ? { path: denial.target }
          : { app: denial.target }),
      });
    }
  }
  const titles = new Map<string, string | undefined>();
  const named: Action[] = [];
  for (const { chat, ...answer } of answered) {
    if (!titles.has(chat)) {
      const id = ChatIdSchema.safeParse(chat);
      titles.set(chat, id.success ? await chatTitle(id.data) : undefined);
    }
    const title = titles.get(chat);
    if (title !== undefined) {
      named.push({ ...answer, title });
    }
  }
  return named;
}

const oldestFirst = (a: Action, b: Action) =>
  Date.parse(a.at) - Date.parse(b.at);

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
  const [logged, answered] = await Promise.all([
    actionLog().read({ since, until }),
    permissions({ since, until }),
  ]);
  return [...logged, ...history({ since, until }), ...answered].toSorted(
    oldestFirst,
  );
}

/**
 * A page of what the person did from `since` to `until`, newest first:
 * `limit` of it after the first `skip`, and whether older is left. The log
 * and the history are read only as far as the page reaches, since the
 * newest `skip + limit` of them all are among the newest that many of each.
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
  const [logged, answered] = await Promise.all([
    actionLog().newestFirst({ limit: reach, since, skip: 0, until }),
    permissions({ since, until }),
  ]);
  // One past the reach says whether any is left beyond it.
  const kept = history({ limit: reach + 1, since, until });
  const merged = [...logged.actions, ...kept, ...answered].toSorted(
    newestFirst,
  );
  return {
    actions: merged.slice(skip, reach),
    more: logged.more || merged.length > reach,
  };
}
