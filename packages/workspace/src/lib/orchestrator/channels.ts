import { alphabetical } from "radashi";

import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { type TaskState } from "../../schemas/task-state";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState, updateTaskChannels } from "../task-record";
import { sessionAsk } from "./standing";

/**
 * The channel every orchestrator has, made on first use and never archived:
 * the place the conversation happens when the user has not split anything off.
 * Named for the app rather than for a category, since it is not one subject
 * among others; it is where you talk.
 */
export const DEFAULT_CHANNEL_NAME = "Instrument";

/** How long a channel's name may be. Short names keep the strip readable. */
export const CHANNEL_NAME_MAX = 16;

export type Channel = NonNullable<TaskState["channels"]>[number];

/** A channel and what the user has not seen in it. */
export interface ChannelStanding {
  color?: string;
  createdAt: number;
  emoji?: string;
  id: StoreId.Session;
  name: string;
  /** Its last turn ended on an ask, so it has stopped until the user answers. */
  needsYou: boolean;
  /** Assistant messages since the user last had this channel on screen. */
  unread: number;
  /** When anything last landed in it, for ordering and for the agent's context. */
  updatedAt: number;
}

/**
 * Takes a channel out of the strip, keeping everything said in it.
 *
 * Archiving rather than deleting because a channel is a place a conversation
 * happened: the messages are the record, and a strip that has grown long is
 * not a reason to lose them. The first channel stays, since the conversation
 * has to happen somewhere.
 */
export async function archiveChannel(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<{ archived: boolean; reason?: string }> {
  let refused: string | undefined;
  await updateTaskChannels(taskDir(taskId), (channels) => {
    if (channels[0]?.id === sessionId) {
      refused = "The first channel stays.";
      return channels;
    }
    if (channels.filter((channel) => !channel.archived).length <= 1) {
      refused = "The last channel stays.";
      return channels;
    }
    return channels.map((channel) =>
      channel.id === sessionId ? { ...channel, archived: true } : channel,
    );
  });
  return refused ? { archived: false, reason: refused } : { archived: true };
}

/** A channel by name, however the caller cased or hashed it. */
export async function channelByName(
  taskId: TaskId,
  name: string,
): Promise<Channel | undefined> {
  // Case-insensitive, since a name is written by the user and typed back by
  // the agent, and neither should have to remember which.
  const wanted = channelName(name).toLowerCase();
  const channels = await listChannels(taskId);
  return channels.find((channel) => channel.name.toLowerCase() === wanted);
}

/** What a name becomes: no hash, one space between words, bounded. */
export function channelName(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, CHANNEL_NAME_MAX);
}

