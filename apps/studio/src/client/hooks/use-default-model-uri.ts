import { rpcClient } from "@/client/rpc/client";
import {
  type AIGatewayModelURI,
  type ModelChoice,
} from "@instrument-org/ai-gateway/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

export function useDefaultModelURI() {
  const { data: serverModelURI } = useQuery(
    rpcClient.preferences.live.defaultModelURI.experimental_liveOptions(),
  );
  const { data: serverChoice } = useQuery(
    rpcClient.preferences.live.defaultModelChoice.experimental_liveOptions(),
  );
  const [localChoice, setLocalChoice] = useState<{
    choice: ModelChoice | undefined;
  }>();
  const [localModelURI, setLocalModelURI] = useState<
    AIGatewayModelURI.Type | undefined
  >(undefined);
  const setDefaultModelMutation = useMutation(
    rpcClient.preferences.setDefaultModelURI.mutationOptions(),
  );

  const modelURI = localModelURI ?? serverModelURI;

  const setModelURI = (uri: AIGatewayModelURI.Type) => {
    setLocalModelURI(uri);
  };

  const saveModelURI = (
    uri: AIGatewayModelURI.Type,
    choice: ModelChoice | undefined,
  ) => {
    setDefaultModelMutation.mutate({ choice, modelURI: uri });
  };

  // What was chosen for the model, beside it: it names the model it is for,
  // so it says nothing once another is the default.
  const choice = localChoice ? localChoice.choice : serverChoice;
  const setChoice = (next: ModelChoice | undefined) => {
    setLocalChoice({ choice: next });
  };

  return [modelURI, setModelURI, saveModelURI, choice, setChoice] as const;
}
