import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  createTopic,
  listTopics,
  retireTopic,
  TOPIC_NAME_MAX,
  TopicFolderSchema,
  TopicNameError,
  TopicSchema,
  updateTopic,
} from "../../lib/orchestrator/topics";
import { base } from "../base";

/** What the user picks about a topic: its mark, its tint. */
const TopicMarkSchema = z.object({
  color: z.string().max(9).optional(),
  emoji: z.string().max(8).optional(),
});

const TopicNameSchema = z
  .string()
  .min(1)
  .max(TOPIC_NAME_MAX * 2);

/** The conversation's topics: in use first, in the order made, then retired. */
const listTopicsRoute = base
  .output(TopicSchema.array())
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

/** Makes a topic under a name, or returns the one already called that. */
const createTopicRoute = base
  .input(
    TopicMarkSchema.extend({
      name: TopicNameSchema,
    }),
  )
  .output(TopicSchema)
  .handler(({ input }) =>
    sayingNameErrors(() =>
      createTopic({
        ...(input.color ? { color: input.color } : {}),
        ...(input.emoji ? { emoji: input.emoji } : {}),
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
      instructions: z.string().max(100_000).optional(),
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

export const topics = {
  create: createTopicRoute,
  list: listTopicsRoute,
  retire: retireTopicRoute,
  update: updateTopicRoute,
};