/** The channel a session belongs to, or none when the session is not one. */
export async function channelOfSession(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<Channel | undefined> {
  const channels = await listChannels(taskId);
  return channels.find((channel) => channel.id === sessionId);
}

/**
 * What the conversation is told about its channels: which one this message
 * came from, and what the others are called, so a reply about "the reddit
 * channel" means something and `chat read` has names to use.
 */
export async function channelsContextText(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<string> {
  const channels = await listChannels(taskId);
  const here = channels.find((channel) => channel.id === sessionId);
  if (!here && channels.length <= 1) {
    return "";
  }
  const others = channels.filter((channel) => channel.id !== sessionId);
  const lines = [
    `This message was sent in the channel #${here?.name ?? DEFAULT_CHANNEL_NAME}.`,
    others.length > 0
      ? `The user's other channels: ${others.map((channel) => `#${channel.name}`).join(", ")}. They are the same conversation with you, kept apart by subject; you are in all of them and remember all of them.`
      : "It is the only channel so far.",
  ];
  return lines.join(" ");
}

/** The channels with their unread counts and last activity, for the strip. */
export async function channelStandings(
  taskId: TaskId,
): Promise<ChannelStanding[]> {
  const channels = await listChannels(taskId);
  const standings = await Promise.all(
    channels.map(async (channel) => ({
      ...channel,
      needsYou: (await sessionAsk(taskId, channel.id)) !== undefined,
      unread: await unreadCount(taskId, channel),
      updatedAt: await lastActivity(taskId, channel.id),
    })),
  );
  return standings;
}

/** Makes a channel with a session of its own, and returns it. */
export async function createChannel(
  taskId: TaskId,
  name: string,
  mark: { color?: string; emoji?: string } = {},
): Promise<Channel> {
  await listChannels(taskId);
  const channel: Channel = {
    ...(mark.color ? { color: mark.color } : {}),
    createdAt: Date.now(),
    ...(mark.emoji ? { emoji: mark.emoji } : {}),
    id: await makeSession(taskId, name),
    name: channelName(name),
  };
  await updateTaskChannels(taskDir(taskId), (channels) => [
    ...channels,
    channel,
  ]);
  return channel;
}

/**
 * The channels of a conversation, in the order they were made, creating the
 * first one when there is none.
 *
 * A conversation that predates channels has sessions but no list, so its
 * newest session becomes the first channel rather than being stranded: the window
 * opens on what the user was last talking in.
 */
export async function listChannels(taskId: TaskId): Promise<Channel[]> {
  const state = await getTaskState(taskDir(taskId));
  const known = state.channels ?? [];
  const visible = known.filter((channel) => !channel.archived);
  if (visible.length > 0) {
    return visible;
  }
  if (known.length > 0) {
    // Everything is archived, which the archive rule does not allow; the
    // oldest comes back rather than leaving the window with no channel.
    const written = await updateTaskChannels(taskDir(taskId), (channels) =>
      channels.map((channel, index) =>
        index === 0 ? { ...channel, archived: false } : channel,
      ),
    );
    return written.filter((channel) => !channel.archived);
  }
  const adopted = await newestSessionId(taskId);
  const channel: Channel = {
    createdAt: Date.now(),
    id: adopted ?? (await makeSession(taskId, DEFAULT_CHANNEL_NAME)),
    name: DEFAULT_CHANNEL_NAME,
  };
  const written = await updateTaskChannels(taskDir(taskId), (channels) =>
    channels.length > 0 ? channels : [channel],
  );
  return written.filter((entry) => !entry.archived);
}

/** Records what the user has seen in a channel, so its count can clear. */
export async function markChannelSeen(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<void> {
  const newest = await newestMessageId(taskId, sessionId);
  if (!newest) {
    return;
  }
  await updateTaskChannels(taskDir(taskId), (channels) =>
    channels.map((channel) =>
      channel.id === sessionId
        ? { ...channel, seenMessageId: newest }
        : channel,
    ),
  );
}

/** The order the strip was left in, which is the order it opens in. */
export async function reorderChannels(
  taskId: TaskId,
  ids: StoreId.Session[],
): Promise<void> {
  await updateTaskChannels(taskDir(taskId), (channels) => {
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const moved = ids.flatMap((id) => {
      const channel = byId.get(id);
      return channel ? [channel] : [];
    });
    const rest = channels.filter((channel) => !ids.includes(channel.id));
    return [...moved, ...rest];
  });
}

/**
 * Changes what the user chose about a channel: its name, its mark, its color.
 * All three are the user's, so nothing here judges them beyond the shape every
 * name takes; anything left out is left alone.
 */
export async function updateChannel(
  taskId: TaskId,
  sessionId: StoreId.Session,
  change: { color?: string; emoji?: string; name?: string },
): Promise<void> {
  await updateTaskChannels(taskDir(taskId), (channels) =>
    channels.map((channel) =>
      channel.id === sessionId
        ? {
            ...channel,
            ...(change.color === undefined ? {} : { color: change.color }),
            ...(change.emoji === undefined ? {} : { emoji: change.emoji }),
            ...(change.name === undefined
              ? {}
              : { name: channelName(change.name) }),
          }
        : channel,
    ),
  );
}

async function lastActivity(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<number> {
  const session = await Store.getSession(sessionId, taskId);
  return session.isOk() ? (session.value.updatedAt?.getTime() ?? 0) : 0;
}

async function makeSession(
  taskId: TaskId,
  name: string,
): Promise<StoreId.Session> {
  const id = StoreId.newSessionId();
  const now = new Date();
  await Store.saveSession(
    { createdAt: now, id, title: channelName(name), updatedAt: now },
    taskId,
  );
  return id;
}

async function newestMessageId(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<StoreId.Message | undefined> {
  const ids = await Store.getMessageIds(sessionId, taskId);
  if (ids.isErr()) {
    return undefined;
  }
  return alphabetical(ids.value, (id) => id).at(-1);
}

async function newestSessionId(
  taskId: TaskId,
): Promise<StoreId.Session | undefined> {
  const sessions = await Store.getSessions(taskId);
  if (sessions.isErr()) {
    return undefined;
  }
  return alphabetical(sessions.value, (session) => session.id).at(-1)?.id;
}

/**
 * What arrived in a channel while the user was elsewhere: its assistant
 * messages after the last one they saw. Their own messages are seen by the
 * act of typing them, so they never count.
 */
async function unreadCount(taskId: TaskId, channel: Channel): Promise<number> {
  const ids = await Store.getMessageIds(channel.id, taskId);
  if (ids.isErr()) {
    return 0;
  }
  const seen = channel.seenMessageId;
  const after = alphabetical(ids.value, (id) => id).filter((id) =>
    seen ? id > seen : true,
  );
  if (after.length === 0) {
    return 0;
  }
  const messages = await Store.getMessages({
    messageIds: after,
    sessionId: channel.id,
    taskId,
  });
  if (messages.isErr()) {
    return 0;
  }
  // Anything that is not the user's own: a reply, and whatever else a channel
  // may be written into by. Counting only assistant messages left a channel
  // silent for everything the conversation puts there by another route.
  return messages.value.filter((message) => message.role !== "user").length;
}
