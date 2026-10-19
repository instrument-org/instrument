import { createMessageOptions } from "@/client/lib/message-sends";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type StoreId, type ChatId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";

export function useContinueSession({
  id,
  modelURI,
  sessionId,
}: {
  id: ChatId;
  modelURI: AIGatewayModelURI.Type | undefined;
  sessionId: StoreId.Session;
}) {
  const createMessage = useMutation(createMessageOptions());

  const handleContinue = () => {
    if (!modelURI) {
      return;
    }

    createMessage.mutate({
      id,
      modelURI,
      prompt: "Continue.",
      sessionId,
    });
  };

  return { handleContinue, isPending: createMessage.isPending };
}
