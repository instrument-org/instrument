import { eventIterator, ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  createTopic,
  ListedTopicSchema,
  listTopics,
  retireTopic,
  TOPIC_NAME_MAX,
  TopicFolderSchema,
  TopicNameError,
  topicsDir,
  TopicSchema,
  updateTopic,
} from "../../lib/chat/topics";
import { watchFolder } from "../../lib/folder-watch";
import { base } from "../base";
import { publisher } from "../publisher";

/** What the user picks about a topic: its mark, its tint. */
const TopicMarkSchema = z.object({
  color: z.string().max(9).optional(),
  emoji: z.string().max(8).optional(),
  icon: z.string().max(40).optional(),
});

const TopicNameSchema = z
  .string()
  .min(1)
  .max(TOPIC_NAME_MAX * 2);

/** The conversation's topics: in use first, in the order made, then retired. */
const listTopicsRoute = base
  .output(ListedTopicSchema.array())
  .handler(() => listTopics());

/** A name a topic's folder cannot take, said back as a bad request. */
async function sayingNameErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TopicNameError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
}

/** The standing words for work under a topic; an empty string is none. */
const TopicInstructionsSchema = z.string().max(100_000);

/**
 * Makes a topic under a name, with its instructions and the folders granted
 * under it, or returns the one already called that as it is when given only
 * the name. A name in use given instructions or folders is a bad request.
 */
const createTopicRoute = base
  .input(
    TopicMarkSchema.extend({
      folders: z.array(TopicFolderSchema).optional(),
      instructions: TopicInstructionsSchema.optional(),
      name: TopicNameSchema,
    }),
  )
  .output(TopicSchema)
  .handler(({ input }) =>
    sayingNameErrors(() =>
      createTopic({
        ...(input.color ? { color: input.color } : {}),
        ...(input.emoji ? { emoji: input.emoji } : {}),
        ...(input.folders ? { folders: input.folders } : {}),
        ...(input.icon ? { icon: input.icon } : {}),
        ...(input.instructions ? { instructions: input.instructions } : {}),
        name: input.name,
      }),
    ),
  );

/**
 * Changes what the user chose about a topic: its name, which moves its
 * folder, its mark, its tint, its folders, and its instructions, which an
 * empty string takes away.
 */
const updateTopicRoute = base
  .input(
    TopicMarkSchema.extend({
      folders: z.array(TopicFolderSchema).optional(),
      instructions: TopicInstructionsSchema.optional(),
      name: TopicNameSchema.optional(),
      topicId: z.string(),
    }),
  )
  .handler(async ({ input }) => {
    await sayingNameErrors(() =>
      updateTopic(input.topicId, {
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.emoji === undefined ? {} : { emoji: input.emoji }),
        ...(input.folders === undefined ? {} : { folders: input.folders }),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.instructions === undefined
          ? {}
          : { instructions: input.instructions }),
        ...(input.name === undefined ? {} : { name: input.name }),
      }),
    );
  });

/** Takes a topic out of the menus, leaving the chats that carry it alone. */
const retireTopicRoute = base
  .input(z.object({ topicId: z.string() }))
  .handler(async ({ input }) => {
    await retireTopic(input.topicId);
  });

/**
 * A revision that moves whenever a topic's folder changes on disk, whoever
 * changed it: the app, the agent, the person in their files. Opens with
 * revision 0, a point to re-read from, as `skill.events.changed` does.
 */
const changedTopicsRoute = base
  .output(eventIterator(z.object({ revision: z.number() })))
  .handler(async function* ({ signal }) {
    const changes = publisher.subscribe("topic.changed", { signal });
    const stop = watchFolder(topicsDir(), {
      depth: 1,
      onChange: () => {
        publisher.publish("topic.changed", null);
      },
    });
    let revision = 0;
    try {
      yield { revision };
      for await (const _ of changes) {
        revision += 1;
        yield { revision };
      }
    } finally {
      stop();
    }
  });

export const topics = {
  create: createTopicRoute,
  events: { changed: changedTopicsRoute },
  list: listTopicsRoute,
  retire: retireTopicRoute,
  update: updateTopicRoute,
};
