import { topicDetailsModalAtom } from "@/client/atoms/topic-details-modal";
import { chatFiltersAtom } from "@/client/atoms/window";
import { TopicDialog } from "@/client/components/window/topic-dialog";
import { spokenMessage, toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";

/** A topic's details, changed or deleted from wherever it was asked for. */
export function TopicDetailsModal() {
  const [open, setOpen] = useAtom(topicDetailsModalAtom);
  const [filters, setFilters] = useAtom(chatFiltersAtom);
  const topicsQuery = useQuery(rpcClient.workspace.topics.list.queryOptions());
  const topics = topicsQuery.data ?? [];
  const afterTopicChange = {
    onError: (error: Error) => {
      // A name a topic can't take comes back in words written for people.
      toast.error("Couldn't change the topic", {
        cause: error,
        description: spokenMessage(error, ["BAD_REQUEST"]),
      });
    },
    onSuccess: () => void topicsQuery.refetch(),
  };
  const updateTopic = useMutation(
    rpcClient.workspace.topics.update.mutationOptions(afterTopicChange),
  );
  const retireTopic = useMutation(
    rpcClient.workspace.topics.retire.mutationOptions(afterTopicChange),
  );
  // Looked up on every render rather than kept, so a re-read of the list
  // does not close the dialog under the user.
  const topic = topics.find((each) => each.id === open?.topicId);
  if (!topic) {
    return null;
  }
  return (
    <TopicDialog
      mode="edit"
      onChange={(edits) => {
        if (Object.keys(edits).length === 0) {
          return;
        }
        updateTopic.mutate({ ...edits, topicId: topic.id });
      }}
      // Deleting retires the topic: the tag goes from the column and from
      // the filter if it was the one chosen; the chats keep everything.
      onDelete={() => {
        retireTopic.mutate({ topicId: topic.id });
        if (filters.topics.includes(topic.id)) {
          setFilters({ ...filters, topics: [] });
        }
      }}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setOpen(null);
        }
      }}
      open
      otherNames={topics.flatMap((each) =>
        each.id === topic.id ? [] : [each.name],
      )}
      topic={topic}
    />
  );
}
