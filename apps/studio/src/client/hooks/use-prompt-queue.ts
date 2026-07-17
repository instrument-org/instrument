import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type FileUpload } from "@instrument-org/workspace/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ulid } from "ulid";

export interface QueuedPrompt {
  files?: FileUpload.Input[];
  folders?: { path: string }[];
  id: string;
  modelURI: AIGatewayModelURI.Type;
  prompt: string;
}

/**
 * Client-side FIFO of follow-up prompts entered while the agent is running.
 * The head is delivered on the agent's alive->idle edge (i.e. when a turn
 * finishes). Detecting that edge means reacting to an async status stream, so
 * it lives in an effect; falling-edge detection delivers exactly once per
 * completed turn, so it cannot double-send.
 */
export function usePromptQueue({
  isAgentAlive,
  onDispatch,
}: {
  isAgentAlive: boolean;
  onDispatch: (prompt: QueuedPrompt) => void;
}) {
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);

  const deliverNext = useCallback(() => {
    const [head] = queue;
    if (!head) {
      return;
    }
    setQueue((prev) => prev.filter((prompt) => prompt.id !== head.id));
    onDispatch(head);
  }, [onDispatch, queue]);

  const wasAliveRef = useRef(isAgentAlive);
  useEffect(() => {
    const justFinished = wasAliveRef.current && !isAgentAlive;
    wasAliveRef.current = isAgentAlive;
    if (justFinished) {
      deliverNext();
    }
  }, [deliverNext, isAgentAlive]);

  const enqueue = useCallback((prompt: Omit<QueuedPrompt, "id">) => {
    setQueue((prev) => [...prev, { ...prompt, id: ulid() }]);
  }, []);

  const remove = useCallback((id: string) => {
    setQueue((prev) => prev.filter((prompt) => prompt.id !== id));
  }, []);

  const clear = useCallback(() => {
    setQueue([]);
  }, []);

  return { clear, enqueue, queue, remove };
}
