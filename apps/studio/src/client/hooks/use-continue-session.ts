import { createMessageOptions } from "@/client/lib/message-sends";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";

export function useContinueSession({
  id,
  modelURI,
  onSuccess,
  sessionId,
}: {
  id: TaskId;
  modelURI: AIGatewayModelURI.Type | undefined;
  onSuccess?: () => void;
  sessionId: StoreId.Session | undefined;
}) {
  const createMessage = useMutation(createMessageOptions());

  const handleContinue = () => {
    if (!sessionId || !modelURI) {
      return;
    }

    createMessage.mutate(
      {
        id,
        modelURI,
        prompt: "Continue.",
        sessionId,
      },
      { onSuccess },
    );
  };

  return { handleContinue, isPending: createMessage.isPending };
}
