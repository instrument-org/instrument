import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * The topic whose details are open, by id (`null` when closed).
 * `<TopicDetailsModal />` at the window root reads it; the topic's banner,
 * the inbox's head and a chat's note about a topic it changed open it.
 */
export const topicDetailsModalAtom = studioModalAtom<{ topicId: string }>();

export function openTopicDetails(topicId: string) {
  getDefaultStore().set(topicDetailsModalAtom, { topicId });
}
